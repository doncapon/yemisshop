import { Router } from "express";
import { SUPPLIER_REGISTRATION_COUNTRIES } from "../config/countries.js";

const router = Router();

router.get("/supplier-registration-countries", (_, res) => {
  res.json({
    data: SUPPLIER_REGISTRATION_COUNTRIES,
  });
});

export default router;