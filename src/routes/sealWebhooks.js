const express = require("express");
const router = express.Router();
const config = require("../config");
const { log, error } = require("../utils/logger");
const {
  getTotalCreditForCustomer,
  consumeCreditForCustomer
} = require("../services/creditService");
const { applyDiscountCode } = require("../services/sealClient");

function verifyQueryToken(req, res) {
  if (!config.webhookSharedSecret) {
    log("[Seal webhook] No webhook secret configured, skipping token verification");
    return true;
  }
  if (req.query.token !== config.webhookSharedSecret) {
    error("[Seal webhook] Token verification failed", {
      received: req.query.token ? "present" : "missing",
      expected: config.webhookSharedSecret ? "configured" : "not configured"
    });
    res.status(401).send("Unauthorized");
    return false;
  }
  log("[Seal webhook] Token verification successful");
  return true;
}

// Seal "subscription" webhook endpoint
router.post("/subscription", async (req, res) => {
  const startTime = Date.now();
  try {
    log("[Seal webhook] Subscription webhook received");
    if (!verifyQueryToken(req, res)) {
      log("[Seal webhook] Request rejected due to token verification failure");
      return;
    }

    // Seal might send either the subscription object directly or wrapped in payload
    const body = req.body;
    const subscription = body.payload?.payload || body.payload || body;

    log("[Seal webhook] Received subscription event:", {
      rawBody: body,
      extractedSubscription: subscription
    });

    const subscriptionId = subscription.id;
    const customerEmail = subscription.email;
    const totalValue = Number(subscription.total_value || 0);

    if (!subscriptionId || !customerEmail || isNaN(totalValue)) {
      log("[Seal webhook] Missing required fields; returning 200", {
        subscriptionId: subscriptionId || "missing",
        customerEmail: customerEmail || "missing",
        totalValue: isNaN(totalValue) ? "invalid" : totalValue
      });
      return res.status(200).json({ success: true });
    }

    log("[Seal webhook] Processing subscription", {
      subscriptionId,
      customerEmail,
      totalValue
    });

    // How much credit is available for this customer (from UpPromote referrals)?
    const availableCredit = getTotalCreditForCustomer(customerEmail);
    log(
      `[Seal webhook] Customer ${customerEmail} has available credit ${availableCredit}`
    );

    if (availableCredit <= 0) {
      // Nothing to do, just acknowledge
      return res.status(200).json({ success: true, message: "no-credit" });
    }

    // Decide how much to use now.
    // Simple rule: use up to this subscription's total value.
    const amountToUse = Math.min(availableCredit, totalValue);
    log("[Seal webhook] Credit calculation", {
      availableCredit,
      totalValue,
      amountToUse
    });

    // 1) Apply discount code to subscription (STATIC CODE)
    // ⚠ This does NOT automatically match the "amountToUse" unless your code is configured in Shopify
    //     to give exactly the discount you want (e.g. same % as commission).
    // For a fully dynamic wallet, you would need to integrate Shopify Admin API and generate one-off codes.
    log("[Seal webhook] Applying discount code to subscription");
    await applyDiscountCode(subscriptionId, config.subscriptionDiscountCode);

    // 2) Reduce affiliate commission balance in UpPromote by amountToUse
    log("[Seal webhook] Consuming credit for customer");
    const result = await consumeCreditForCustomer(customerEmail, amountToUse);

    const duration = Date.now() - startTime;
    log(
      `[Seal webhook] Successfully processed subscription webhook (${duration}ms)`,
      {
        subscriptionId,
        customerEmail,
        usedCredit: result.used,
        availableBefore: availableCredit,
        breakdown: result.breakdown
      }
    );

    res.status(200).json({
      success: true,
      usedCredit: result.used,
      availableBefore: availableCredit
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    error("[Seal webhook] Error handling subscription webhook", {
      error: err.message,
      stack: err.stack,
      duration: `${duration}ms`,
      subscriptionId: req.body?.payload?.payload?.id || req.body?.payload?.id || req.body?.id,
      customerEmail: req.body?.payload?.payload?.email || req.body?.payload?.email || req.body?.email
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
