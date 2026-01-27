// src/routes/uppromoteWebhooks.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const config = require("../config");
const { log, error } = require("../utils/logger");
const { storeReferralCredit } = require("../services/creditService");
const { getSubscriptionsAndApplyDiscount } = require("../services/sealClient");
const { addReferralAdjustment } = require("../services/uppromoteClient");

/**
 * Verify X-UpPromote-Signature header using HMAC-SHA256
 * over the raw request body and the secret key from UpPromote.
 */
function verifySignature(req) {
  const secret = config.uppromoteWebhookSecret;

  if (!secret) {
    // In dev, if you haven't set the secret yet, skip verification
    log("[UpPromote] No webhook secret configured, skipping signature check");
    return true;
  }

  const received = req.header("X-UpPromote-Signature");
  if (!received) {
    log("[UpPromote] Missing X-UpPromote-Signature header");
    return false;
  }

  const rawBody = req.body; // Buffer, because express.raw is used in index.js

  const calculated = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(calculated, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  const valid = crypto.timingSafeEqual(a, b);
  if (!valid) {
    log("[UpPromote] Signature mismatch");
  }
  return valid;
}

/**
 * Simple GET handler so:
 *  - curl -I
 *  - Browser open
 * both return 200 "OK".
 */
router.get("/referral-approved", (req, res) => {
  log("[UpPromote] GET /referral-approved health check");
  res.status(200).send("OK");
});

/**
 * POST handler for UpPromote "referral.approved" webhooks.
 * - Empty POST (no body, no signature) → treat as validation → 200 OK
 * - Real webhook (body + signature) → verify, parse JSON, store credit,
 *   apply Seal discounts, then sync usage back to UpPromote via adjustment.
 */
router.post("/referral-approved", async (req, res) => {
  try {
    const sig = req.header("X-UpPromote-Signature");
    const hasBody = req.body && req.body.length > 0;

    // 1) Validation POST from UpPromote (no body, no signature)
    if (!sig && !hasBody) {
      log("[UpPromote] Validation POST received (no body, no signature)");
      return res.status(200).send("OK");
    }

    // 2) Real webhook → verify signature
    if (!verifySignature(req)) {
      // For real webhooks, you can return 401
      // UpPromote will consider this a failed delivery
      return res.status(401).send("Invalid signature");
    }

    // 3) Parse JSON payload
    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (parseErr) {
      error("[UpPromote] Failed to parse JSON body:", parseErr);
      // Still return 200 so we don't get stuck on a bad payload
      return res.status(200).send("OK");
    }

    log("[UpPromote] referral-approved webhook payload:", payload);

    // 4) Store credit for this referral (local ledger)
    try {
      storeReferralCredit(payload);
    } catch (logicErr) {
      error("[UpPromote] Error in storeReferralCredit:", logicErr);
      // Do not fail the webhook for internal logic errors
    }

    // 5) Extract email we will use to match Seal subscriptions.
    // Priority: affiliate?.email > customer_email > customer?.email > email
    const customerEmail =
      payload.affiliate?.email ||
      payload.customer_email ||
      payload.customer?.email ||
      payload.email;

    // Log all available email fields for debugging
    log("[UpPromote] Available email fields in webhook", {
      affiliate_email: payload.affiliate?.email,
      customer_email: payload.customer_email,
      customer_object_email: payload.customer?.email,
      email: payload.email,
      referralId: payload.id
    });

    if (customerEmail) {
      try {
        log("[UpPromote] Extracted email from webhook", {
          email: customerEmail,
          referralId: payload.id,
          source: payload.affiliate?.email
            ? "affiliate.email"
            : payload.customer_email
            ? "customer_email"
            : payload.customer?.email
            ? "customer.email"
            : "email",
          commissionAmount: payload.commission
        });

        // Commission amount for dynamic discount creation
        const commissionAmount = parseFloat(payload.commission || 0);

        // 6) Find Seal subscriptions and apply discount code(s)
        const result = await getSubscriptionsAndApplyDiscount(
          customerEmail,
          null, // Let the Seal service handle discount code creation
          commissionAmount,
          payload.id
        );

        const appliedCount =
          typeof result.appliedCount === "number"
            ? result.appliedCount
            : result.appliedDiscounts?.length || 0;

        log("[UpPromote] Processed Seal subscriptions and applied discounts", {
          affiliateEmail: customerEmail,
          referralId: payload.id,
          commissionAmount,
          subscriptionIds: result.subscriptionIds,
          appliedCount,
          success: result.success
        });

        if (result.errors && result.errors.length > 0) {
          error("[UpPromote] Some subscriptions failed to get discount applied", {
            affiliateEmail: customerEmail,
            errors: result.errors
          });
        }

        // 7) If at least one subscription got a discount, tell UpPromote
        //    that we "used" this commission, by adding a negative adjustment.
        if (result.success && appliedCount > 0 && commissionAmount > 0) {
          const referralId = payload.id;
          // For now we assume we used the full commission once.
          // If you later support partial usage, adjust this logic.
          const usedAmount = commissionAmount;
          const adjustmentAmount = -usedAmount;

          try {
            await addReferralAdjustment(referralId, adjustmentAmount);

            log(
              "[UpPromote] Recorded commission usage via referral adjustment",
              {
                referralId,
                originalCommission: commissionAmount,
                usedAmount,
                adjustmentAmount
              }
            );
          } catch (adjErr) {
            error(
              "[UpPromote] Could not sync commission deduction back to UpPromote",
              {
                referralId,
                adjustmentAmount,
                error: adjErr.message
              }
            );
          }
        }
      } catch (sealErr) {
        // Don't fail the webhook if Seal lookup or discount application fails
        error("[UpPromote] Error processing Seal subscriptions:", sealErr);
      }
    } else {
      // If no email is available, we cannot apply discounts to subscriptions
      // This might happen for incomplete webhook data
      log("[UpPromote] No email found in webhook payload", {
        referralId: payload.id,
        trackingType: payload.tracking_type,
        hasAffiliateEmail: !!payload.affiliate?.email,
        hasCustomerEmail: !!payload.customer_email,
        hasCustomerObject: !!payload.customer,
        hasEmailField: !!payload.email,
        payloadKeys: Object.keys(payload)
      });

      // For manually added referrals, the affiliate email should still be available
      if (payload.tracking_type === "Manually added") {
        log(
          "[UpPromote] Manually added referral detected - will apply discount to affiliate's subscriptions if email available",
          {
            referralId: payload.id,
            orderId: payload.order_id,
            orderNumber: payload.order_number,
            hasAffiliateEmail: !!payload.affiliate?.email
          }
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    error("[UpPromote] Unexpected error in referral-approved handler:", err);
    // Always 200 for unexpected errors so we don't break validation
    return res.status(200).send("OK");
  }
});

module.exports = router;
