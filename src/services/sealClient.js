const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");

const sealApi = axios.create({
  baseURL: "https://app.sealsubscriptions.com/shopify/merchant/api",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Seal-Token": config.sealApiToken
  },
  timeout: 20000
});

/**
 * Get subscriptions by customer email.
 * GET /subscriptions?query={email}
 * 
 * This function extracts subscription IDs from the Seal API response.
 * The email can come from UpPromote webhook (customer_email field) or UpPromote API.
 * 
 * @param {string} email - Customer email address
 * @returns {Promise<Array>} Array of subscription objects with IDs
 */
async function getSubscriptionsByEmail(email) {
  if (!email) {
    error("[Seal] No email provided to getSubscriptionsByEmail");
    throw new Error("Email is required");
  }

  try {
    log("[Seal] Fetching subscriptions by email", { email });
    
    const res = await sealApi.get("/subscriptions", {
      params: { query: email }
    });

    log("[Seal] Successfully fetched subscriptions", {
      email,
      responseStatus: res.status,
      subscriptionCount: Array.isArray(res.data) ? res.data.length : 0
    });

    // Seal API might return:
    // - An array of subscription objects directly: [{ id: 1, email: "...", ... }, ...]
    // - An object with a subscriptions array: { subscriptions: [...], ... }
    // - A single subscription object: { id: 1, email: "...", ... }
    
    let subscriptions = [];
    
    if (Array.isArray(res.data)) {
      subscriptions = res.data;
    } else if (res.data && Array.isArray(res.data.subscriptions)) {
      subscriptions = res.data.subscriptions;
    } else if (res.data && res.data.id) {
      // Single subscription object
      subscriptions = [res.data];
    } else if (res.data && res.data.data && Array.isArray(res.data.data)) {
      subscriptions = res.data.data;
    }

    // Extract subscription IDs for logging
    const subscriptionIds = subscriptions.map(sub => sub.id).filter(Boolean);
    
    log("[Seal] Extracted subscriptions", {
      email,
      subscriptionIds,
      count: subscriptions.length
    });

    return subscriptions;
  } catch (err) {
    error("[Seal] Failed to fetch subscriptions by email", {
      email,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message
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
  const ids = subscriptions.map(sub => sub.id).filter(Boolean);
  log("[Seal] Extracted subscription IDs", { email, subscriptionIds: ids });
  return ids;
}

/**
 * Get subscriptions by email and apply discount code to all of them.
 * This function:
 * 1. Gets all subscriptions for the given email
 * 2. Extracts subscription IDs from the response
 * 3. Applies discount code to each subscription via /subscription-discount-code API
 * 
 * @param {string} email - Customer email address (from UpPromote webhook or API)
 * @param {string} discountCode - Discount code to apply (optional, uses config if not provided)
 * @returns {Promise<Object>} Object with applied subscription IDs and results
 */
async function getSubscriptionsAndApplyDiscount(email, discountCode = null) {
  if (!email) {
    error("[Seal] No email provided to getSubscriptionsAndApplyDiscount");
    throw new Error("Email is required");
  }

  const codeToUse = discountCode || config.subscriptionDiscountCode;
  
  if (!codeToUse) {
    log("[Seal] No discount code configured, skipping discount application", { email });
    const subscriptions = await getSubscriptionsByEmail(email);
    const ids = subscriptions.map(sub => sub.id).filter(Boolean);
    return {
      email,
      subscriptionIds: ids,
      appliedDiscounts: [],
      message: "No discount code configured"
    };
  }

  try {
    log("[Seal] Getting subscriptions and applying discount", { email, discountCode: codeToUse });
    
    // Get subscriptions by email
    const subscriptions = await getSubscriptionsByEmail(email);
    const subscriptionIds = subscriptions.map(sub => sub.id).filter(Boolean);

    if (subscriptionIds.length === 0) {
      log("[Seal] No subscriptions found for email", { email });
      return {
        email,
        subscriptionIds: [],
        appliedDiscounts: [],
        message: "No subscriptions found"
      };
    }

    log("[Seal] Applying discount code to subscriptions", {
      email,
      subscriptionIds,
      discountCode: codeToUse,
      count: subscriptionIds.length
    });

    // Apply discount code to each subscription
    const results = [];
    const errors = [];

    for (const subscriptionId of subscriptionIds) {
      try {
        // Apply discount code using subscription ID only
        await applyDiscountCode(subscriptionId, codeToUse);
        results.push({
          subscriptionId,
          success: true
        });
        log("[Seal] Successfully applied discount to subscription", {
          email,
          subscriptionId,
          discountCode: codeToUse
        });
      } catch (err) {
        errors.push({
          subscriptionId,
          error: err.message
        });
        error("[Seal] Failed to apply discount to subscription", {
          email,
          subscriptionId,
          discountCode: codeToUse,
          error: err.message
        });
        // Continue with other subscriptions even if one fails
      }
    }

    log("[Seal] Completed applying discounts to subscriptions", {
      email,
      totalSubscriptions: subscriptionIds.length,
      successful: results.length,
      failed: errors.length
    });

    return {
      email,
      subscriptionIds,
      appliedDiscounts: results,
      errors: errors.length > 0 ? errors : undefined,
      success: errors.length === 0
    };
  } catch (err) {
    error("[Seal] Failed to get subscriptions and apply discount", {
      email,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message
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
      subscriptionId
    });
    return;
  }

  const payload = {
    subscription_id: subscriptionId,
    action: "apply",
    discount_code: discountCode
  };

  try {
    log("[Seal] Applying discount code to subscription", {
      subscriptionId,
      discountCode,
      payload
    });
    const res = await sealApi.put("/subscription-discount-code", payload);
    log("[Seal] Successfully applied discount code", {
      subscriptionId,
      discountCode,
      responseStatus: res.status,
      responseData: res.data
    });
    return res.data;
  } catch (err) {
    error("[Seal] Failed to apply discount code", {
      subscriptionId,
      discountCode,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message
    });
    throw err;
  }
}

module.exports = {
  sealApi,
  getSubscriptionsByEmail,
  getSubscriptionIdsByEmail,
  getSubscriptionsAndApplyDiscount,
  applyDiscountCode
};
