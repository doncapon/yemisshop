// src/lib/email.ts
import nodemailer from 'nodemailer';

const isProd = process.env.NODE_ENV === 'production';
const hasSmtpCreds =
  !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;

let transporter: nodemailer.Transporter;

if (!isProd && !hasSmtpCreds) {
  // DEV fallback: print emails to console instead of making a TLS connection
  transporter = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
  console.warn('[email] Using streamTransport (DEV). Set SMTP_* envs to send real mail.');
} else {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465, // 465 = SMTPS
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    // DEV ONLY: relax TLS if your dev SMTP has a self-signed cert
    tls: !isProd ? { rejectUnauthorized: false } : undefined,
  });
}

export async function sendVerifyEmail(to: string, verifyUrl: string) {
  const html = `
    <div style="font-family:system-ui,Arial">
      <h2>Verify your email</h2>
      <p>Please click the link below to verify your email address:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>If you didn’t request this, you can ignore this email.</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@yemisshop.local',
    to,
    subject: 'Verify your email',
    html,
  });

  if (!hasSmtpCreds && !isProd) {
    console.log('\n[EMAIL:DEV] (preview)\n', info.message?.toString?.() ?? info);
  }
}

export async function sendResetorForgotPasswordEmail(
  to: string,
  verifyUrl: string,
  subject: string,
  html: string
) {
  const finalHtml = `${html} <br/><a href="${verifyUrl}">${verifyUrl}</a>`;
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@yemisshop.local',
    to,
    subject,
    html: finalHtml,
  });

  if (!hasSmtpCreds && !isProd) {
    console.log('\n[EMAIL:DEV] (preview)\n', info.message?.toString?.() ?? info);
  }
}

export function paymentLinkEmail(orderId: string, link: string) {
  return {
    subject: `Pay for YemiShop Order ${orderId}`,
    html: `
      <div style="font-family:sans-serif;max-width:640px;margin:auto">
        <h2>Complete your payment</h2>
        <p>Please click the button below to pay for your order <b>${orderId}</b>.</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none">Pay now</a></p>
        <p>Or copy this link: <br /><a href="${link}">${link}</a></p>
        <p>Thank you for shopping with YemiShop.</p>
      </div>
    `,
  };
}
