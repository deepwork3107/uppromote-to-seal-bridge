const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");
const { sendDiscountCodeEmail } = require("./emailService");

const isShopifyConfigured =
  !!config.shopifyStore && !!config.shopifyAdminApiToken;

let shopifyGraphql = null;

if (isShopifyConfigured) {
  shopifyGraphql = axios.create({
    baseURL: `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}/graphql.json`,
    headers: {
      "X-Shopify-Access-Token": config.shopifyAdminApiToken,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  log("[Shopify] GraphQL client configured", {
    store: config.shopifyStore,
    apiVersion: config.shopifyApiVersion,
  });
} else {
  log("[Shopify] GraphQL client NOT configured — dynamic discounts are disabled", {
    shopifyStore: config.shopifyStore || "missing",
    shopifyAdminApiToken: config.shopifyAdminApiToken ? "set" : "missing",
  });
}

/**
 * Create a per-referral fixed-amount discount code in Shopify using
 * the Admin GraphQL API (discountCodeBasicCreate), then email the code
 * to the affiliate.
 *
 * Code format: AFFILIATE-{referralId}
 * Amount:      fixed, equals the UpPromote commission
 */
async function createDynamicDiscountCode(commissionAmount, referralId, customerEmail) {
  if (!shopifyGraphql) {
    throw new Error("Shopify GraphQL not configured");
  }

  const amount = Number(commissionAmount);
  if (!amount || amount <= 0) {
    throw new Error(`Invalid commission amount: ${commissionAmount}`);
  }

  const discountCode = `AFFILIATE-${referralId}`;

  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount { __typename }
        }
        userErrors { field code message }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `Affiliate Credit - Referral ${referralId}`,
      code: discountCode,
      startsAt: new Date().toISOString(),
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerSelection: { all: true },
      customerGets: {
        items: { all: true },
        appliesOnSubscription: true,
        appliesOnOneTimePurchase: true,
        value: {
          discountAmount: {
            amount: amount.toFixed(2),
            appliesOnEachItem: false,
          },
        },
      },
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true,
      },
    },
  };

  try {
    log("[Shopify] Creating discount code", {
      discountCode,
      amount: amount.toFixed(2),
      referralId,
      customerEmail,
    });

    const response = await shopifyGraphql.post("", { query: mutation, variables });

    const payload = response.data?.data?.discountCodeBasicCreate;
    const userErrors = payload?.userErrors || [];

    if (userErrors.length) {
      const msg = userErrors.map((e) => e.message).join("; ");
      error("[Shopify] discountCodeBasicCreate userErrors", { discountCode, userErrors });
      throw new Error("Shopify discount creation failed: " + msg);
    }

    log("[Shopify] Discount code created", {
      discountCode,
      nodeId: payload?.codeDiscountNode?.id,
      amount: amount.toFixed(2),
      referralId,
    });

    // Send email to affiliate with the discount code
    if (customerEmail) {
      await sendDiscountCodeEmail({
        to: customerEmail,
        discountCode,
        amount: amount.toFixed(2),
        referralId: String(referralId),
      });
    }

    return discountCode;
  } catch (err) {
    error("[Shopify] Failed to create discount code", {
      discountCode,
      referralId,
      message: err.message,
      responseData: err.response?.data,
    });
    throw err;
  }
}

/**
 * Public entry point for the UpPromote → Seal flow.
 * Always creates a fresh code per referral.
 */
async function getOrCreateDiscountCode(commissionAmount, referralId, customerEmail) {
  return createDynamicDiscountCode(commissionAmount, referralId, customerEmail);
}

module.exports = {
  createDynamicDiscountCode,
  getOrCreateDiscountCode,
  isShopifyConfigured,
};
