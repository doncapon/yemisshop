// payments.ts (near top)
import type { RequestHandler } from "express";

const requireOtpToken: RequestHandler = (req, res, next) => {
  const otp = req.get("x-otp-token"); // safest way
  if (!otp) {
    // 428 Precondition Required is a nice semantic fit, 400 is also ok.
    return res.status(428).json({
      error: "OTP_REQUIRED",
      message: "Missing x-otp-token",
      header: "x-otp-token",
    });
  }
  (req as any).otpToken = otp;
  next();
};

// if you don’t already have one, add an async wrapper
const wrap =
  (fn: any): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
