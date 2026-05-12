require("dotenv").config();

const config = {
  port: process.env.PORT || 3000,
  uppromoteApiKey: process.env.UPPROMOTE_API_KEY,
  sealApiToken: process.env.SEAL_API_TOKEN,
  webhookSharedSecret: process.env.WEBHOOK_SHARED_SECRET,
  uppromoteWebhookSecret: process.env.UPPROMOTE_WEBHOOK_SECRET,

  // Shopify Admin API — required for dynamic discount code creation
  shopifyStore: process.env.SHOPIFY_STORE,
  shopifyAdminApiToken:
    process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || "2024-01",

  // SMTP — required for sending discount code emails to affiliates
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpSecure: process.env.SMTP_SECURE || "false",
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpAppPassword: process.env.SMTP_APP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM,
  discountEmailSubject: process.env.DISCOUNT_EMAIL_SUBJECT,

  // Optional: set to enable POST /debug/send-test-email (local testing only)
  emailTestRouteSecret: process.env.EMAIL_TEST_ROUTE_SECRET || null,
};

if (!config.uppromoteApiKey) console.warn("⚠ UPPROMOTE_API_KEY is not set");
if (!config.sealApiToken) console.warn("⚠ SEAL_API_TOKEN is not set");
if (!config.shopifyStore || !config.shopifyAdminApiToken) {
  console.warn("⚠ Shopify API not configured — set SHOPIFY_STORE and SHOPIFY_ADMIN_API_TOKEN");
}

module.exports = config;
