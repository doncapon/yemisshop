// src/routes/admin-banks.ts
import express from "express";
import axios from "axios";

const router = express.Router();

// Optional: very light in-memory cache so you don't call Paystack on every page load
let cache: { data: BankOption[]; at: number } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

export type BankOption = {
  country: 'NG';
  code: string;   // e.g. "058"
  name: string;   // e.g. "Guaranty Trust Bank"
};

router.get("/", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) {
      return res.json({ data: cache.data });
    }

    const { data } = await axios.get("https://api.paystack.co/bank", {
      params: { currency: "NGN" }, // Nigeria (NUBAN)
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      timeout: 15_000,
    });

    const rows = Array.isArray(data?.data) ? data.data : [];
    // Normalize & only keep active Nigerian NUBAN banks
    const list: BankOption[] = rows
      .filter((b: any) => b?.active && b?.currency === "NGN" && (b?.type ?? "nuban") === "nuban")
      .map((b: any) => ({
        country: "NG",
        code: String(b.code),
        name: String(b.name),
      }))
      // remove dupes, sort by name
      .reduce((acc: BankOption[], cur: BankOption) => {
        if (!acc.find(x => x.code === cur.code)) acc.push(cur);
        return acc;
      }, [])
      .sort((a: { name: string; }, b: { name: any; }) => a.name.localeCompare(b.name));

    cache = { data: list, at: now };
    res.json({ data: list });
  } catch (e: any) {
    console.error("List banks failed:", e?.response?.data || e?.message);
    // Return a small fallback so your UI still works
    res.json({ data: FALLBACK_BANKS });
  }
});

export default router;

// You can keep a tiny fallback to avoid a blank dropdown if Paystack is down
const FALLBACK_BANKS: BankOption[] = [
  { country: 'NG', code: '011', name: 'First Bank of Nigeria' },
  { country: 'NG', code: '033', name: 'United Bank for Africa' },
  { country: 'NG', code: '044', name: 'Access Bank' },
  { country: 'NG', code: '057', name: 'Zenith Bank' },
  { country: 'NG', code: '058', name: 'Guaranty Trust Bank' },
  { country: 'NG', code: '070', name: 'Fidelity Bank' },
  { country: 'NG', code: '076', name: 'Polaris Bank' },
  { country: 'NG', code: '214', name: 'FCMB' },
  { country: 'NG', code: '215', name: 'Unity Bank' },
  { country: 'NG', code: '221', name: 'Stanbic IBTC Bank' },
  { country: 'NG', code: '232', name: 'Sterling Bank' },
  { country: 'NG', code: '035', name: 'Wema Bank' },
  // …this is intentionally short; the API returns the full set.
];
