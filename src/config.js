require("dotenv").config();

const config = {
  port: process.env.PORT || 3000,
  uppromoteApiKey: process.env.UPPROMOTE_API_KEY,
  sealApiToken: process.env.SEAL_API_TOKEN,
  webhookSharedSecret: process.env.WEBHOOK_SHARED_SECRET,
  subscriptionDiscountCode: process.env.SUBSCRIPTION_DISCOUNT_CODE || null,
  uppromoteWebhookSecret: process.env.UPPROMOTE_WEBHOOK_SECRET,
  // Shopify Admin API settings for dynamic discount creation
  shopifyStore: process.env.SHOPIFY_STORE, // e.g., 'your-store.myshopify.com'
  shopifyAdminApiToken: process.env.SHOPIFY_ADMIN_API_TOKEN,
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2024-01'
};

if (!config.uppromoteApiKey) {
  console.warn("⚠ UPPROMOTE_API_KEY is not set in .env");
}
if (!config.sealApiToken) {
  console.warn("⚠ SEAL_API_TOKEN is not set in .env");
}
if (!config.shopifyStore || !config.shopifyAdminApiToken) {
  console.warn("⚠ Shopify API not configured - dynamic discount creation will use fallback static codes");
  console.warn("  Set SHOPIFY_STORE and SHOPIFY_ADMIN_API_TOKEN for dynamic discount code creation");
}

module.exports = config;
