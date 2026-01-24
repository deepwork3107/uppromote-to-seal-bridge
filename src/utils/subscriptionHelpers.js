const { pickActiveSubscriptionId, getAllActiveSubscriptionIds } = require("../services/sealClient");
const { log } = require("./logger");

/**
 * Example usage of the pickActiveSubscriptionId function from your previous project.
 * This shows how to get just the first active subscription ID when you only need one.
 */
async function getFirstActiveSubscriptionForCustomer(sealApiResponse, customerEmail) {
  // Use your existing pattern to get the first active subscription ID
  const activeSubscriptionId = pickActiveSubscriptionId(sealApiResponse);
  
  if (!activeSubscriptionId) {
    log("[SubscriptionHelper] No ACTIVE subscription found for customer", { 
      customerEmail,
      hasResponse: !!sealApiResponse,
      hasPayload: !!sealApiResponse?.payload,
      subscriptionCount: sealApiResponse?.payload?.subscriptions?.length || 0
    });
    return null;
  }

  log("[SubscriptionHelper] Found active subscription for customer", {
    customerEmail,
    activeSubscriptionId
  });

  return activeSubscriptionId;
}

/**
 * Example usage of getAllActiveSubscriptionIds for when you need all active subscriptions.
 */
async function getAllActiveSubscriptionsForCustomer(sealApiResponse, customerEmail) {
  // Get all active subscription IDs
  const activeSubscriptionIds = getAllActiveSubscriptionIds(sealApiResponse);
  
  log("[SubscriptionHelper] Found active subscriptions for customer", {
    customerEmail,
    activeSubscriptionIds,
    count: activeSubscriptionIds.length
  });

  return activeSubscriptionIds;
}

/**
 * Compare the different approaches:
 * - pickActiveSubscriptionId: Gets first ACTIVE subscription (your previous project pattern)
 * - getAllActiveSubscriptionIds: Gets all ACTIVE subscriptions (current integration needs)
 */
function compareSubscriptionMethods(sealApiResponse, customerEmail) {
  const firstActive = pickActiveSubscriptionId(sealApiResponse);
  const allActive = getAllActiveSubscriptionIds(sealApiResponse);
  
  log("[SubscriptionHelper] Subscription method comparison", {
    customerEmail,
    firstActiveId: firstActive,
    allActiveIds: allActive,
    useFirstWhen: "You only need to apply discount to one subscription",
    useAllWhen: "You want to apply discount to all customer subscriptions (current setup)"
  });
  
  return {
    firstActive,
    allActive,
    hasAnyActive: allActive.length > 0
  };
}

module.exports = {
  getFirstActiveSubscriptionForCustomer,
  getAllActiveSubscriptionsForCustomer,
  compareSubscriptionMethods
};