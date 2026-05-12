const nodemailer = require("nodemailer");
const config = require("../config");
const { log, error } = require("../utils/logger");

function isEmailConfigured() {
  return Boolean(
    config.smtpHost &&
      config.smtpPort &&
      config.smtpUser &&
      (config.smtpPass || config.smtpAppPassword),
  );
}

function getTransport() {
  if (!isEmailConfigured()) return null;

  const pass = config.smtpPass || config.smtpAppPassword;

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: Number(config.smtpPort),
    secure: String(config.smtpSecure).toLowerCase() === "true",
    auth: {
      user: config.smtpUser,
      pass,
    },
  });
}

async function sendDiscountCodeEmail({
  to,
  discountCode,
  amount,
  referralId,
  /** Optional overrides (e.g. debug route or future templates) */
  subject: subjectOverride,
  customerName,
  extraLines,
}) {
  const transport = getTransport();
  if (!transport) {
    log("[Email] SMTP not configured; skipping discount email", {
      to,
      discountCode,
      amount,
      referralId,
    });
    return { sent: false, reason: "smtp-not-configured" };
  }

  const from = config.smtpFrom || config.smtpUser;

  const subject =
    (typeof subjectOverride === "string" && subjectOverride.trim()) ||
    config.discountEmailSubject ||
    "Your discount code";

  const extras = Array.isArray(extraLines)
    ? extraLines.filter((l) => l != null && String(l).trim() !== "")
    : typeof extraLines === "string" && extraLines.trim()
      ? [extraLines.trim()]
      : [];

  const text = [
    "Your discount code is ready.",
    customerName ? `Name: ${customerName}` : null,
    "",
    `Code: ${discountCode}`,
    amount != null && amount !== ""
      ? `Amount: ${typeof amount === "number" ? amount.toFixed(2) : String(amount)}`
      : null,
    referralId != null && referralId !== ""
      ? `Referral ID: ${referralId}`
      : null,
    ...extras,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const info = await transport.sendMail({
      from,
      to,
      subject,
      text,
    });

    log("[Email] Discount email sent", {
      to,
      discountCode,
      referralId,
      messageId: info.messageId,
    });

    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const msg = err.message || String(err);
    const hint =
      /535|BadCredentials|Invalid login/i.test(msg)
        ? "Gmail: use an App Password (Google Account → Security → 2-Step Verification → App passwords), SMTP_USER must be the full Gmail address, and SMTP_APP_PASSWORD/SMTP_APP_PASSWORD must be that 16-char app password (not your normal password)."
        : undefined;
    error("[Email] Failed to send discount email", {
      to,
      discountCode,
      referralId,
      message: msg,
      ...(hint ? { hint } : {}),
    });
    return { sent: false, reason: msg };
  }
}

module.exports = {
  isEmailConfigured,
  sendDiscountCodeEmail,
};

