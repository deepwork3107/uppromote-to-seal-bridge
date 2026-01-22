// src/routes/uppromoteWebhooks.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const config = require("../config");
const { log, error } = require("../utils/logger");
const { storeReferralCredit } = require("../services/creditService");
const { getSubscriptionsAndApplyDiscount } = require("../services/sealClient");

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
 * - Real webhook (body + signature) → verify, parse JSON, store credit
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

    // 4) Your business logic: store credit for this referral
    try {
      storeReferralCredit(payload);
    } catch (logicErr) {
      error("[UpPromote] Error in storeReferralCredit:", logicErr);
      // Do not fail the webhook for internal logic errors
    }

    // 5) Extract email from webhook payload (try multiple fields)
    // Priority: customer_email > customer?.email > affiliate?.email > email
    const customerEmail = 
      payload.customer_email || 
      payload.customer?.email || 
      payload.affiliate?.email || 
      payload.email;

    if (customerEmail) {
      try {
        log("[UpPromote] Extracted email from webhook", {
          email: customerEmail,
          referralId: payload.id,
          source: payload.customer_email ? 'customer_email' : 
                  payload.customer?.email ? 'customer.email' :
                  payload.affiliate?.email ? 'affiliate.email' : 'email'
        });

        // Find Seal subscriptions and apply discount codes
        const result = await getSubscriptionsAndApplyDiscount(customerEmail);
        log("[UpPromote] Processed Seal subscriptions and applied discounts", {
          customerEmail,
          referralId: payload.id,
          subscriptionIds: result.subscriptionIds,
          appliedCount: result.appliedDiscounts?.length || 0,
          success: result.success
        });
        
        if (result.errors && result.errors.length > 0) {
          error("[UpPromote] Some subscriptions failed to get discount applied", {
            customerEmail,
            errors: result.errors
          });
        }
      } catch (sealErr) {
        // Don't fail the webhook if Seal lookup fails
        error("[UpPromote] Error processing Seal subscriptions:", sealErr);
      }
    } else {
      log("[UpPromote] No email found in webhook payload, skipping Seal subscription lookup", {
        referralId: payload.id,
        payloadKeys: Object.keys(payload)
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    error("[UpPromote] Unexpected error in referral-approved handler:", err);
    // Always 200 for unexpected errors so we don't break validation
    return res.status(200).send("OK");
  }
});

module.exports = router;
