const nodemailer = require("nodemailer");
const config = require("../config");
const { log, error } = require("../utils/logger");

function buildDiscountEmailHtml({ discountCode, amount, referralId, customerName }) {
  const displayAmount =
    amount != null && amount !== ""
      ? `$${typeof amount === "number" ? amount.toFixed(2) : parseFloat(amount).toFixed(2)}`
      : "";

  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Your Discount Code is Ready</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f1ec;font-family:Arial,Helvetica,sans-serif;">

  <!-- outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f4f1ec;padding:32px 16px;">
    <tr>
      <td align="center">

        <!-- card -->
        <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0"
               style="max-width:580px;width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;">

          <!-- ── HEADER ── -->
          <tr>
            <td bgcolor="#1a1a2e" style="background-color:#1a1a2e;padding:44px 48px 0 48px;">

              <!-- badge -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#2e2b50;border:1px solid #4a47a0;border-radius:50px;
                             padding:5px 14px;font-size:11px;font-weight:700;letter-spacing:0.12em;
                             text-transform:uppercase;color:#a78bfa;font-family:Arial,Helvetica,sans-serif;">
                    &#9679;&nbsp; Affiliate Reward
                  </td>
                </tr>
              </table>

              <!-- headline -->
              <p style="margin:20px 0 10px;font-size:30px;font-weight:700;color:#f8f8ff;
                        line-height:1.25;font-family:Arial,Helvetica,sans-serif;">
                Your Discount<br/>Code is Ready &#127881;
              </p>

              <!-- sub -->
              <p style="margin:0 0 0 0;font-size:14px;color:#8888aa;line-height:1.7;
                        font-family:Arial,Helvetica,sans-serif;max-width:380px;">
                You've earned an exclusive discount as part of our affiliate program.
                Apply it to an active subscription.
              </p>

              <!-- accent bar -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="margin-top:32px;">
                <tr>
                  <td bgcolor="#6366f1" width="40%" height="3"
                      style="background-color:#6366f1;height:3px;line-height:3px;font-size:1px;">&nbsp;</td>
                  <td bgcolor="#8b5cf6" width="30%" height="3"
                      style="background-color:#8b5cf6;height:3px;line-height:3px;font-size:1px;">&nbsp;</td>
                  <td bgcolor="#a78bfa" width="30%" height="3"
                      style="background-color:#a78bfa;height:3px;line-height:3px;font-size:1px;">&nbsp;</td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── BODY ── -->
          <tr>
            <td style="padding:40px 48px 36px;background-color:#ffffff;">

              <!-- greeting -->
              <p style="margin:0 0 24px;font-size:15px;color:#3a3a5c;
                        font-family:Arial,Helvetica,sans-serif;">${greeting}</p>

              <!-- info note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background-color:#f5f3ff;border:1px solid #e0d9ff;
                            border-left:4px solid #6366f1;border-radius:10px;
                            margin-bottom:32px;">
                <tr>
                  <td style="padding:16px 18px;vertical-align:top;width:28px;
                             font-size:18px;line-height:1;">&#8505;&#65039;</td>
                  <td style="padding:16px 18px 16px 0;font-size:13px;color:#4c4580;
                             line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
                    This code is exclusively for
                    <strong style="color:#3730a3;font-weight:700;">active subscribers</strong>.
                    It will be applied to your existing subscription starting from the next billing cycle.
                  </td>
                </tr>
              </table>

              <!-- code box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background-color:#f9f9f9;border:1px solid #e8e8e8;
                            border-radius:16px;margin-bottom:28px;">
                <tr>
                  <td align="center" style="padding:32px 36px;">
                    <p style="margin:0 0 14px;font-size:10px;font-weight:700;
                               letter-spacing:0.2em;text-transform:uppercase;
                               color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">
                      Your Discount Code
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#ffffff;border:2px dashed #d1d5db;
                                   border-radius:10px;padding:16px 28px;">
                          <span style="font-family:'Courier New',Courier,monospace;
                                       font-size:24px;font-weight:700;letter-spacing:0.08em;
                                       color:#1a1a2e;">${discountCode}</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:12px 0 0;font-size:12px;color:#b0b0c0;
                               font-family:Arial,Helvetica,sans-serif;">
                      Use this code in your subscription settings
                    </p>
                  </td>
                </tr>
              </table>

              <!-- detail pills -->
              ${(displayAmount || referralId != null) ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${displayAmount ? `
                  <td width="48%" style="background-color:#f5f3ff;border:1px solid #e0d9ff;
                                         border-radius:12px;padding:20px 22px;vertical-align:top;">
                    <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.18em;
                               text-transform:uppercase;color:#b0b0c0;
                               font-family:Arial,Helvetica,sans-serif;">Discount Amount</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#4f46e5;
                               font-family:Arial,Helvetica,sans-serif;">${displayAmount}</p>
                  </td>
                  <td width="4%">&nbsp;</td>
                  ` : ""}
                  ${referralId != null ? `
                  <td width="48%" style="background-color:#f9f9f9;border:1px solid #e8e8e8;
                                         border-radius:12px;padding:20px 22px;vertical-align:top;">
                    <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.18em;
                               text-transform:uppercase;color:#b0b0c0;
                               font-family:Arial,Helvetica,sans-serif;">Referral ID</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#1a1a2e;
                               font-family:'Courier New',Courier,monospace;">${referralId}</p>
                  </td>
                  ` : ""}
                </tr>
              </table>
              ` : ""}

            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td bgcolor="#f9f9f9" style="background-color:#f9f9f9;border-top:1px solid #f0f0f0;
                                         padding:24px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:11px;color:#c0bdc8;line-height:1.7;
                             font-family:Arial,Helvetica,sans-serif;">
                    &copy; ${year} Momentum Shake. All rights reserved.<br/>
                    <a href="#" style="color:#a5a3b0;text-decoration:none;">Privacy Policy</a>
                  </td>
                  ${referralId != null ? `
                  <td align="right" style="font-family:'Courier New',Courier,monospace;
                                           font-size:11px;color:#d0cdd8;white-space:nowrap;">
                    REF:&nbsp;${referralId}
                  </td>
                  ` : ""}
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

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

  const html = buildDiscountEmailHtml({ discountCode, amount, referralId, customerName });

  try {
    const info = await transport.sendMail({
      from,
      to,
      subject,
      text,
      html,
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

