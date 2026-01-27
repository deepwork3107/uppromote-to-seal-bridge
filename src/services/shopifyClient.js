// src/services/shopifyClient.js
const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");

let shopifyApi = null;

// Initialize Shopify API client if credentials are available
if (config.shopifyStore && config.shopifyAdminApiToken) {
  shopifyApi = axios.create({
    baseURL: `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}`,
    headers: {
      "X-Shopify-Access-Token": config.shopifyAdminApiToken,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  log("[Shopify] API client configured", {
    store: config.shopifyStore,
    apiVersion: config.shopifyApiVersion,
  });
} else {
  log("[Shopify] API client NOT configured (missing store or admin token)");
}

/**
 * Create a dynamic discount code in Shopify with a specific fixed amount.
 * This creates a price rule + one-time discount code that matches the commission amount.
 *
 * @param {number} discountAmount - The fixed discount amount (e.g., 18.00)
 * @param {string|number} referralId - The referral ID from UpPromote for unique code generation
 * @param {string} customerEmail - Email (used only for logging / title)
 * @returns {Promise<string>} The created discount code (e.g. "AFFILIATE-26005704")
 */
async function createDynamicDiscountCode(discountAmount, referralId, customerEmail) {
  if (!shopifyApi) {
    throw new Error(
      "Shopify API not configured - missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_TOKEN"
    );
  }

  const amount = Number(discountAmount);
  if (!amount || amount <= 0) {
    throw new Error("Invalid discount amount");
  }

  const discountCode = `AFFILIATE-${referralId}`;

  const discountData = {
    price_rule: {
      title: `Affiliate Credit - Referral ${referralId} (${customerEmail || "unknown"})`,
      target_type: "line_item",
      target_selection: "all",
      allocation_method: "across",
      value_type: "fixed_amount",
      // Shopify expects a NEGATIVE number for a discount value
      value: `-${amount}`,
      customer_selection: "all",
      usage_limit: 1, // One-time use
      starts_at: new Date().toISOString(),
      // Valid for 1 year
      // ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      // entitled_product_ids: [],
      // entitled_variant_ids: [],
      // entitled_collection_ids: [],
      // entitled_country_ids: [],
    },
  };

  try {
    log("[Shopify] Creating dynamic discount price rule", {
      discountAmount: amount,
      referralId,
      customerEmail,
      discountCode,
    });

    // 1. Create the price rule
    const priceRuleResponse = await shopifyApi.post("/price_rules.json", discountData);
    const priceRuleId = priceRuleResponse.data.price_rule.id;

    log("[Shopify] Price rule created successfully", {
      priceRuleId,
      discountAmount: amount,
      referralId,
    });

    // 2. Create the discount code for this price rule
    const discountCodeData = {
      discount_code: {
        code: discountCode,
      },
    };

    const discountCodeResponse = await shopifyApi.post(
      `/price_rules/${priceRuleId}/discount_codes.json`,
      discountCodeData
    );

    log("[Shopify] Discount code created successfully", {
      discountCode,
      priceRuleId,
      discountAmount: amount,
      referralId,
      customerEmail,
      apiResponse: discountCodeResponse.data,
    });

    return discountCode;
  } catch (err) {
    error("[Shopify] Failed to create dynamic discount code", {
      discountAmount: amount,
      referralId,
      customerEmail,
      status: err.response?.status,
      statusText: err.response?.statusText,
      responseData: err.response?.data,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Check if a discount code exists in Shopify.
 * Uses /discount_codes/lookup.json (optional helper).
 *
 * @param {string} discountCode
 * @returns {Promise<boolean>}
 */
async function discountCodeExists(discountCode) {
  if (!shopifyApi) {
    log("[Shopify] API not configured, assuming discount code doesn't exist");
    return false;
  }

  if (!discountCode) return false;

  try {
    const response = await shopifyApi.get("/discount_codes/lookup.json", {
      params: { code: discountCode },
    });

    const exists = !!response.data?.discount_code;
    log("[Shopify] Discount code existence check", { discountCode, exists });
    return exists;
  } catch (err) {
    if (err.response?.status === 404) {
      log("[Shopify] Discount code not found", { discountCode });
      return false;
    }

    log("[Shopify] Error checking discount code existence", {
      discountCode,
      status: err.response?.status,
      message: err.message,
    });
    return false;
  }
}

/**
 * Always create a new dynamic discount code for this commission.
 * No static fallback.
 *
 * @param {number} commissionAmount
 * @param {string|number} referralId
 * @param {string} customerEmail
 * @returns {Promise<string>} discountCode
 */
async function getOrCreateDiscountCode(commissionAmount, referralId, customerEmail) {
  const amount = Number(commissionAmount);

  if (!shopifyApi) {
    throw new Error("Shopify API not configured");
  }
  if (!amount || amount <= 0) {
    throw new Error("Invalid commission amount for discount creation");
  }

  // Right now we always create a fresh dynamic code per referral
  return await createDynamicDiscountCode(amount, referralId, customerEmail);
}

module.exports = {
  createDynamicDiscountCode,
  discountCodeExists,
  getOrCreateDiscountCode,
  isShopifyConfigured: !!shopifyApi,
};
