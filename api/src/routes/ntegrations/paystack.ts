// api/routes/integrations/paystack.ts
import express from "express";
import axios from "axios";

const r = express.Router();

r.get("/banks", async (req, res) => {
  try {
    const country = String(req.query.country || "NG");
    const { data } = await axios.get(
      "https://api.paystack.co/bank",
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        params: { country, perPage: 1000 }, // large page to get all
      }
    );
    // Normalize to your UI shape
    const banks = (data?.data || []).map((b: any) => ({
      country: b.country,
      code: String(b.code),
      name: b.name,
    }));
    res.json({ data: banks });
  } catch (e: any) {
    // fall back to a safe static list if you like
    res.status(502).json({ error: "Could not load banks from Paystack" });
  }
});

export default r;
