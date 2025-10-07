// src/lib/email.ts
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST!,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // true if port 465
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});

export async function sendVerifyEmail(to: string, verifyUrl: string) {
  const html = `
    <div style="font-family:system-ui,Arial">
      <h2>Verify your email</h2>
      <p>Please click the link below to verify your email address:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>If you didn’t request this, you can ignore this email.</p>
    </div>
  `;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@yemisshop.local',
    to,
    subject: 'Verify your email',
    html,
  });
}

export async function sendResetorForgotPasswordEmail(to: string, verifyUrl: string, subject: string, html: string) {
  html += " " + verifyUrl;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@yemisshop.local',
    to,
    subject: subject,
    html,
  });
}
