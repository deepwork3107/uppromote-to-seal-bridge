const { log, error } = require("../utils/logger");
const { addReferralAdjustment } = require("./upPromoteClient");

/**
 * In-memory storage (replace with real DB in production)
 */
const referralCredits = new Map(); // referralId -> { referralId, affiliateId, affiliateEmail, customerEmail, remainingCommission }
const customerToReferrals = new Map(); // customerEmail -> Set(referralIds)

/**
 * Store credit when a referral is approved.
 * payload = UpPromote "referral approved" webhook body. :contentReference[oaicite:8]{index=8}
 */
function storeReferralCredit(payload) {
  log("[CreditService] Storing referral credit", { payload });
  
  const referralId = payload.id;
  const affiliateId = payload.affiliate?.id;
  const affiliateEmail = payload.affiliate?.email;
  const customerEmail = payload.customer_email;
  const commission = parseFloat(payload.commission || "0");

  if (!referralId || !customerEmail || isNaN(commission)) {
    error("[CreditService] Missing data in referral payload, skipping credit store", {
      referralId: referralId || "missing",
      customerEmail: customerEmail || "missing",
      commission: isNaN(commission) ? "invalid" : commission
    });
    return;
  }

  const record = {
    referralId,
    affiliateId,
    affiliateEmail,
    customerEmail,
    remainingCommission: commission
  };

  const existingRecord = referralCredits.get(referralId);
  if (existingRecord) {
    log("[CreditService] Updating existing referral credit", {
      referralId,
      oldCommission: existingRecord.remainingCommission,
      newCommission: commission
    });
  }

  referralCredits.set(referralId, record);

  if (!customerToReferrals.has(customerEmail)) {
    customerToReferrals.set(customerEmail, new Set());
    log("[CreditService] Created new customer entry", { customerEmail });
  }
  customerToReferrals.get(customerEmail).add(referralId);

  log("[CreditService] Successfully stored referral credit", {
    ...record,
    totalReferralsForCustomer: customerToReferrals.get(customerEmail).size
  });
}

/**
 * Get total credit for a given customer email.
 */
function getTotalCreditForCustomer(customerEmail) {
  log("[CreditService] Getting total credit for customer", { customerEmail });
  
  const ids = customerToReferrals.get(customerEmail);
  if (!ids || ids.size === 0) {
    log("[CreditService] No referrals found for customer", { customerEmail });
    return 0;
  }

  let total = 0;
  const referralDetails = [];
  for (const id of ids) {
    const rec = referralCredits.get(id);
    if (rec) {
      total += rec.remainingCommission;
      referralDetails.push({
        referralId: id,
        remainingCommission: rec.remainingCommission
      });
    }
  }
  
  log("[CreditService] Total credit calculated", {
    customerEmail,
    totalCredit: total,
    referralCount: ids.size,
    referralDetails
  });
  
  return total;
}

/**
 * Consume credit up to "amount" for the given customer email.
 * Returns the amount actually used and details per referral.
 *
 * This function ALSO calls UpPromote API to add negative referral adjustments,
 * so affiliate's balance decreases by the used credit. :contentReference[oaicite:9]{index=9}
 */
async function consumeCreditForCustomer(customerEmail, amountToUse) {
  log("[CreditService] Starting credit consumption", {
    customerEmail,
    amountToUse
  });

  const ids = customerToReferrals.get(customerEmail);
  if (!ids || ids.size === 0) {
    log("[CreditService] No referrals found for customer, cannot consume credit", {
      customerEmail
    });
    return { used: 0, breakdown: [] };
  }

  let remainingToUse = amountToUse;
  const breakdown = [];

  log("[CreditService] Processing referrals for credit consumption", {
    customerEmail,
    referralIds: Array.from(ids),
    amountToUse
  });

  for (const id of ids) {
    if (remainingToUse <= 0) {
      log("[CreditService] Credit consumption complete, remaining amount is 0");
      break;
    }

    const rec = referralCredits.get(id);
    if (!rec || rec.remainingCommission <= 0) {
      log("[CreditService] Skipping referral (no remaining commission)", {
        referralId: id,
        remainingCommission: rec?.remainingCommission || 0
      });
      continue;
    }

    const use = Math.min(rec.remainingCommission, remainingToUse);
    const beforeCommission = rec.remainingCommission;

    log("[CreditService] Consuming credit from referral", {
      referralId: id,
      use,
      beforeCommission,
      afterCommission: beforeCommission - use
    });

    // Update local record
    rec.remainingCommission -= use;
    referralCredits.set(id, rec);

    // Call UpPromote to reduce commission (negative adjustment)
    try {
      await addReferralAdjustment(id, -use);
      log("[CreditService] Successfully added UpPromote adjustment", {
        referralId: id,
        adjustment: -use
      });
    } catch (err) {
      error("[CreditService] Failed to add UpPromote adjustment, rolling back local change", {
        referralId: id,
        adjustment: -use,
        error: err.message
      });
      // Rollback local change
      rec.remainingCommission += use;
      referralCredits.set(id, rec);
      throw err;
    }

    breakdown.push({
      referralId: id,
      used: use
    });

    remainingToUse -= use;
  }

  const used = amountToUse - remainingToUse;
  log("[CreditService] Credit consumption completed", {
    customerEmail,
    requested: amountToUse,
    used,
    remaining: remainingToUse,
    breakdown
  });

  return { used, breakdown };
}

module.exports = {
  storeReferralCredit,
  getTotalCreditForCustomer,
  consumeCreditForCustomer
};
