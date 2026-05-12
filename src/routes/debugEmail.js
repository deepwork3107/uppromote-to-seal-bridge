const express = require("express");
const router = express.Router();
const config = require("../config");
const { log, error } = require("../utils/logger");
const { sendDiscountCodeEmail, isEmailConfigured } = require("../services/emailService");

/**
 * POST /debug/send-test-email
 * Body (JSON):
 *   - to (string, required)
 *   - discountCode (string, optional; default "TEST-DISCOUNT-CODE")
 *   - amount (number | string, optional; default "0.01")
 *   - referralId (string | number, optional; default "email-test")
 *   - subject (string, optional; overrides DISCOUNT_EMAIL_SUBJECT for this send)
 *   - customerName (string, optional)
 *   - extraLines (string[] | string, optional; appended to email body)
 *
 * Header: X-Email-Test-Secret: <same as EMAIL_TEST_ROUTE_SECRET in .env>
 *
 * Only registered when EMAIL_TEST_ROUTE_SECRET is set (see index.js).
 */
router.post("/send-test-email", async (req, res) => {
  const secret = req.header("x-email-test-secret");
  if (!config.emailTestRouteSecret || secret !== config.emailTestRouteSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const to = req.body?.to;
  if (!to || typeof to !== "string") {
    return res.status(400).json({ error: 'Missing JSON body field "to"' });
  }

  const discountCode =
    typeof req.body?.discountCode === "string" && req.body.discountCode.trim()
      ? req.body.discountCode.trim()
      : "TEST-DISCOUNT-CODE";

  let amount = req.body?.amount;
  if (amount === undefined || amount === null || amount === "") {
    amount = "0.01";
  } else if (typeof amount === "number" && !Number.isNaN(amount)) {
    amount = amount.toFixed(2);
  } else {
    amount = String(amount).trim();
  }

  const referralId =
    req.body?.referralId !== undefined && req.body?.referralId !== null && req.body?.referralId !== ""
      ? String(req.body.referralId).trim()
      : "email-test";

  const subject =
    typeof req.body?.subject === "string" && req.body.subject.trim()
      ? req.body.subject.trim()
      : undefined;

  const customerName =
    typeof req.body?.customerName === "string" && req.body.customerName.trim()
      ? req.body.customerName.trim()
      : undefined;

  const extraLines = req.body?.extraLines;

  log("[Debug] send-test-email", {
    to,
    discountCode,
    amount,
    referralId,
    subject: subject || "(default from env)",
    smtpConfigured: isEmailConfigured(),
  });

  try {
    const result = await sendDiscountCodeEmail({
      to: to.trim(),
      discountCode,
      amount,
      referralId,
      subject,
      customerName,
      extraLines,
    });

    return res.status(200).json({
      ok: result.sent,
      result,
      smtpConfigured: isEmailConfigured(),
      used: { to: to.trim(), discountCode, amount, referralId, subject, customerName },
    });
  } catch (err) {
    error("[Debug] send-test-email failed", { message: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
