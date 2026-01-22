require("dotenv").config();

const config = {
  port: process.env.PORT || 3000,
  uppromoteApiKey: process.env.UPPROMOTE_API_KEY,
  sealApiToken: process.env.SEAL_API_TOKEN,
  webhookSharedSecret: process.env.WEBHOOK_SHARED_SECRET,
  subscriptionDiscountCode: process.env.SUBSCRIPTION_DISCOUNT_CODE || null,
  uppromoteWebhookSecret: process.env.UPPROMOTE_WEBHOOK_SECRET
};

if (!config.uppromoteApiKey) {
  console.warn("⚠ UPPROMOTE_API_KEY is not set in .env");
}
if (!config.sealApiToken) {
  console.warn("⚠ SEAL_API_TOKEN is not set in .env");
}

module.exports = config;
