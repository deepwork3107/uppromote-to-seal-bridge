// src/services/creditService.js
const { log, error } = require("../utils/logger");
const { addReferralAdjustment } = require("./upPromoteClient");

// In–memory storage
// referralId -> record
const referralCredits = new Map();
// customerEmail (or fallback email) -> Set(referralIds)
const customerToReferrals = new Map();

/**
 * Try to extract an email from the UpPromote referral payload.
 * Priority:
 * 1) customer_email
 * 2) payload.customer.email (if they ever add it)
 * 3) payload.email
 * 4) affiliate.email (fallback – what you asked for)
 */
function extractEmailFromReferral(payload) {
  const affiliateEmail = payload.affiliate?.email || null;
  const customerEmail = payload.customer_email || null;
  const customerObjectEmail = payload.customer?.email || null;
  const genericEmail = payload.email || null;

  log("[UpPromote] Available email fields in webhook", {
    affiliate_email: affiliateEmail,
    customer_email: customerEmail,
    customer_object_email: customerObjectEmail,
    email: genericEmail,
    referralId: payload.id,
  });

  let email = customerEmail || customerObjectEmail || genericEmail;

  let source = "none";

  if (email) {
    if (email === customerEmail) source = "customer_email";
    else if (email === customerObjectEmail) source = "customer.email";
    else if (email === genericEmail) source = "email";
  } else if (affiliateEmail) {
    // 👉 Fallback when no customer email is provided
    email = affiliateEmail;
    source = "affiliate.email";
  }

  if (email) {
    log("[UpPromote] Extracted email from webhook", {
      email,
      referralId: payload.id,
      source,
      commissionAmount: payload.commission,
    });
  } else {
    log("[UpPromote] Could not extract any email from webhook", {
      referralId: payload.id,
    });
  }

  return email;
}

/**
 * Store credit when a referral is approved.
 * Called from the UpPromote webhook handler.
 */
function storeReferralCredit(payload) {
  try {
    log("[CreditService] Storing referral credit", { payload });

    const referralId = payload.id;
    const commissionRaw = payload.commission || payload.commission_amount || "0";
    const commission = parseFloat(commissionRaw);

    const email = extractEmailFromReferral(payload);

    if (!referralId || isNaN(commission)) {
      error("[CreditService] Missing referralId or commission, skipping credit store", {
        referralId,
        commission: commissionRaw,
      });
      return;
    }

    if (!email) {
      // Even with fallback we found no email – truly unusable
      error(
        "[CreditService] No usable email in referral payload, skipping credit store",
        {
          referralId,
          commission,
        }
      );
      return;
    }

    const customerEmail = email;
    const record = {
      referralId,
      affiliateId: payload.affiliate?.id || null,
      affiliateEmail: payload.affiliate?.email || null,
      customerEmail,
      remainingCommission: commission,
      createdAt: payload.created_at || new Date().toISOString(),
    };

    if (!customerToReferrals.has(customerEmail)) {
      customerToReferrals.set(customerEmail, new Set());
      log("[CreditService] Created new customer entry", { customerEmail });
    }

    customerToReferrals.get(customerEmail).add(referralId);
    referralCredits.set(referralId, record);

    log("[CreditService] Successfully stored referral credit", {
      ...record,
      totalReferralsForCustomer: customerToReferrals.get(customerEmail).size,
    });
  } catch (err) {
    error("[CreditService] Error in storeReferralCredit:", err);
  }
}

/**
 * Compute total available credit for a customer (or affiliate fallback email).
 */
function getTotalCreditForCustomer(customerEmail) {
  const ids = customerToReferrals.get(customerEmail);
  if (!ids || ids.size === 0) {
    log("[CreditService] No referrals for customer", { customerEmail });
    return 0;
  }

  let total = 0;
  for (const id of ids) {
    const rec = referralCredits.get(id);
    if (rec && rec.remainingCommission > 0) {
      total += rec.remainingCommission;
    }
  }

  log("[CreditService] Total credit for customer", { customerEmail, total });
  return total;
}

/**
 * Consume credit up to amountToUse for a customer (or affiliate email),
 * and send negative adjustments back to UpPromote.
 *
 * @returns {Promise<{used:number, breakdown:Array<{referralId:number, used:number}>}>}
 */
async function consumeCreditForCustomer(customerEmail, amountToUse) {
  const ids = customerToReferrals.get(customerEmail);
  if (!ids || ids.size === 0) {
    log("[CreditService] No referrals found for customer", { customerEmail });
    return { used: 0, breakdown: [] };
  }

  let remainingToUse = amountToUse;
  const breakdown = [];

  for (const id of ids) {
    if (remainingToUse <= 0) break;

    const rec = referralCredits.get(id);
    if (!rec || rec.remainingCommission <= 0) continue;

    const use = Math.min(rec.remainingCommission, remainingToUse);

    // Update in-memory record
    rec.remainingCommission -= use;
    referralCredits.set(id, rec);

    // Negative adjustment to UpPromote
    try {
      await addReferralAdjustment(id, -use);
      log("[CreditService] Sent negative adjustment to UpPromote", {
        referralId: id,
        used: use,
      });
    } catch (err) {
      error("[CreditService] Failed to send adjustment to UpPromote", {
        referralId: id,
        used: use,
        error: err.message,
      });
    }

    breakdown.push({ referralId: id, used: use });
    remainingToUse -= use;
  }

  const used = amountToUse - remainingToUse;
  log("[CreditService] Consumed credit for customer", {
    customerEmail,
    requested: amountToUse,
    used,
    breakdown,
  });

  return { used, breakdown };
}

module.exports = {
  storeReferralCredit,
  getTotalCreditForCustomer,
  consumeCreditForCustomer,
};
