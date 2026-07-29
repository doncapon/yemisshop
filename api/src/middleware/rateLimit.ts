import rateLimit from "express-rate-limit";

const jsonRateLimitResponse = (message: string) => (_req: any, res: any) => {
  res.status(429).json({ error: message });
};

/**
 * Login: allows for realistic typo/retry behavior but blocks credential
 * stuffing / brute-force from a single source.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse("Too many login attempts. Please try again in a few minutes."),
});

/**
 * Anything that triggers an outbound SMS/WhatsApp/email send (OTP request,
 * OTP resend, verification email resend). Kept tight since each hit has a
 * real cost and is a common abuse vector (OTP-bombing a phone number).
 */
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse("Too many verification requests. Please wait a few minutes before trying again."),
});

/**
 * Password reset request/confirm — moderate; these are less costly per
 * request than OTP sends but still a target for enumeration/abuse.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse("Too many password reset attempts. Please try again later."),
});

/**
 * New-account creation (shopper or supplier registration) — prevents mass
 * fake-account creation from a single source.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse("Too many accounts created from this network. Please try again later."),
});
