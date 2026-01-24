const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");
const { getOrCreateDiscountCode } = require("./shopifyClient");

/**
 * Helper function to pick the first active subscription ID from Seal API response.
 * This follows the exact pattern from your previous project.
 * 
 * @param {Object} subscriptionsResponse - The full Seal API response
 * @returns {string|number|null} The ID of the first active subscription or null if none found
 */
function pickActiveSubscriptionId(subscriptionsResponse) {
  // Handle nested payload structure: resp.payload.subscriptions
  const subscriptions = subscriptionsResponse?.payload?.subscriptions || [];
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return null;
  }

  // Find the first active subscription
  const activeSubscription = subscriptions.find(
    (sub) => sub.status === "ACTIVE"
  );

  if (!activeSubscription) {
    return null;
  }

  // Return the subscription ID of the active subscription
  return activeSubscription.id;
}

/**
 * Helper function to get all active subscription IDs from Seal API response.
 * 
 * @param {Object} subscriptionsResponse - The full Seal API response
 * @returns {Array} Array of active subscription IDs
 */
function getAllActiveSubscriptionIds(subscriptionsResponse) {
  // Handle nested payload structure: resp.payload.subscriptions
  const subscriptions = subscriptionsResponse?.payload?.subscriptions || [];
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return [];
  }

  // Filter and return all active subscription IDs
  return subscriptions
    .filter(sub => sub.status === "ACTIVE")
    .map(sub => sub.id)
    .filter(Boolean);
}

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
 * Get subscriptions by customer email.
 * GET /subscriptions?query={email}
 *
 * This function extracts subscription IDs from the Seal API response.
 * The email can come from UpPromote webhook (customer_email field) or UpPromote API.
 *
 * @param {string} email - Customer email address
 * @param {boolean} activeOnly - If true, filter to only active subscriptions (default: true)
 * @returns {Promise<Array>} Array of subscription objects with IDs
 */
async function getSubscriptionsByEmail(email, activeOnly = true) {
  if (!email) {
    error("[Seal] No email provided to getSubscriptionsByEmail");
    throw new Error("Email is required");
  }

  try {
    log("[Seal] Fetching subscriptions by email", { email, activeOnly });

    const res = await sealApi.get("/subscriptions", {
      params: { query: email },
    });

    // Use helper functions to extract subscriptions consistently
    let subscriptions;
    if (activeOnly) {
      // Get only active subscriptions using the helper function
      const activeIds = getAllActiveSubscriptionIds(res.data);
      const allSubscriptions = res?.data?.payload?.subscriptions || [];
      subscriptions = allSubscriptions.filter(sub => activeIds.includes(sub.id));
      
      log("[Seal] Filtered subscriptions by ACTIVE status", {
        email,
        originalCount: allSubscriptions.length,
        activeCount: subscriptions.length,
        filtered: allSubscriptions.length - subscriptions.length,
        allStatuses: allSubscriptions.map(sub => ({ id: sub.id, status: sub.status })),
        activeIds
      });
    } else {
      // Get all subscriptions
      subscriptions = Array.isArray(res?.data?.payload?.subscriptions)
        ? res.data.payload.subscriptions
        : [];
    }

    // ✅ Accurate, meaningful debug log
    log("[Seal] Successfully fetched subscriptions", {
      email,
      responseStatus: res.status,
      hasPayload: Boolean(res?.data?.payload),
      isArrayResponse: Array.isArray(subscriptions),
      subscriptionCount: subscriptions.length,
      subscriptionIds: subscriptions.map(sub => sub.id),
      subscriptionStatuses: subscriptions.map(sub => ({ id: sub.id, status: sub.status }))
    });

    // 🔍 Helpful warning (not an error)
    if (!subscriptions.length) {
      const reason = activeOnly ? "No ACTIVE subscriptions found" : "No subscriptions found";
      log(`[Seal] ${reason} for email`, { email, activeOnly });
    }

    return subscriptions;
  } catch (err) {
    error("[Seal] Failed to fetch subscriptions by email", {
      email,
      status: err.response?.status,
      statusText: err.response?.statusText,
      responseData: err.response?.data,
      message: err.message,
    });
    throw err;
  }
}


/**
 * Get subscription IDs by customer email (helper function).
 * This extracts just the IDs from getSubscriptionsByEmail response.
 *
 * @param {string} email - Customer email address
 * @returns {Promise<Array<string|number>>} Array of subscription IDs
 */
async function getSubscriptionIdsByEmail(email) {
  const subscriptions = await getSubscriptionsByEmail(email);
  const ids = subscriptions.map((sub) => sub.id).filter(Boolean);
  log("[Seal] Extracted subscription IDs", { email, subscriptionIds: ids });
  return ids;
}

/**
 * Get subscriptions by email and apply discount code to all active subscriptions.
 * This function:
 * 1. Gets active subscriptions for the given email
 * 2. Creates or gets appropriate discount code (dynamic or static)
 * 3. Applies discount code to each active subscription via /subscription-discount-code API
 *
 * @param {string} email - Customer email address (from UpPromote webhook or API)
 * @param {string} discountCode - Specific discount code to apply (optional)
 * @param {number} commissionAmount - Commission amount for dynamic discount creation (optional)
 * @param {string} referralId - Referral ID for unique discount code generation (optional)
 * @returns {Promise<Object>} Object with applied subscription IDs and results
 */
async function getSubscriptionsAndApplyDiscount(email, discountCode = null, commissionAmount = 0, referralId = null) {
  if (!email) {
    error("[Seal] No email provided to getSubscriptionsAndApplyDiscount");
    throw new Error("Email is required");
  }

  try {
    log("[Seal] Getting subscriptions and applying discount", {
      email,
      hasDiscountCode: !!discountCode,
      commissionAmount,
      referralId,
    });

    // Get active subscriptions by email
    const subscriptions = await getSubscriptionsByEmail(email, true); // activeOnly = true
    const subscriptionIds = subscriptions.map((sub) => sub.id).filter(Boolean);

    if (subscriptionIds.length === 0) {
      log("[Seal] No ACTIVE subscriptions found for email", { email });
      return {
        email,
        subscriptionIds: [],
        appliedDiscounts: [],
        message: "No ACTIVE subscriptions found",
        success: true, // Not an error - just no subscriptions to process
      };
    }

    // Determine which discount code to use
    let codeToUse = discountCode;
    
    if (!codeToUse) {
      try {
        // Try to create/get dynamic discount code if commission amount is provided
        if (commissionAmount > 0 && referralId) {
          codeToUse = await getOrCreateDiscountCode(commissionAmount, referralId, email);
          log("[Seal] Using dynamic discount code", {
            discountCode: codeToUse,
            commissionAmount,
            referralId
          });
        } else {
          // Fall back to static discount code
          codeToUse = config.subscriptionDiscountCode;
          log("[Seal] Using static discount code", {
            discountCode: codeToUse,
            reason: commissionAmount > 0 ? 'no referralId' : 'no commissionAmount'
          });
        }
      } catch (discountErr) {
        error("[Seal] Failed to get discount code", {
          email,
          commissionAmount,
          referralId,
          error: discountErr.message
        });
        // Fall back to static code
        codeToUse = config.subscriptionDiscountCode;
      }
    }

    if (!codeToUse) {
      log("[Seal] No discount code available, skipping discount application", {
        email,
        subscriptionCount: subscriptionIds.length
      });
      return {
        email,
        subscriptionIds,
        appliedDiscounts: [],
        message: "No discount code configured",
        success: true,
      };
    }

    log("[Seal] Applying discount code to ACTIVE subscriptions", {
      email,
      subscriptionIds,
      discountCode: codeToUse,
      count: subscriptionIds.length,
      commissionAmount
    });

    // Apply discount code to each active subscription
    const results = [];
    const errors = [];

    for (const subscriptionId of subscriptionIds) {
      try {
        // Apply discount code using subscription ID only
        await applyDiscountCode(subscriptionId, codeToUse);
        results.push({
          subscriptionId,
          success: true,
          discountCode: codeToUse
        });
        log("[Seal] Successfully applied discount to subscription", {
          email,
          subscriptionId,
          discountCode: codeToUse,
          commissionAmount
        });
      } catch (err) {
        errors.push({
          subscriptionId,
          error: err.message,
          discountCode: codeToUse
        });
        error("[Seal] Failed to apply discount to subscription", {
          email,
          subscriptionId,
          discountCode: codeToUse,
          error: err.message,
        });
        // Continue with other subscriptions even if one fails
      }
    }

    log("[Seal] Completed applying discounts to subscriptions", {
      email,
      totalSubscriptions: subscriptionIds.length,
      successful: results.length,
      failed: errors.length,
      discountCode: codeToUse,
      commissionAmount
    });

    return {
      email,
      subscriptionIds,
      appliedDiscounts: results,
      errors: errors.length > 0 ? errors : undefined,
      success: errors.length === 0,
      discountCode: codeToUse
    };
  } catch (err) {
    error("[Seal] Failed to get subscriptions and apply discount", {
      email,
      commissionAmount,
      referralId,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Apply a discount code to a subscription.
 * PUT /subscription-discount-code { subscription_id, action: "apply", discount_code }
 *
 * IMPORTANT:
 * - The discount code must exist in Shopify and support subscriptions.
 * - You control the value (fixed or %) when you create the code.
 *
 * @param {string|number} subscriptionId - Subscription ID
 * @param {string} discountCode - Discount code to apply
 */
async function applyDiscountCode(subscriptionId, discountCode) {
  if (!discountCode) {
    log("[Seal] No discount code configured, skipping discount apply", {
      subscriptionId,
    });
    return;
  }

  const payload = {
    subscription_id: subscriptionId,
    action: "apply",
    discount_code: discountCode,
  };

  try {
    log("[Seal] Applying discount code to subscription", {
      subscriptionId,
      discountCode,
      payload,
    });
    const res = await sealApi.put("/subscription-discount-code", payload);
    log("[Seal] Successfully applied discount code", {
      subscriptionId,
      discountCode,
      responseStatus: res.status,
      responseData: res.data,
    });
    return res.data;
  } catch (err) {
    error("[Seal] Failed to apply discount code", {
      subscriptionId,
      discountCode,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message,
    });
    throw err;
  }
}

module.exports = {
  sealApi,
  getSubscriptionsByEmail,
  getSubscriptionIdsByEmail,
  getSubscriptionsAndApplyDiscount,
  applyDiscountCode,
  pickActiveSubscriptionId,
  getAllActiveSubscriptionIds,
};
