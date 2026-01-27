// src/services/uppromoteClient.js
const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");

// Base client for UpPromote API v2
const uppromoteApi = axios.create({
  baseURL: "https://aff-api.uppromote.com/api/v2",
  headers: {
    Accept: "application/json",
    Authorization: config.uppromoteApiKey, // make sure this is set in .env
    "Content-Type": "application/json"
  },
  timeout: 10000
});

/**
 * Add an adjustment to a referral in UpPromote.
 *
 * Positive adjustment  -> increase commission
 * Negative adjustment  -> decrease commission (what we want)
 *
 * @param {number|string} referralId - UpPromote referral ID
 * @param {number} adjustmentAmount - signed number, e.g. -30 to subtract $30
 */
async function addReferralAdjustment(referralId, adjustmentAmount) {
  const amount = Number(adjustmentAmount);

  if (!referralId) {
    log("[UpPromote] Skipping referral adjustment: missing referralId", {
      referralId,
      adjustmentAmount
    });
    return;
  }

  if (!Number.isFinite(amount) || amount === 0) {
    log("[UpPromote] Skipping referral adjustment: invalid amount", {
      referralId,
      adjustmentAmount
    });
    return;
  }

  try {
    log("[UpPromote] Adding referral adjustment", {
      referralId,
      adjustment: amount
    });

    const res = await uppromoteApi.post(`/referral/${referralId}/adjustment`, {
      adjustment: amount
    });

    log("[UpPromote] Referral adjustment success", {
      referralId,
      adjustment: amount,
      status: res.data?.status,
      message: res.data?.message
    });

    return res.data;
  } catch (err) {
    error("[UpPromote] Failed to add referral adjustment", {
      referralId,
      adjustment: amount,
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    throw err;
  }
}

module.exports = {
  addReferralAdjustment
};
