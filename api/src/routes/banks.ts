// api/src/routes/banks.ts
import express from "express";
import axios from "axios";

const router = express.Router();

type BankOption = {
  country: "NG";
  code: string;
  name: string;
};

let listCache: { data: BankOption[]; at: number } | null = null;
const LIST_TTL_MS = 6 * 60 * 60 * 1000;

function pickSecretKey() {
  return (
    process.env.PAYSTACK_SECRET_KEY ||
    process.env.PAYSTACK_TEST_SECRET_KEY ||
    process.env.PAYSTACK_LIVE_SECRET_KEY ||
    ""
  ).trim();
}

function onlyDigits(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}

function authHeader() {
  const secret = pickSecretKey();
  if (!secret) {
    const err: any = new Error("Paystack secret key is not configured");
    err.status = 500;
    throw err;
  }
  return { Authorization: `Bearer ${secret}` };
}

const FALLBACK_BANKS: BankOption[] = [
  { country: "NG", code: "011", name: "First Bank of Nigeria" },
  { country: "NG", code: "033", name: "United Bank for Africa" },
  { country: "NG", code: "044", name: "Access Bank" },
  { country: "NG", code: "057", name: "Zenith Bank" },
  { country: "NG", code: "058", name: "Guaranty Trust Bank" },
  { country: "NG", code: "070", name: "Fidelity Bank" },
  { country: "NG", code: "076", name: "Polaris Bank" },
  { country: "NG", code: "214", name: "FCMB" },
  { country: "NG", code: "215", name: "Unity Bank" },
  { country: "NG", code: "221", name: "Stanbic IBTC Bank" },
  { country: "NG", code: "232", name: "Sterling Bank" },
  { country: "NG", code: "035", name: "Wema Bank" },
  { country: "NG", code: "50211", name: "Kuda Bank" },
];

/**
 * GET /api/banks
 * Returns Nigerian banks usable for NUBAN transfers
 */
router.get("/", async (_req, res) => {
  try {
    const now = Date.now();

    if (listCache && now - listCache.at < LIST_TTL_MS) {
      return res.json({ ok: true, data: listCache.data });
    }

    const { data } = await axios.get("https://api.paystack.co/bank", {
      params: { currency: "NGN" },
      headers: authHeader(),
      timeout: 15000,
    });

    const rows = Array.isArray(data?.data) ? data.data : [];

    const list: BankOption[] = rows
      .filter(
        (b: any) =>
          b?.active &&
          String(b?.currency || "").toUpperCase() === "NGN" &&
          String(b?.type || "nuban").toLowerCase() === "nuban"
      )
      .map((b: any) => ({
        country: "NG",
        code: String(b.code ?? "").trim(),
        name: String(b.name ?? "").trim(),
      }))
      .filter((b: any) => b.code && b.name)
      .reduce((acc: BankOption[], cur: any) => {
        if (!acc.find((x) => x.code === cur.code)) acc.push(cur);
        return acc;
      }, [])
      .sort((a: { name: string; }, b: { name: any; }) => a.name.localeCompare(b.name));

    listCache = { data: list, at: now };

    return res.json({ ok: true, data: list });
  } catch (e: any) {
    console.error("List banks failed:", e?.response?.data || e?.message);
    return res.json({ ok: true, data: FALLBACK_BANKS });
  }
});

/**
 * GET /api/banks/resolve?accountNumber=0001234567&bankCode=058
 * Resolves account name from Paystack
 */
router.get("/resolve", async (req, res) => {
  try {
    const accountNumber = onlyDigits(
      req.query.accountNumber ?? req.query.account_number
    );
    const bankCode = String(
      req.query.bankCode ?? req.query.bank_code ?? ""
    ).trim();

    if (!accountNumber || accountNumber.length !== 10) {
      return res.status(400).json({
        ok: false,
        error: "A valid 10-digit account number is required",
      });
    }

    if (!bankCode) {
      return res.status(400).json({
        ok: false,
        error: "bankCode is required",
      });
    }

    const { data } = await axios.get("https://api.paystack.co/bank/resolve", {
      params: {
        account_number: accountNumber,
        bank_code: bankCode,
      },
      headers: authHeader(),
      timeout: 15000,
    });

    const resolved = data?.data ?? null;
    const accountName = String(resolved?.account_name ?? "").trim();
    const resolvedAccountNumber = String(
      resolved?.account_number ?? accountNumber
    ).trim();

    if (!accountName) {
      return res.status(400).json({
        ok: false,
        error: "Could not resolve account name",
      });
    }

    return res.json({
      ok: true,
      data: {
        accountName,
        accountNumber: resolvedAccountNumber,
        bankCode,
      },
    });
  } catch (e: any) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      "Could not resolve account";
    return res.status(400).json({
      ok: false,
      error: msg,
    });
  }
});

export default router;