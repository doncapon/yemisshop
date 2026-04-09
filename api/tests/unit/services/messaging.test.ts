// api/tests/unit/services/messaging.test.ts
// Unit tests for the messaging service — verifies channel fallback logic.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external send functions before importing the service
vi.mock("../../../src/lib/termii.js", () => ({
  sendSmsViaTermii: vi.fn().mockResolvedValue({ message: "Successfully Sent" }),
}));

vi.mock("../../../src/lib/email.js", () => ({
  sendMail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendCustomerOrderCreatedEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendCustomerOrderPaidEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendCustomerOrderShippedEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendCustomerOrderDeliveredEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

import { sendSmsViaTermii } from "../../../src/lib/termii.js";
import { sendMail } from "../../../src/lib/email.js";
import {
  sendMessageWithFallback,
  sendOtpMessage,
  sendOrderCreatedMessage,
  sendOrderPaidMessage,
  sendOrderShippedMessage,
  sendOrderDeliveredMessage,
} from "../../../src/services/messaging.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  // vi.stubEnv sets both process.env and import.meta.env, and is
  // automatically restored after each test — no process type needed.
  vi.stubEnv("TERMII_SMS_ENABLED", "true");
  vi.stubEnv("TERMII_WHATSAPP_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendMessageWithFallback", () => {
  it("succeeds via SMS when WhatsApp is disabled and phone is provided", async () => {
    const result = await sendMessageWithFallback({
      toPhone: "08012345678",
      message: "Hello!",
      allowFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("sms");
    expect(sendSmsViaTermii).toHaveBeenCalledOnce();
  });

  it("falls back to email when SMS fails and email is provided", async () => {
    vi.mocked(sendSmsViaTermii).mockRejectedValueOnce(new Error("SMS failed"));

    const result = await sendMessageWithFallback({
      toPhone: "08012345678",
      toEmail: "user@test.com",
      message: "Hello!",
      subject: "Test",
      preferChannel: "sms",
      allowFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("email");
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it("returns ok:false when all channels fail", async () => {
    vi.mocked(sendSmsViaTermii).mockRejectedValueOnce(new Error("SMS failed"));
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("Email failed"));

    const result = await sendMessageWithFallback({
      toPhone: "08012345678",
      toEmail: "user@test.com",
      message: "Hello!",
      preferChannel: "sms",
      allowFallback: true,
    });

    expect(result.ok).toBe(false);
    expect(result.channel).toBeNull();
  });

  it("does not fall back when allowFallback is false", async () => {
    vi.mocked(sendSmsViaTermii).mockRejectedValueOnce(new Error("SMS failed"));

    const result = await sendMessageWithFallback({
      toPhone: "08012345678",
      toEmail: "user@test.com",
      message: "Hello!",
      preferChannel: "sms",
      allowFallback: false,
    });

    expect(result.ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("goes straight to email when preferChannel is email", async () => {
    const result = await sendMessageWithFallback({
      toEmail: "user@test.com",
      message: "Hello!",
      subject: "Hi",
      preferChannel: "email",
      allowFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("email");
    expect(sendSmsViaTermii).not.toHaveBeenCalled();
  });
});

describe("sendOtpMessage", () => {
  it("sends an OTP via SMS", async () => {
    const result = await sendOtpMessage({
      code: "123456",
      toPhone: "08012345678",
      brand: "DaySpring",
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("sms");
    const call = vi.mocked(sendSmsViaTermii).mock.calls[0][0];
    expect(call.message).toContain("123456");
    expect(call.message).toContain("DaySpring");
  });
});

describe("Order notification helpers", () => {
  it("sendOrderCreatedMessage sends via SMS", async () => {
    const result = await sendOrderCreatedMessage({
      orderId: "order-123",
      orderRef: "ORD-001",
      toPhone: "08012345678",
    });
    expect(result.ok).toBe(true);
  });

  it("sendOrderPaidMessage falls back to email when SMS fails", async () => {
    vi.mocked(sendSmsViaTermii).mockRejectedValueOnce(new Error("SMS failed"));

    const result = await sendOrderPaidMessage({
      orderId: "order-123",
      orderRef: "ORD-001",
      toPhone: "08012345678",
      toEmail: "customer@test.com",
      totalAmount: 15000,
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("email");
  });

  it("sendOrderShippedMessage includes tracking info in SMS text", async () => {
    await sendOrderShippedMessage({
      orderId: "order-123",
      toPhone: "08012345678",
      trackingInfo: "GIG-XYZ-123",
    });

    const call = vi.mocked(sendSmsViaTermii).mock.calls[0][0];
    expect(call.message).toContain("GIG-XYZ-123");
  });

  it("sendOrderDeliveredMessage sends successfully", async () => {
    const result = await sendOrderDeliveredMessage({
      orderId: "order-123",
      toPhone: "08012345678",
    });
    expect(result.ok).toBe(true);
  });
});
