const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");
const { getOrCreateDiscountCode } = require("./shopifyClient");

const sealApi = axios.create({
  baseURL: "https://app.sealsubscriptions.com/shopify/merchant/api",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Seal-Token": config.sealApiToken,
  },
  timeout: 20000,
});

/**
 * Get ACTIVE subscriptions for a given email.
 * Uses Seal API filter: GET /subscriptions?query={email}&active-only=true
 *
 * NOTE: The list API does NOT include discount_codes in items.
 *       Use getSubscriptionById() to get the full detail with discount codes.
 */
async function getSubscriptionsByEmail(email) {
  if (!email) {
    error("[Seal] No email provided to getSubscriptionsByEmail");
    throw new Error("Email is required");
  }

  try {
    log("[Seal] Fetching ACTIVE subscriptions by email", { email });

    const res = await sealApi.get("/subscriptions", {
      params: {
        query: email,
        "active-only": "true",
      },
    });

    const subscriptions = Array.isArray(res?.data?.payload?.subscriptions)
      ? res.data.payload.subscriptions
      : [];

    log("[Seal] Fetched subscriptions", {
      email,
      subscriptionCount: subscriptions.length,
      subscriptionIds: subscriptions.map((s) => s.id),
    });

    if (!subscriptions.length) {
      log("[Seal] No ACTIVE subscriptions found for email", { email });
    }

    return subscriptions;
  } catch (err) {
    error("[Seal] Failed to fetch subscriptions by email", {
      email,
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Get full subscription detail including items and discount_codes.
 * GET /subscription?id={subscriptionId}
 *
 * This is the only endpoint that returns items[].discount_codes[].
 */
async function getSubscriptionById(subscriptionId) {
  if (!subscriptionId) throw new Error("subscriptionId is required");

  try {
    log("[Seal] Fetching subscription detail", { subscriptionId });

    const res = await sealApi.get("/subscription", {
      params: { id: subscriptionId },
    });

    return res.data?.payload || null;
  } catch (err) {
    error("[Seal] Failed to fetch subscription detail", {
      subscriptionId,
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Extract all applied discount codes from a subscription's items.
 * Per Seal docs: items[].discount_codes[] → { id, code, amount }
 * Only populated when using GET /subscription?id=xxx (detail endpoint).
 */
function extractDiscountDetailsFromSubscription(subscription) {
  const items = Array.isArray(subscription?.items) ? subscription.items : [];
  const codes = [];

  for (const item of items) {
    const discountCodes = Array.isArray(item?.discount_codes)
      ? item.discount_codes
      : [];
    for (const dc of discountCodes) {
      if (dc && (dc.code || dc.id)) {
        codes.push({
          id: dc.id,
          code: dc.code,
          amount: dc.amount,
          itemId: item?.id,
        });
      }
    }
  }

  return codes;
}

/**
 * Main flow: find ACTIVE subscriptions for email, check for existing discounts,
 * then create + email + apply a new discount code only when none is present.
 *
 * Rules:
 * 1. No ACTIVE subscription → do nothing.
 * 2. ACTIVE subscription already has any discount code → do nothing (leave referral balance).
 * 3. ACTIVE subscription with no discount → create Shopify code → email it → apply in Seal.
 */
async function getSubscriptionsAndApplyDiscount(
  email,
  discountCode = null,
  commissionAmount = 0,
  referralId = null,
) {
  if (!email) {
    error("[Seal] Email is required");
    throw new Error("Email is required");
  }

  try {
    log("[Seal] Processing referral for email", {
      email,
      commissionAmount,
      referralId,
    });

    // Step 1: get ACTIVE subscriptions
    const subscriptions = await getSubscriptionsByEmail(email);
    const subscriptionIds = subscriptions.map((s) => s.id).filter(Boolean);

    if (subscriptionIds.length === 0) {
      log("[Seal] No ACTIVE subscriptions — skipping discount creation", { email });
      return {
        email,
        subscriptionIds: [],
        appliedDiscounts: [],
        message: "no-active-subscriptions",
        success: true,
      };
    }

    // Step 2: fetch full detail for each subscription to read existing discount_codes
    // (list API does not return discount_codes, only detail endpoint does)
    const alreadyApplied = [];
    for (const sub of subscriptions) {
      let fullSub = null;
      try {
        fullSub = await getSubscriptionById(sub.id);
      } catch (detailErr) {
        error("[Seal] Could not fetch subscription detail; treating as no discount", {
          subscriptionId: sub.id,
          email,
          message: detailErr.message,
        });
      }

      const existingDiscounts = extractDiscountDetailsFromSubscription(fullSub || sub);
      if (existingDiscounts.length) {
        log("[Seal] Subscription already has discount(s)", {
          subscriptionId: sub.id,
          existingDiscounts,
        });
        alreadyApplied.push({
          subscriptionId: sub.id,
          discountCodes: existingDiscounts,
        });
      }
    }

    // Step 3: if any subscription already has a discount → stop
    if (alreadyApplied.length > 0) {
      log("[Seal] Discount already present on subscription — skipping new discount creation", {
        email,
        alreadyApplied,
      });
      return {
        email,
        subscriptionIds,
        appliedDiscounts: [],
        alreadyApplied,
        message: "discount-already-present",
        success: true,
      };
    }

    // Step 4: resolve which discount code to create / use
    let codeToUse = discountCode;

    if (!codeToUse) {
      if (commissionAmount > 0 && referralId) {
        try {
          codeToUse = await getOrCreateDiscountCode(commissionAmount, referralId, email);
          log("[Seal] Dynamic discount code created", {
            discountCode: codeToUse,
            commissionAmount,
            referralId,
          });
        } catch (discountErr) {
          error("[Seal] Failed to create discount code", {
            email,
            commissionAmount,
            referralId,
            message: discountErr.message,
          });
          throw discountErr;
        }
      }
    }

    if (!codeToUse) {
      log("[Seal] No discount code available — skipping apply", { email });
      return {
        email,
        subscriptionIds,
        appliedDiscounts: [],
        message: "no-discount-code-available",
        success: true,
      };
    }

    // Step 5: apply discount to all ACTIVE subscriptions
    log("[Seal] Applying discount code to subscriptions", {
      email,
      subscriptionIds,
      discountCode: codeToUse,
      commissionAmount,
    });

    const results = [];
    const errors = [];

    for (const subscriptionId of subscriptionIds) {
      try {
        await applyDiscountCode(subscriptionId, codeToUse);
        results.push({ subscriptionId, success: true, discountCode: codeToUse });
        log("[Seal] Discount applied", { subscriptionId, discountCode: codeToUse });
      } catch (err) {
        errors.push({ subscriptionId, error: err.message });
        error("[Seal] Failed to apply discount", {
          subscriptionId,
          discountCode: codeToUse,
          message: err.message,
        });
      }
    }

    log("[Seal] Finished applying discounts", {
      email,
      total: subscriptionIds.length,
      successful: results.length,
      failed: errors.length,
    });

    return {
      email,
      subscriptionIds,
      appliedDiscounts: results,
      errors: errors.length > 0 ? errors : undefined,
      success: errors.length === 0,
      discountCode: codeToUse,
    };
  } catch (err) {
    error("[Seal] Unexpected error in getSubscriptionsAndApplyDiscount", {
      email,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Apply a discount code to a Seal subscription.
 * PUT /subscription-discount-code
 * Payload: { subscription_id, action: "apply", discount_code }
 */
async function applyDiscountCode(subscriptionId, discountCode) {
  if (!discountCode) {
    log("[Seal] No discount code — skipping apply", { subscriptionId });
    return;
  }

  try {
    log("[Seal] Applying discount code to subscription", {
      subscriptionId,
      discountCode,
    });

    const res = await sealApi.put("/subscription-discount-code", {
      subscription_id: subscriptionId,
      action: "apply",
      discount_code: discountCode,
    });

    log("[Seal] Discount code applied successfully", {
      subscriptionId,
      discountCode,
      status: res.status,
    });

    return res.data;
  } catch (err) {
    error("[Seal] Failed to apply discount code", {
      subscriptionId,
      discountCode,
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    throw err;
  }
}

module.exports = {
  sealApi,
  getSubscriptionsByEmail,
  getSubscriptionById,
  extractDiscountDetailsFromSubscription,
  getSubscriptionsAndApplyDiscount,
  applyDiscountCode,
};
