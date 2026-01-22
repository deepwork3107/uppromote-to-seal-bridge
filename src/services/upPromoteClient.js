const axios = require("axios");
const config = require("../config");
const { log, error } = require("../utils/logger");

const upPromoteApi = axios.create({
  baseURL: "https://aff-api.uppromote.com/api/v2",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: config.uppromoteApiKey
  },
  timeout: 20000
});

/**
 * Add adjustment to an existing referral
 * Uses POST /api/v2/referral/{id}/adjustment with body { adjustment } :contentReference[oaicite:3]{index=3}
 *
 * @param {number|string} referralId
 * @param {number} adjustment - positive or negative number (we'll use negative to deduct)
 */
async function addReferralAdjustment(referralId, adjustment) {
  try {
    log("[UpPromote] Adding adjustment to referral", {
      referralId,
      adjustment,
      endpoint: `/referral/${referralId}/adjustment`
    });

    const res = await upPromoteApi.post(
      `/referral/${referralId}/adjustment`,
      { adjustment }
    );

    log("[UpPromote] Successfully added referral adjustment", {
      referralId,
      adjustment,
      responseStatus: res.status,
      responseData: res.data
    });
    return res.data;
  } catch (err) {
    error("[UpPromote] Failed to add referral adjustment", {
      referralId,
      adjustment,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message
    });
    throw err;
  }
}

module.exports = {
  upPromoteApi,
  addReferralAdjustment
};
