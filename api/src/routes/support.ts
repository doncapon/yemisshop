// api/src/routes/support.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import { sendMail } from "../lib/email.js";

const router = Router();

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
  orderId: z.string().max(100).optional().nullable(),
  topic: z.enum(["GENERAL", "ORDER", "SUPPLIER", "OTHER"]).optional(),
});

router.post(
  "/contact",
  wrap(async (req: Request, res: Response) => {
    const data = contactSchema.parse(req.body);

    const { name, email, subject, message, orderId, topic } = data;

    const topicLabel =
      topic === "ORDER"
        ? "Order / Delivery"
        : topic === "SUPPLIER"
        ? "Supplier / Seller"
        : topic === "OTHER"
        ? "Other"
        : "General";

    const safeOrderId = orderId?.trim() ? orderId.trim() : null;

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
        <h2 style="margin:0 0 6px 0">New contact message — DaySpring</h2>
        <p style="margin:0 0 10px 0;color:#374151;">You received a new contact form message from the DaySpring store.</p>

        <div style="margin:10px 0 14px 0;padding:10px 12px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;">
          <p style="margin:0;font-size:14px;"><strong>From:</strong> ${name}</p>
          <p style="margin:4px 0;font-size:14px;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p style="margin:4px 0;font-size:14px;"><strong>Topic:</strong> ${topicLabel}</p>
          ${
            safeOrderId
              ? `<p style="margin:4px 0;font-size:14px;"><strong>Order ID:</strong> <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${safeOrderId}</span></p>`
              : ""
          }
        </div>

        <p style="margin:0 0 6px 0;font-size:14px;"><strong>Subject:</strong> ${subject}</p>
        <p style="margin:8px 0 0 0;white-space:pre-wrap;font-size:14px;">${message}</p>

        <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;" />
        <p style="margin:0;font-size:12px;color:#6b7280;">This message was sent from the DaySpring contact form.</p>
      </div>
    `;

    await sendMail({
      to: "support@dayspring.com",
      subject: `Contact form: ${subject}`,
      html,
      replyTo: email,
    });

    res.json({ ok: true });
  })
);

export default router;