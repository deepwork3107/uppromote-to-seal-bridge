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
 * Retrieve a subscription by ID (helper).
 * GET /subscription?id=12345 :contentReference[oaicite:6]{index=6}
 */
async function getSubscriptionById(subscriptionId) {
  try {
    log("[Seal] Fetching subscription", { subscriptionId });
    const res = await sealApi.get("/subscription", {
      params: { id: subscriptionId }
    });
    log("[Seal] Successfully fetched subscription", {
      subscriptionId,
      responseStatus: res.status
    });
    return res.data;
  } catch (err) {
    error("[Seal] Failed to fetch subscription", {
      subscriptionId,
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
 * PUT /subscription-discount-code { subscription_id, action: "apply", discount_code } :contentReference[oaicite:7]{index=7}
 *
 * IMPORTANT:
 * - The discount code must exist in Shopify and support subscriptions.
 * - You control the value (fixed or %) when you create the code.
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
  getSubscriptionById,
  applyDiscountCode
};
