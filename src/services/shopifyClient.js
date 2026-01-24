const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");

let shopifyApi = null;

// Initialize Shopify API client if credentials are available
if (config.shopifyStore && config.shopifyAdminApiToken) {
  shopifyApi = axios.create({
    baseURL: `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}`,
    headers: {
      'X-Shopify-Access-Token': config.shopifyAdminApiToken,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

/**
 * Create a dynamic discount code in Shopify with a specific fixed amount.
 * This creates a one-time use discount code that matches the commission amount.
 * 
 * @param {number} discountAmount - The fixed discount amount (e.g., 18.00)
 * @param {string} referralId - The referral ID from UpPromote for unique code generation
 * @param {string} customerEmail - Customer email for tracking
 * @returns {Promise<string>} The created discount code
 */
async function createDynamicDiscountCode(discountAmount, referralId, customerEmail) {
  if (!shopifyApi) {
    throw new Error("Shopify API not configured - missing SHOPIFY_STORE or SHOPIFY_ADMIN_API_TOKEN");
  }

  if (!discountAmount || discountAmount <= 0) {
    throw new Error("Invalid discount amount");
  }

  const discountCode = `AFFILIATE-${referralId}`;
  
  const discountData = {
    price_rule: {
      title: `Affiliate Credit - Referral ${referralId}`,
      target_type: "line_item",
      target_selection: "all",
      allocation_method: "across",
      value_type: "fixed_amount",
      value: `-${discountAmount}`, // Negative value for discount
      customer_selection: "all",
      usage_limit: 1, // One-time use
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)).toISOString(), // Valid for 1 year
      entitled_product_ids: [],
      entitled_variant_ids: [],
      entitled_collection_ids: [],
      entitled_country_ids: [],
    }
  };

  try {
    log("[Shopify] Creating dynamic discount price rule", {
      discountAmount,
      referralId,
      customerEmail,
      discountCode
    });

    // 1. Create the price rule
    const priceRuleResponse = await shopifyApi.post('/price_rules.json', discountData);
    const priceRuleId = priceRuleResponse.data.price_rule.id;

    log("[Shopify] Price rule created successfully", {
      priceRuleId,
      discountAmount,
      referralId
    });

    // 2. Create the discount code for this price rule
    const discountCodeData = {
      discount_code: {
        code: discountCode,
        usage_count: 0
      }
    };

    const discountCodeResponse = await shopifyApi.post(
      `/price_rules/${priceRuleId}/discount_codes.json`,
      discountCodeData
    );

    log("[Shopify] Discount code created successfully", {
      discountCode,
      priceRuleId,
      discountAmount,
      referralId,
      customerEmail
    });

    return discountCode;

  } catch (err) {
    error("[Shopify] Failed to create dynamic discount code", {
      discountAmount,
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
 * 
 * @param {string} discountCode - The discount code to check
 * @returns {Promise<boolean>} True if the code exists
 */
async function discountCodeExists(discountCode) {
  if (!shopifyApi) {
    log("[Shopify] API not configured, assuming discount code doesn't exist");
    return false;
  }

  try {
    // Search for discount codes
    const response = await shopifyApi.get('/discount_codes.json', {
      params: { code: discountCode }
    });
    
    const exists = response.data.discount_codes && response.data.discount_codes.length > 0;
    log("[Shopify] Discount code existence check", { discountCode, exists });
    return exists;
  } catch (err) {
    log("[Shopify] Error checking discount code existence", {
      discountCode,
      error: err.message
    });
    return false;
  }
}

/**
 * Get or create a discount code for the given commission amount.
 * If Shopify API is configured, creates a dynamic discount.
 * Otherwise, falls back to the static discount code from config.
 * 
 * @param {number} commissionAmount - The commission amount to create discount for
 * @param {string} referralId - The referral ID for unique code generation
 * @param {string} customerEmail - Customer email for tracking
 * @returns {Promise<string>} The discount code to use
 */
async function getOrCreateDiscountCode(commissionAmount, referralId, customerEmail) {
  // If Shopify API is configured, create dynamic discount
  if (shopifyApi && commissionAmount > 0) {
    try {
      return await createDynamicDiscountCode(commissionAmount, referralId, customerEmail);
    } catch (err) {
      error("[Shopify] Failed to create dynamic discount, falling back to static code", {
        commissionAmount,
        referralId,
        error: err.message
      });
      // Fall through to static code fallback
    }
  }

  // Fallback to static discount code from configuration
  const staticCode = config.subscriptionDiscountCode;
  if (!staticCode) {
    throw new Error("No discount code available - neither dynamic creation nor static code configured");
  }

  log("[Shopify] Using static discount code fallback", {
    discountCode: staticCode,
    commissionAmount,
    referralId
  });

  return staticCode;
}

module.exports = {
  createDynamicDiscountCode,
  discountCodeExists,
  getOrCreateDiscountCode,
  isShopifyConfigured: !!shopifyApi
};