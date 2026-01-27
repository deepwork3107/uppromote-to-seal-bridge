// src/services/shopifyClient.js
const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");

// -----------------------------------------------------------------------------
// Shopify GraphQL client setup
// -----------------------------------------------------------------------------

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
  log(
    "[Shopify] GraphQL client NOT configured – dynamic discounts are disabled",
    {
      shopifyStore: config.shopifyStore || "missing",
      shopifyAdminApiToken: config.shopifyAdminApiToken ? "set" : "missing",
    },
  );
}

// -----------------------------------------------------------------------------
// Core: create a per-referral discount code using GraphQL
// -----------------------------------------------------------------------------

/**
 * Create a dynamic order-level fixed-amount discount code in Shopify
 * using the Admin GraphQL API (discountCodeBasicCreate).
 *
 * This returns a normal discount code the store can use anywhere
 * (including Seal subscriptions), like: AFFILIATE-26008232.
 *
 * @param {number} commissionAmount - the commission amount (e.g. 30 => $30 off)
 * @param {string|number} referralId - UpPromote referral id for uniqueness
 * @param {string} customerEmail - for logging only (discount is not restricted)
 * @returns {Promise<string>} discountCode
 */
async function createDynamicDiscountCode(
  commissionAmount,
  referralId,
  customerEmail,
) {
  if (!shopifyGraphql) {
    throw new Error("Shopify GraphQL not configured");
  }

  const amountNumber = Number(commissionAmount);
  if (!amountNumber || amountNumber <= 0) {
    throw new Error(
      `Invalid commission amount for discount: ${commissionAmount}`,
    );
  }

  const discountCode = `AFFILIATE-${referralId}`;
  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year validity

  // GraphQL mutation from Shopify docs (discountCodeBasicCreate)
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            __typename
          }
        }
        userErrors {
          field
          code
          message
        }
      }
    }
  `;

  // Build the DiscountCodeBasicInput
  const variables = {
    basicCodeDiscount: {
      title: `Affiliate Credit - Referral ${referralId}`,
      code: discountCode,

      // Time window
      startsAt: now.toISOString(),
      // endsAt: oneYearFromNow.toISOString(),

      // One use per customer / in total (you can adjust if you want)
      usageLimit: 1,
      appliesOncePerCustomer: true,

      // All customers + all items, order-level discount
      customerSelection: {
        all: true,
      },
      customerGets: {
        items: {
          all: true,
        },
        appliesOnSubscription: true,
        appliesOnOneTimePurchase: true,
        value: {
          discountAmount: {
            amount: amountNumber.toFixed(2), // as string
            appliesOnEachItem: false,
          },
        },
      },

      // Allow combining if you want; safe defaults
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true,
      },
    },
  };

  try {
    log("[Shopify] Creating GraphQL basic discount code", {
      discountCode,
      amount: amountNumber.toFixed(2),
      referralId,
      customerEmail,
    });

    const response = await shopifyGraphql.post("", {
      query: mutation,
      variables,
    });

    const payload =
      response.data &&
      response.data.data &&
      response.data.data.discountCodeBasicCreate;

    const userErrors = payload?.userErrors || [];
    if (userErrors.length) {
      error("[Shopify] discountCodeBasicCreate userErrors", {
        discountCode,
        referralId,
        userErrors,
      });

      const msg = userErrors.map((e) => e.message).join("; ");
      throw new Error("Shopify discountCodeBasicCreate failed: " + msg);
    }

    const nodeId = payload?.codeDiscountNode?.id;
    log("[Shopify] GraphQL discount code created", {
      discountCode,
      nodeId,
      referralId,
      amount: amountNumber.toFixed(2),
    });

    return discountCode;
  } catch (err) {
    error("[Shopify] Failed to create GraphQL dynamic discount", {
      discountCode,
      referralId,
      commissionAmount: amountNumber,
      message: err.message,
      stack: err.stack,
      responseData: err.response?.data,
    });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Optional helper: check if a code exists (used rarely, but kept for API parity)
// -----------------------------------------------------------------------------

/**
 * Check if a discount code already exists using codeDiscountNodes search.
 * Not strictly required for the bridge, but can be useful.
 *
 * @param {string} discountCode
 * @returns {Promise<boolean>}
 */
async function discountCodeExists(discountCode) {
  if (!shopifyGraphql) {
    log("[Shopify] GraphQL not configured, discountCodeExists -> false", {
      discountCode,
    });
    return false;
  }

  const query = `
    query codeDiscountNodeSearch($query: String!) {
      codeDiscountNodes(first: 1, query: $query) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  try {
    const resp = await shopifyGraphql.post("", {
      query,
      variables: { query: `code:${discountCode}` },
    });

    const edges = resp.data?.data?.codeDiscountNodes?.edges || [];

    const exists = edges.length > 0;
    log("[Shopify] discountCodeExists", { discountCode, exists });
    return exists;
  } catch (err) {
    error("[Shopify] discountCodeExists error", {
      discountCode,
      message: err.message,
      responseData: err.response?.data,
    });
    return false;
  }
}

// -----------------------------------------------------------------------------
// Public API used by the rest of your app
// -----------------------------------------------------------------------------

/**
 * Public function used by UpPromote → Seal flow.
 * With Option 2 we *always* create a dynamic code – no static fallback.
 *
 * @param {number} commissionAmount
 * @param {string|number} referralId
 * @param {string} customerEmail
 * @returns {Promise<string>}
 */
async function getOrCreateDiscountCode(
  commissionAmount,
  referralId,
  customerEmail,
) {
  // Always create a fresh code per referral
  return createDynamicDiscountCode(commissionAmount, referralId, customerEmail);
}

module.exports = {
  createDynamicDiscountCode,
  discountCodeExists,
  getOrCreateDiscountCode,
  isShopifyConfigured,
};
