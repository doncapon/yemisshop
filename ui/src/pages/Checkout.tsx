// src/pages/Checkout.tsx

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";
import SiteLayout from "../layouts/SiteLayout.js";
import { getAttribution } from "../utils/attribution.js";

/* ----------------------------- Config ----------------------------- */
const VERIFY_PATH = "/verify";

/* ----------------------------- Types ----------------------------- */
type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartLine = {
  kind?: "BASE" | "VARIANT"; // ✅ preserve cart separation

  productId: string;
  title: string;
  qty: number;

  offerId?: string; // ✅ chosen offer (if your cart stores it)
  unitPrice?: number;
  variantId?: string | null;
  selectedOptions?: SelectedOption[];

  // legacy mirror
  price?: number;
  totalPrice?: number;

  image?: string | null;
  supplierId?: string | null;
};

type Address = {
  houseNumber: string;
  streetName: string;
  postCode: string;
  town: string;
  city: string;
  state: string;
  country: string;
};

const EMPTY_ADDR: Address = {
  houseNumber: "",
  streetName: "",
  postCode: "",
  town: "",
  city: "",
  state: "",
  country: "Nigeria",
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

/* ----------------------------- Helpers ----------------------------- */
const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const asInt = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

const asMoney = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = toArray<SelectedOption>(raw)
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ""),
      attribute: String(o.attribute ?? ""),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ""),
    }))
    .filter((o) => o.attributeId || o.attribute || o.valueId || o.value);

  // stable order so the same combo always hashes the same
  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

function optionsKey(sel?: SelectedOption[]) {
  const s = (sel ?? []).filter(Boolean);
  if (!s.length) return "";
  return s.map((o) => `${o.attributeId}=${o.valueId ?? o.value}`).join("|");
}

/**
 * ✅ Stable cart line key (must match Cart.tsx intent)
 * - base product: productId::base
 * - variant by id: productId::v:<variantId>
 * - options-only fallback: productId::o:<optionsKey>
 */
function lineKeyFor(item: Pick<CartLine, "productId" | "variantId" | "selectedOptions" | "kind">) {
  const pid = String(item.productId);
  const vid = item.variantId == null ? null : String(item.variantId);
  const sel = normalizeSelectedOptions(item.selectedOptions);

  const kind: "BASE" | "VARIANT" =
    item.kind === "BASE" || item.kind === "VARIANT" ? item.kind : item.variantId ? "VARIANT" : "BASE";

  if (kind === "VARIANT") {
    if (vid) return `${pid}::v:${vid}`;
    return sel.length ? `${pid}::o:${optionsKey(sel)}` : `${pid}::v:unknown`;
  }

  return `${pid}::base`;
}

// Normalize whatever we find in localStorage to a consistent shape
function readCart(): CartLine[] {
  try {
    const raw = localStorage.getItem("cart");
    const arr: any[] = raw ? JSON.parse(raw) : [];

    return arr.map((x) => {
      const unit = num(x.unitPrice, num(x.price, 0));
      const qty = Math.max(1, num(x.qty, 1));

      const rawKind = x.kind === "BASE" || x.kind === "VARIANT" ? x.kind : undefined;
      const inferredKind: "BASE" | "VARIANT" = rawKind ?? (x.variantId ? "VARIANT" : "BASE");

      const selectedOptions = normalizeSelectedOptions(x.selectedOptions);

      return {
        kind: inferredKind,
        productId: String(x.productId),
        title: String(x.title ?? ""),
        qty,
        unitPrice: unit,
        variantId: x.variantId ?? null,
        selectedOptions,
        totalPrice: num(x.totalPrice, unit * qty),
        image: x.image ?? null,

        // ✅ keep supplier + offer if present
        supplierId: x.supplierId ?? null,
        offerId: x.offerId ? String(x.offerId) : undefined,
      };
    });
  } catch {
    return [];
  }
}

function writeCart(lines: CartLine[]) {
  const out = lines.map((l) => {
    const unit = num(l.unitPrice, num(l.price, 0));
    const qty = Math.max(1, num(l.qty, 1));
    const total = unit * qty;

    const rawKind = l.kind === "BASE" || l.kind === "VARIANT" ? l.kind : undefined;
    const inferredKind: "BASE" | "VARIANT" = rawKind ?? (l.variantId ? "VARIANT" : "BASE");

    const sel = normalizeSelectedOptions(l.selectedOptions);

    return {
      kind: inferredKind,
      productId: l.productId,
      title: l.title,
      qty,
      unitPrice: unit,
      variantId: l.variantId ?? null,
      selectedOptions: sel,
      image: l.image ?? null,

      // ✅ keep supplier + offer so server can price consistently
      supplierId: l.supplierId ?? null,
      offerId: l.offerId ?? undefined,

      totalPrice: total,
    };
  });

  localStorage.setItem("cart", JSON.stringify(out));
  window.dispatchEvent(new Event("cart:updated"));
}

function computeLineTotal(line: CartLine): number {
  const unit = num(line.unitPrice, num(line.price, 0));
  const qty = Math.max(1, num(line.qty, 1));
  return unit * qty;
}

/* ---------------- Supplier-split pricing quote (authoritative) ---------------- */

type QuoteAllocation = {
  supplierId: string;
  supplierName?: string | null;
  qty: number;
  unitPrice: number; // supplier unit (cost)
  offerId?: string | null;
  lineTotal?: number;
};

type QuoteLine = {
  key: string;
  productId: string;
  variantId?: string | null;
  kind: "BASE" | "VARIANT";
  qtyRequested: number;
  qtyPriced: number;
  allocations: QuoteAllocation[];
  lineTotal: number; // supplier total
  minUnit: number;
  maxUnit: number;
  averageUnit: number;
  currency?: string | null;
  warnings?: string[];
};

type QuotePayload = {
  currency?: string | null;
  subtotal: number; // supplier subtotal
  lines: Record<string, QuoteLine>;
  raw?: any;
};

function normalizeQuoteResponse(raw: any, cart: CartLine[]): QuotePayload | null {
  const root = raw?.data?.data ?? raw?.data ?? raw ?? null;
  if (!root) return null;

  const currency = root.currency ?? root?.quote?.currency ?? null;
  const maybe = root.quote ?? root;

  const subtotal = asMoney(maybe.subtotal ?? maybe.itemsSubtotal ?? maybe.totalItems ?? maybe.total ?? 0, 0);

  const outLines: Record<string, QuoteLine> = {};

  const ensureKey = (x: any) => {
    const k = String(x?.key ?? "");
    if (k) return k;

    const pid = String(x?.productId ?? "");
    const vid = x?.variantId == null ? null : String(x.variantId);
    const kind: "BASE" | "VARIANT" = x?.kind === "VARIANT" || (!!vid && x?.kind !== "BASE") ? "VARIANT" : "BASE";

    if (!pid) return "";
    if (kind === "VARIANT") return vid ? `${pid}::v:${vid}` : `${pid}::v:unknown`;
    return `${pid}::base`;
  };

  const normalizeAlloc = (a: any): QuoteAllocation => {
    const qty = Math.max(0, asInt(a?.qty ?? a?.quantity ?? 0, 0));
    const unitPrice = asMoney(a?.unitPrice ?? a?.price ?? a?.supplierPrice ?? 0, 0);
    const lineTotal = asMoney(a?.lineTotal ?? qty * unitPrice, qty * unitPrice);

    return {
      supplierId: String(a?.supplierId ?? a?.supplier_id ?? ""),
      supplierName: a?.supplierName ?? a?.supplier?.name ?? null,
      qty,
      unitPrice,
      offerId: a?.offerId ?? a?.supplierOfferId ?? null,
      lineTotal,
    };
  };

  const normalizeLine = (x: any): QuoteLine | null => {
    const key = ensureKey(x);
    if (!key) return null;

    const productId = String(x?.productId ?? "");
    const variantId = x?.variantId == null ? null : String(x.variantId);
    const kind: "BASE" | "VARIANT" =
      x?.kind === "BASE" || x?.kind === "VARIANT" ? x.kind : variantId ? "VARIANT" : "BASE";

    const qtyRequested = Math.max(1, asInt(x?.qtyRequested ?? x?.qty ?? x?.requestedQty ?? 1, 1));

    const allocsRaw = toArray<any>(x?.allocations ?? x?.splits ?? x?.items ?? x?.parts);
    const allocations = allocsRaw.map(normalizeAlloc).filter((a) => a.qty > 0 && a.unitPrice >= 0);

    const lineTotal = asMoney(
      x?.lineTotal ?? x?.total ?? allocations.reduce((s, a) => s + asMoney(a.lineTotal, 0), 0),
      0
    );

    const qtyPriced = Math.max(0, asInt(x?.qtyPriced ?? allocations.reduce((s, a) => s + asInt(a.qty, 0), 0), 0));

    const units = allocations.map((a) => asMoney(a.unitPrice, NaN)).filter((n) => Number.isFinite(n));
    const minUnit = units.length ? Math.min(...(units as number[])) : 0;
    const maxUnit = units.length ? Math.max(...(units as number[])) : 0;
    const averageUnit = qtyRequested > 0 ? lineTotal / qtyRequested : 0;

    const warnings: string[] = [];
    if (qtyPriced < qtyRequested) warnings.push("Some units could not be priced/allocated.");

    return {
      key,
      productId,
      variantId,
      kind,
      qtyRequested,
      qtyPriced,
      allocations,
      lineTotal,
      minUnit,
      maxUnit,
      averageUnit,
      currency,
      warnings: warnings.length ? warnings : undefined,
    };
  };

  if (Array.isArray(maybe?.lines)) {
    for (const x of maybe.lines) {
      const ln = normalizeLine(x);
      if (ln) outLines[ln.key] = ln;
    }
  }

  if (!Object.keys(outLines).length && maybe?.lines && typeof maybe.lines === "object") {
    for (const [k, v] of Object.entries(maybe.lines)) {
      const ln = normalizeLine({ ...(v as any), key: k });
      if (ln) outLines[ln.key] = ln;
    }
  }

  const hasAny = Object.keys(outLines).length > 0;
  if (!hasAny && !(subtotal > 0)) return null;

  // backfill missing keys so UI never crashes
  for (const it of cart) {
    const k = lineKeyFor(it);
    if (!outLines[k]) {
      outLines[k] = {
        key: k,
        productId: it.productId,
        variantId: it.variantId ?? null,
        kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
        qtyRequested: Math.max(1, asInt(it.qty, 1)),
        qtyPriced: 0,
        allocations: [],
        lineTotal: 0,
        minUnit: 0,
        maxUnit: 0,
        averageUnit: 0,
        currency,
        warnings: ["No quote returned for this line."],
      };
    }
  }

  return { currency, subtotal, lines: outLines, raw };
}

async function fetchPricingQuoteForCart(cart: CartLine[]): Promise<QuotePayload | null> {
  if (!cart.length) return null;

  const items = cart.map((it) => ({
    key: lineKeyFor(it),
    kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
    productId: it.productId,
    variantId: it.variantId ?? null,
    qty: Math.max(1, asInt(it.qty, 1)),
    selectedOptions: Array.isArray(it.selectedOptions) ? normalizeSelectedOptions(it.selectedOptions) : undefined,

    // optional passthrough — harmless if backend ignores
    offerId: it.offerId || undefined,
    supplierId: it.supplierId || undefined,
    unitPriceCache: asMoney(it.unitPrice, asMoney(it.price, 0)),
  }));

  const attempts: Array<{ method: "post" | "get"; url: string; body?: any }> = [
    { method: "post", url: "/api/catalog/quote", body: { items } },
    { method: "post", url: "/api/cart/quote", body: { items } },
    { method: "post", url: "/api/checkout/quote", body: { items } },
    { method: "post", url: "/api/orders/quote", body: { items } },

    { method: "post", url: "/api/catalog/pricing", body: { items } },
    { method: "post", url: "/api/cart/pricing", body: { items } },
    { method: "post", url: "/api/checkout/pricing", body: { items } },
  ];

  for (const a of attempts) {
    try {
      const res =
        a.method === "post"
          ? await api.post(a.url, a.body)
          : await api.get(a.url, { params: { items: JSON.stringify(items) } });

      const normalized = normalizeQuoteResponse(res, cart);
      if (normalized) return normalized;
    } catch {
      /* try next */
    }
  }

  return null;
}

/* ---------------- Public settings (marginPercent) ---------------- */

type PublicSettings = {
  marginPercent?: number | string | null;
  commerce?: { marginPercent?: number | string | null } | null;
  pricing?: { marginPercent?: number | string | null } | null;
};

async function fetchPublicSettings(): Promise<PublicSettings | null> {
  const attempts = ["/api/settings/public", "/api/settings/public?include=pricing", "/api/settings/public?scope=commerce"];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url);
      const root = data?.data ?? data ?? null;
      if (root) return root as PublicSettings;
    } catch {
      /* try next */
    }
  }
  return null;
}

const clampPct = (p: number) => {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 1000) return 1000;
  return p;
};

function extractMarginPercent(s: PublicSettings | null | undefined): number {
  if (!s) return 0;

  const direct = asMoney(s.marginPercent, NaN);
  if (Number.isFinite(direct)) return clampPct(direct);

  const commerce = asMoney(s.commerce?.marginPercent, NaN);
  if (Number.isFinite(commerce)) return clampPct(commerce);

  const pricing = asMoney(s.pricing?.marginPercent, NaN);
  if (Number.isFinite(pricing)) return clampPct(pricing);

  return 0;
}

const applyMargin = (supplierUnit: number, marginPercent: number) => {
  const p = clampPct(marginPercent);
  return supplierUnit * (1 + p / 100);
};

/* -------- Verification helpers -------- */
type ProfileMe = {
  // stamps (old style)
  emailVerifiedAt?: unknown;
  phoneVerifiedAt?: unknown;

  // booleans (new style)
  emailVerified?: boolean;
  phoneVerified?: boolean;

  address?: Partial<Address> | null;
  shippingAddress?: Partial<Address> | null;

  // some APIs return snake_case
  shipping_address?: Partial<Address> | null;
};

const normalizeStampPresent = (v: unknown) => {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "null" || s === "undefined") return false;
  return true;
};

function computeVerificationFlags(p?: ProfileMe) {
  // support either "emailVerifiedAt" OR "emailVerified"
  const emailOk = p?.emailVerified === true ? true : normalizeStampPresent(p?.emailVerifiedAt);

  let phoneOk: boolean;
  if ((import.meta as any)?.env?.PHONE_VERIFY === "set") {
    phoneOk = p?.phoneVerified === true ? true : normalizeStampPresent(p?.phoneVerifiedAt);
  } else {
    phoneOk = true;
  }

  return { emailOk, phoneOk };
}

async function fetchProfileMe(): Promise<ProfileMe> {
  const attempts = ["/api/profile/me", "/api/auth/me"];
  let lastErr: any = null;

  for (const url of attempts) {
    try {
      const res = await api.get(url);
      return (res.data?.data ?? res.data ?? {}) as ProfileMe;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr;
}

/* ----------------------------- Small UI bits ----------------------------- */
const IconCart = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ""}`} {...props}>
    <path d="M6 6h15l-1.5 9h-12L6 6Z" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="20" r="1" fill="currentColor" />
    <circle cx="18" cy="20" r="1" fill="currentColor" />
    <path d="M6 6l-1-3H2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const IconHome = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ""}`} {...props}>
    <path
      d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

const IconTruck = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ""}`} {...props}>
    <path
      d="M14 17H6a1 1 0 0 1-1-1V5h9v12ZM14 8h4l3 3v5a1 1 0 0 1-1 1h-1"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="7.5" cy="18.5" r="1.5" fill="currentColor" />
    <circle cx="17.5" cy="18.5" r="1.5" fill="currentColor" />
  </svg>
);

function Card({
  children,
  className = "",
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "primary" | "emerald" | "amber" | "neutral";
}) {
  const toneBorder =
    tone === "primary"
      ? "border-primary-200"
      : tone === "emerald"
      ? "border-emerald-200"
      : tone === "amber"
      ? "border-amber-200"
      : "border-border";

  return (
    <div
      className={`rounded-2xl border ${toneBorder} bg-white/90 backdrop-blur shadow-sm overflow-hidden hover:shadow-md transition ${className}`}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  icon,
  action,
  tone = "neutral",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "primary" | "emerald" | "amber" | "neutral";
}) {
  const toneBg =
    tone === "primary"
      ? "from-primary-50 to-white"
      : tone === "emerald"
      ? "from-emerald-50 to-white"
      : tone === "amber"
      ? "from-amber-50 to-white"
      : "from-surface to-white";

  const toneIcon =
    tone === "primary"
      ? "text-primary-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
      ? "text-amber-600"
      : "text-ink-soft";

  return (
    <div className={`flex items-center justify-between p-4 border-b border-border bg-gradient-to-b ${toneBg}`}>
      <div className="flex items-start gap-3">
        {icon && <div className={`mt-[2px] ${toneIcon}`}>{icon}</div>}
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`border border-border rounded-md px-3 py-2 bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 ${
        props.className || ""
      }`}
    />
  );
}

function AddressPreview({ a }: { a: Address }) {
  return (
    <div className="p-4 text-sm leading-6 text-ink">
      <div>
        {a.houseNumber} {a.streetName}
      </div>
      <div>
        {a.town || ""} {a.city || ""} {a.postCode || ""}
      </div>
      <div>
        {a.state}, {a.country}
      </div>
    </div>
  );
}

/* ----------------------------- Component ----------------------------- */
export default function Checkout() {
  const nav = useNavigate();
  const { openModal } = useModal();

  // ✅ auth (cookie based): rely on store hydration + user presence
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    if (!hydrated) {
      bootstrap().catch(() => null);
    }
  }, [hydrated, bootstrap]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user?.id) {
      nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
    }
  }, [hydrated, user?.id, nav]);

  // Verification state
  const [checkingVerification, setCheckingVerification] = useState(true);
  const [emailOk, setEmailOk] = useState<boolean>(false);
  const [phoneOk, setPhoneOk] = useState<boolean>(false);
  const [showNotVerified, setShowNotVerified] = useState<boolean>(false);

  // CART — normalize & persist
  const [cart, setCart] = useState<CartLine[]>(() => readCart());
  useEffect(() => {
    writeCart(cart);
  }, [cart]);

  // ✅ Public settings (marginPercent)
  const publicSettingsQ = useQuery({
    queryKey: ["settings", "public:v1"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: fetchPublicSettings,
  });

  const marginPercent = useMemo(() => extractMarginPercent(publicSettingsQ.data), [publicSettingsQ.data]);

  // ✅ Supplier-split quote (supplier-cost)
  const pricingQ = useQuery({
    queryKey: [
      "checkout",
      "pricing-quote:v1",
      cart
        .map((i) => `${lineKeyFor(i)}@${Math.max(1, asInt(i.qty, 1))}`)
        .sort()
        .join(","),
    ],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    queryFn: () => fetchPricingQuoteForCart(cart),
  });

  const quoteLines = (pricingQ.data as QuotePayload | null)?.lines ?? {};
  const quoteSubtotalSupplier = (pricingQ.data as QuotePayload | null)?.subtotal ?? 0;

  /**
   * ✅ Compute RETAIL totals from supplier quote + marginPercent
   */
  const quoteRetail = useMemo(() => {
    const q = pricingQ.data as QuotePayload | null;
    if (!q) return null;

    const linesRetail: Record<
      string,
      {
        retailLineTotal: number;
        retailMinUnit: number;
        retailMaxUnit: number;
        retailAverageUnit: number;
        allocationsRetail: Array<QuoteAllocation & { retailUnitPrice: number; retailLineTotal: number }>;
      }
    > = {};

    let subtotalRetail = 0;

    for (const [k, ln] of Object.entries(q.lines || {})) {
      const allocs = (ln.allocations || []).filter((a) => a.qty > 0);

      const allocationsRetail = allocs.map((a) => {
        const retailUnitPrice = applyMargin(asMoney(a.unitPrice, 0), marginPercent);
        const retailLineTotal = retailUnitPrice * Math.max(0, asInt(a.qty, 0));
        return {
          ...a,
          retailUnitPrice,
          retailLineTotal,
        };
      });

      const retailLineTotal = allocationsRetail.reduce((s, a) => s + asMoney(a.retailLineTotal, 0), 0);

      const units = allocationsRetail
        .map((a) => asMoney(a.retailUnitPrice, NaN))
        .filter((n) => Number.isFinite(n));

      const retailMinUnit = units.length ? Math.min(...(units as number[])) : 0;
      const retailMaxUnit = units.length ? Math.max(...(units as number[])) : 0;

      const qtyReq = Math.max(1, asInt(ln.qtyRequested, 1));
      const retailAverageUnit = qtyReq > 0 ? retailLineTotal / qtyReq : 0;

      linesRetail[k] = {
        retailLineTotal,
        retailMinUnit,
        retailMaxUnit,
        retailAverageUnit,
        allocationsRetail,
      };

      subtotalRetail += retailLineTotal;
    }

    return {
      subtotalRetail: round2(subtotalRetail),
      linesRetail,
      currency: q.currency ?? null,
    };
  }, [pricingQ.data, marginPercent]);

  // totals needed for fee query (fallback uses cart cache)
  const cartSubtotalFallback = useMemo(() => cart.reduce((s, it) => s + computeLineTotal(it), 0), [cart]);

  // ✅ Retail items subtotal should drive fees + payable total
  const itemsSubtotal = useMemo(() => {
    if (quoteRetail && quoteRetail.subtotalRetail > 0) return quoteRetail.subtotalRetail;
    return cartSubtotalFallback;
  }, [quoteRetail, cartSubtotalFallback]);

  const units = useMemo(() => cart.reduce((s, it) => s + Math.max(1, num(it.qty, 1)), 0), [cart]);

  // Distinct ids (used mainly for display + passing through to backend)
  const productIds = useMemo(() => Array.from(new Set(cart.map((l) => l.productId))), [cart]);
  const supplierIds = useMemo(() => Array.from(new Set(cart.map((l) => l.supplierId).filter(Boolean) as string[])), [cart]);

  // ✅ pricing warning: quote exists but some lines not fully priced
  const pricingWarning = useMemo(() => {
    const q = pricingQ.data as QuotePayload | null;
    if (!q) return null;

    const unpriced = Object.values(q.lines || {}).filter((l) => l.qtyPriced < l.qtyRequested);
    if (!unpriced.length) return null;

    return "Some items could not be fully allocated across suppliers. Reduce quantities or try again.";
  }, [pricingQ.data]);

  // ✅ Authoritative fees from backend — keyed by RETAIL itemsSubtotal
  const serviceFeeQ = useQuery({
    queryKey: ["checkout", "service-fee", { itemsSubtotal, units, productIds, supplierIds }],
    enabled: cart.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set("itemsSubtotal", String(itemsSubtotal));
      qs.set("units", String(units));

      // display-only
      if (productIds.length) qs.set("productIds", productIds.join(","));
      if (supplierIds.length) qs.set("supplierIds", supplierIds.join(","));

      const { data } = await api.get(`/api/settings/checkout/service-fee?${qs.toString()}`);

      return {
        unitFee: Number(data?.unitFee) || 0,
        units: Number(data?.units) || 0,

        taxMode: String(data?.taxMode || "INCLUDED") as "INCLUDED" | "ADDED" | "NONE",
        taxRatePct: Number(data?.taxRatePct) || 0,
        vatAddOn: Number(data?.vatAddOn) || 0,

        serviceFeeBase: Number(data?.serviceFeeBase) || 0,
        serviceFeeComms: Number(data?.serviceFeeComms) || 0,
        serviceFeeGateway: Number(data?.serviceFeeGateway) || 0,
        serviceFeeTotal: Number(data?.serviceFeeTotal ?? data?.serviceFee) || 0,
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const fee = serviceFeeQ.data;
  const taxMode = fee?.taxMode ?? "INCLUDED";
  const taxRatePct = fee?.taxRatePct ?? 0;
  const vatAddOn = fee?.vatAddOn ?? 0;

  const taxRate = useMemo(() => (Number.isFinite(taxRatePct) ? taxRatePct / 100 : 0), [taxRatePct]);

  // Display-only: VAT "included" estimate (when mode is INCLUDED)
  const estimatedVATIncluded = useMemo(() => {
    if (taxMode !== "INCLUDED" || taxRate <= 0) return 0;
    const gross = itemsSubtotal; // includes VAT (per mode)
    const vat = gross - gross / (1 + taxRate);
    return round2(vat);
  }, [itemsSubtotal, taxMode, taxRate]);

  const serviceFeeTotal = fee?.serviceFeeTotal ?? 0;

  // ✅ Matches backend: subtotal + vatAddOn (if ADDED) + serviceFeeTotal
  const payableTotal = itemsSubtotal + (taxMode === "ADDED" ? vatAddOn : 0) + serviceFeeTotal;

  // UI: per-line supplier breakdown toggle
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ADDRESSES
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [homeAddr, setHomeAddr] = useState<Address>(EMPTY_ADDR);
  const [shipAddr, setShipAddr] = useState<Address>(EMPTY_ADDR);

  const [showHomeForm, setShowHomeForm] = useState(false);
  const [showShipForm, setShowShipForm] = useState(false);
  const [sameAsHome, setSameAsHome] = useState(true);

  const [savingHome, setSavingHome] = useState(false);
  const [savingShip, setSavingShip] = useState(false);

  // Verification + addresses load
  useEffect(() => {
    let mounted = true;

    (async () => {
      // if auth not ready, wait (prevents flashing 401 -> modal)
      if (!hydrated) return;
      if (!user?.id) return;

      setCheckingVerification(true);
      setLoadingProfile(true);
      setProfileErr(null);

      try {
        const data = await fetchProfileMe();
        if (!mounted) return;

        const flags = computeVerificationFlags(data);
        setEmailOk(flags.emailOk);
        setPhoneOk(flags.phoneOk);

        if (!flags.emailOk /* || !flags.phoneOk */) {
          setShowNotVerified(true);
        } else {
          setShowNotVerified(false);
        }

        const h = data?.address ?? null;
        const saddr = data?.shippingAddress ?? (data as any)?.shipping_address ?? null;

        if (h) setHomeAddr({ ...EMPTY_ADDR, ...h });
        if (saddr) setShipAddr({ ...EMPTY_ADDR, ...saddr });

        setShowHomeForm(!h);
        setShowShipForm(!saddr);
        setSameAsHome(!!h && !saddr);
      } catch (e: any) {
        if (!mounted) return;

        // Most common: not logged in / cookie not sent
        const status = e?.response?.status;
        if (status === 401) {
          nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
          return;
        }

        setEmailOk(false);
        setPhoneOk(false);
        setShowNotVerified(true);
        setProfileErr(e?.response?.data?.error || "Failed to load profile");
      } finally {
        if (mounted) {
          setCheckingVerification(false);
          setLoadingProfile(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  useEffect(() => {
    if (sameAsHome) setShipAddr((prev) => ({ ...prev, ...homeAddr }));
  }, [sameAsHome, homeAddr]);

  const onChangeHome =
    (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setHomeAddr((a) => ({ ...a, [k]: e.target.value }));

  const onChangeShip =
    (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setShipAddr((a) => ({ ...a, [k]: e.target.value }));

  function validateAddress(a: Address, isShipping = false): string | null {
    const label = isShipping ? "Shipping" : "Home";
    if (!a.houseNumber.trim()) return `Enter ${label} address: house/plot number`;
    if (!a.streetName.trim()) return `Enter ${label} address: street name`;
    if (!a.city.trim()) return `Enter ${label} address: city`;
    if (!a.state.trim()) return `Enter ${label} address: state`;
    if (!a.country.trim()) return `Enter ${label} address: country`;
    return null;
  }

  const saveHome = async () => {
    const v = validateAddress(homeAddr, false);
    if (v) {
      openModal({ title: "Checkout", message: v });
      return;
    }
    try {
      setSavingHome(true);
      await api.post("/api/profile/address", homeAddr);
      setShowHomeForm(false);

      if (sameAsHome) {
        await api.post("/api/profile/shipping", homeAddr);
        setShipAddr(homeAddr);
        setShowShipForm(false);
      }
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
        return;
      }
      openModal({
        title: "Checkout",
        message: e?.response?.data?.error || "Failed to save home address",
      });
    } finally {
      setSavingHome(false);
    }
  };

  const saveShip = async () => {
    const v = validateAddress(shipAddr, true);
    if (v) {
      openModal({ title: "Checkout", message: v });
      return;
    }
    try {
      setSavingShip(true);
      await api.post("/api/profile/shipping", shipAddr);
      setShowShipForm(false);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
        return;
      }
      openModal({
        title: "Checkout",
        message: e?.response?.data?.error || "Failed to save shipping address",
      });
    } finally {
      setSavingShip(false);
    }
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      if (checkingVerification) throw new Error("Checking your account verification…");
      if (!emailOk /* || !phoneOk */) throw new Error("Your email is not verified.");
      if (cart.length === 0) throw new Error("Your cart is empty");

      // ✅ Ensure quote + fees are computed before creating order (prevents mismatch)
      if (pricingQ.isLoading) throw new Error("Calculating best supplier prices… Please try again in a moment.");
      if (pricingWarning) throw new Error(pricingWarning);
      if (serviceFeeQ.isLoading || !fee) throw new Error("Calculating fees… Please try again in a moment.");

      // ✅ Don’t block order if cart cache is 0 but quote retail exists
      const bad = cart.find((l) => {
        const key = lineKeyFor(l);
        const hasRetail = !!quoteRetail?.linesRetail?.[key] && (quoteRetail?.linesRetail?.[key].retailLineTotal ?? 0) > 0;
        const cachedUnit = num(l.unitPrice, num(l.price, 0));
        return cachedUnit <= 0 && !hasRetail;
      });
      if (bad) throw new Error("One or more items have no price. Please remove and re-add them to cart.");

      const vaHome = validateAddress(homeAddr);
      if (vaHome) throw new Error(vaHome);

      const finalShip = sameAsHome ? homeAddr : shipAddr;
      if (!sameAsHome) {
        const vaShip = validateAddress(finalShip, true);
        if (vaShip) throw new Error(vaShip);
      }

      const items = cart.map((it) => ({
        key: lineKeyFor(it),
        productId: it.productId,
        variantId: it.variantId || undefined,
        qty: Math.max(1, num(it.qty, 1)),

        // ✅ send offerId if present
        offerId: it.offerId || undefined,

        selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : undefined,

        // ✅ optional pass-through (harmless if backend ignores)
        kind: it.kind,

        // helpful hints (harmless if backend ignores)
        supplierId: it.supplierId || undefined,

        // cache (harmless if backend ignores)
        unitPriceCache: asMoney(it.unitPrice, asMoney(it.price, 0)),
      }));

      const at = getAttribution();
      const payload = {
        items,
        shippingAddress: finalShip,
        attribution: at,

        // ✅ Send EXACT backend-computed breakdown (do not recompute locally)
        serviceFeeBase: fee.serviceFeeBase ?? 0,
        serviceFeeComms: fee.serviceFeeComms ?? 0,
        serviceFeeGateway: fee.serviceFeeGateway ?? 0,
        serviceFeeTotal: fee.serviceFeeTotal ?? 0,
        serviceFee: fee.serviceFeeTotal ?? 0,

        // ✅ snapshot (retail)
        itemsSubtotal,
        taxMode: fee.taxMode,
        taxRatePct: fee.taxRatePct,
        vatAddOn: fee.vatAddOn,
        total: payableTotal,

        // ✅ margin snapshot (optional)
        marginPercent,

        // quote snapshot (supplier cost) — optional
        quoteSubtotalSupplier: asMoney(quoteSubtotalSupplier, 0),
        quoteCurrency: (pricingQ.data as QuotePayload | null)?.currency ?? null,
      };

      let res;
      try {
        res = await api.post("/api/orders", payload);
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 401) {
          nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
          throw new Error("Please login again.");
        }
        console.error("create order failed:", status, e?.response?.data);
        throw new Error(e?.response?.data?.error || "Failed to create order");
      }

      return res.data as { data: { id: string } };
    },
    onSuccess: (resp) => {
      const orderId = (resp as any)?.data?.id;
      localStorage.removeItem("cart");
      window.dispatchEvent(new Event("cart:updated"));

      nav(`/payment?orderId=${orderId}`, {
        state: {
          orderId,
          total: payableTotal,
          homeAddress: homeAddr,
          shippingAddress: sameAsHome ? homeAddr : shipAddr,
        },
        replace: true,
      });
    },
  });

  if (cart.length === 0) {
    return (
      <div className="min-h-[70vh] grid place-items-center bg-bg-soft">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-semibold text-ink">Your cart is empty</h1>
          <p className="text-ink-soft">Add some items to proceed to checkout.</p>
          <button
            onClick={() => nav("/")}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-white font-medium hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
          >
            Go to Catalogue
          </button>
        </div>
      </div>
    );
  }

  const NotVerifiedModal = () => {
    const title =
      !emailOk && !phoneOk ? "Email and phone not verified" : !emailOk ? "Email not verified" : "Phone is not verified";

    const lines: string[] = [];
    if (!emailOk) lines.push("• Your email is not verified.");
    if ((import.meta as any)?.env?.PHONE_VERIFY === "set" && !phoneOk) lines.push("• Your phone number is not verified.");
    lines.push("Please fix this, then return to your cart/checkout.");

    const next = encodeURIComponent("/checkout");
    const verifyHref = `${VERIFY_PATH}?next=${next}`;

    return (
      <div
        role="dialog"
        aria-modal="true"
        onClick={() => {
          setShowNotVerified(false);
          nav("/cart");
        }}
        className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
      >
        <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-4 border-b">
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>

          <div className="p-5 space-y-3 text-sm">
            {lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}

            <div className="mt-2 space-y-2">
              {(!emailOk || !phoneOk) && (
                <button
                  className="w-full inline-flex items-center justify-center rounded-lg bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
                  onClick={() => nav(verifyHref)}
                  type="button"
                >
                  Verify now
                </button>
              )}
              <div className="text-xs text-ink-soft text-center">
                {!emailOk && (
                  <>
                    Or{" "}
                    <a
                      className="underline"
                      href={verifyHref}
                      onClick={(e) => {
                        e.preventDefault();
                        nav(verifyHref);
                      }}
                    >
                      open verification page
                    </a>
                    .
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="px-5 py-4 border-t flex items-center justify-between gap-2">
            <button
              className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5 text-sm"
              onClick={() => {
                setShowNotVerified(false);
                nav("/cart");
              }}
              type="button"
            >
              Back to cart
            </button>
            <button
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90 text-sm"
              onClick={() => {}}
              disabled
              title="Complete the steps above"
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  };

  const showMarginInfo = publicSettingsQ.isLoading || publicSettingsQ.isError || marginPercent > 0;

  return (
    <SiteLayout>
      <div className="bg-bg-soft bg-hero-radial">
        {!checkingVerification && showNotVerified && <NotVerifiedModal />}

        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
          <div className="mb-6">
            <nav className="flex items-center gap-2 text-sm">
              <span className="text-ink font-medium">Items</span>
              <span className="opacity-40">›</span>
              <span className="text-ink-soft">Address</span>
              <span className="opacity-40">›</span>
              <span className="text-ink-soft">Payment</span>
            </nav>
            <h1 className="mt-2 text-2xl font-semibold text-ink">Checkout</h1>

            {showMarginInfo && (
              <p className="mt-1 text-xs text-ink-soft">
                {publicSettingsQ.isLoading
                  ? "Loading pricing settings…"
                  : publicSettingsQ.isError
                  ? "Could not load margin settings — showing best-effort retail pricing."
                  : `Margin applied: ${marginPercent}%`}
              </p>
            )}

            {profileErr && (
              <p className="mt-2 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                {profileErr}
              </p>
            )}

            {(pricingQ.isLoading || pricingWarning) && (
              <div className="mt-3 text-sm rounded-xl border bg-white/80 p-3 text-ink">
                {pricingQ.isLoading ? "Calculating best supplier prices…" : pricingWarning}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
            {/* LEFT: Items / Addresses */}
            <section className="space-y-6">
              <Card tone="primary" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CardHeader
                  tone="primary"
                  title="Items in your order"
                  subtitle="Pricing shown is retail. Items may split across suppliers."
                  icon={<IconCart />}
                />
                <ul className="divide-y">
                  {cart.map((it) => {
                    const key = lineKeyFor(it);
                    const ql = quoteLines[key];
                    const rl = quoteRetail?.linesRetail?.[key];

                    const qty = Math.max(1, num(it.qty, 1));
                    const cachedUnit = num(it.unitPrice, num(it.price, 0));
                    const cachedLineTotal = computeLineTotal(it);

                    const hasRetailQuote =
                      !!rl && (rl.retailLineTotal > 0 || (rl.allocationsRetail?.length ?? 0) > 0);
                    const quoteLineTotalRetail = hasRetailQuote ? asMoney(rl.retailLineTotal, 0) : cachedLineTotal;

                    const unitText = (() => {
                      if (!hasRetailQuote) return cachedUnit > 0 ? ngn.format(cachedUnit) : "Pending";
                      if (rl.retailMinUnit === rl.retailMaxUnit) return ngn.format(rl.retailMinUnit);
                      if (rl.retailMinUnit > 0 && rl.retailMaxUnit > 0)
                        return `${ngn.format(rl.retailMinUnit)} – ${ngn.format(rl.retailMaxUnit)}`;
                      return rl.retailAverageUnit > 0 ? ngn.format(rl.retailAverageUnit) : "Pending";
                    })();

                    const hasOptions = Array.isArray(it.selectedOptions) && it.selectedOptions!.length > 0;
                    const optionsText = hasOptions
                      ? normalizeSelectedOptions(it.selectedOptions).map((o) => `${o.attribute}: ${o.value}`).join(" • ")
                      : null;

                    const delta = hasRetailQuote ? round2(quoteLineTotalRetail - cachedLineTotal) : 0;
                    const showDelta = hasRetailQuote && Number.isFinite(delta) && Math.abs(delta) >= 0.01;

                    const splitCount = hasRetailQuote ? (rl.allocationsRetail || []).filter((a) => a.qty > 0).length : 0;
                    const splitBadge = splitCount > 1 ? "Split across suppliers" : splitCount === 1 ? "Single supplier" : "";

                    const isExpanded = !!expanded[key];

                    return (
                      <li key={key} className="p-4">
                        <div className="flex items-center gap-4">
                          {it.image ? (
                            <img src={it.image} alt={it.title} className="w-14 h-14 rounded-md object-cover border" />
                          ) : (
                            <div className="w-14 h-14 rounded-md bg-zinc-100 grid place-items-center text-[10px] text-ink-soft border">
                              No image
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-ink truncate">
                                  {it.title}
                                  {it.kind === "VARIANT" || it.variantId ? " (Variant)" : ""}
                                </div>

                                <div className="text-xs text-ink-soft">
                                  Qty: {qty} • Unit: {unitText}
                                  {!!splitBadge && <span className="ml-2">• {splitBadge}</span>}
                                </div>

                                {optionsText && <div className="mt-1 text-xs text-ink-soft">{optionsText}</div>}

                                {showDelta && (
                                  <div className={`mt-1 text-[11px] ${delta > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                                    Live retail price changed {delta > 0 ? "↑" : "↓"} {ngn.format(Math.abs(delta))}
                                  </div>
                                )}

                                {hasRetailQuote && (rl.allocationsRetail?.length ?? 0) > 0 && (
                                  <button
                                    className="mt-2 text-[11px] text-primary-700 hover:underline"
                                    type="button"
                                    onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                                  >
                                    {isExpanded ? "Hide supplier breakdown" : "Show supplier breakdown"}
                                  </button>
                                )}
                              </div>

                              <div className="text-ink font-semibold whitespace-nowrap">{ngn.format(quoteLineTotalRetail)}</div>
                            </div>

                            {/* Retail breakdown */}
                            {hasRetailQuote && isExpanded && (rl.allocationsRetail?.length ?? 0) > 0 && (
                              <div className="mt-3 rounded-xl border bg-white/70 p-3 text-xs">
                                <div className="flex items-center justify-between text-ink-soft">
                                  <span>Supplier split (retail)</span>
                                  <span className="font-medium text-ink">{ngn.format(asMoney(rl.retailLineTotal, 0))}</span>
                                </div>

                                <div className="mt-2 space-y-1">
                                  {rl.allocationsRetail
                                    .filter((a) => a.qty > 0)
                                    .map((a, idx) => (
                                      <div key={`${a.supplierId}-${idx}`} className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="font-medium text-ink truncate">{a.supplierName || "Supplier"}</div>
                                          <div className="text-ink-soft">
                                            {a.qty} × {ngn.format(asMoney(a.retailUnitPrice, 0))}
                                          </div>
                                        </div>
                                        <div className="font-semibold text-ink whitespace-nowrap">{ngn.format(asMoney(a.retailLineTotal, 0))}</div>
                                      </div>
                                    ))}
                                </div>

                                {/* Keep allocation warning from supplier quote */}
                                {ql && ql.qtyPriced < ql.qtyRequested && (
                                  <div className="mt-2 text-[11px] text-rose-700">
                                    Only {ql.qtyPriced} out of {ql.qtyRequested} could be allocated.
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              {/* Home Address */}
              <Card tone="emerald" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CardHeader
                  tone="emerald"
                  title="Home address"
                  subtitle="Saved to your profile."
                  icon={<IconHome />}
                  action={
                    !showHomeForm && (
                      <button className="text-sm text-emerald-700 hover:underline" onClick={() => setShowHomeForm(true)} type="button">
                        Change
                      </button>
                    )
                  }
                />
                {loadingProfile ? (
                  <div className="p-4 text-sm text-ink-soft">Loading…</div>
                ) : showHomeForm ? (
                  <div className="p-4 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={homeAddr.houseNumber} onChange={onChangeHome("houseNumber")} placeholder="House No." />
                      <Input value={homeAddr.postCode} onChange={onChangeHome("postCode")} placeholder="Post code" />
                    </div>
                    <Input value={homeAddr.streetName} onChange={onChangeHome("streetName")} placeholder="Street name" />
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={homeAddr.town} onChange={onChangeHome("town")} placeholder="Town" />
                      <Input value={homeAddr.city} onChange={onChangeHome("city")} placeholder="City" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={homeAddr.state} onChange={onChangeHome("state")} placeholder="State" />
                      <Input value={homeAddr.country} onChange={onChangeHome("country")} placeholder="Country" />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-white font-medium hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 transition disabled:opacity-50"
                        onClick={saveHome}
                        disabled={savingHome}
                      >
                        {savingHome ? "Saving…" : "Done"}
                      </button>
                      <button type="button" className="text-sm text-ink-soft hover:underline" onClick={() => setHomeAddr(EMPTY_ADDR)} disabled={savingHome}>
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <AddressPreview a={homeAddr} />
                )}
              </Card>

              {/* Shipping Address */}
              <Card tone="amber" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CardHeader
                  tone="amber"
                  title="Shipping address"
                  subtitle="Where we’ll deliver your items."
                  icon={<IconTruck />}
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={sameAsHome}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          setSameAsHome(checked);
                          if (checked) {
                            try {
                              setSavingShip(true);
                              await api.post("/api/profile/shipping", homeAddr);
                              setShipAddr(homeAddr);
                              setShowShipForm(false);
                            } catch (err: any) {
                              const status = err?.response?.status;
                              if (status === 401) {
                                nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
                                return;
                              }
                              openModal({
                                title: "Checkout",
                                message: err?.response?.data?.error || "Failed to set shipping as home",
                              });
                            } finally {
                              setSavingShip(false);
                            }
                          }
                        }}
                      />
                      <span className="text-ink-soft">Same as home</span>
                    </label>
                  }
                />
                {sameAsHome ? (
                  <div className="p-4 text-sm text-ink-soft">Using your Home address for shipping.</div>
                ) : loadingProfile ? (
                  <div className="p-4 text-sm text-ink-soft">Loading…</div>
                ) : showShipForm ? (
                  <div className="p-4 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={shipAddr.houseNumber} onChange={onChangeShip("houseNumber")} placeholder="House No." />
                      <Input value={shipAddr.postCode} onChange={onChangeShip("postCode")} placeholder="Post code" />
                    </div>
                    <Input value={shipAddr.streetName} onChange={onChangeShip("streetName")} placeholder="Street name" />
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={shipAddr.town} onChange={onChangeShip("town")} placeholder="Town" />
                      <Input value={shipAddr.city} onChange={onChangeShip("city")} placeholder="City" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={shipAddr.state} onChange={onChangeShip("state")} placeholder="State" />
                      <Input value={shipAddr.country} onChange={onChangeShip("country")} placeholder="Country" />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-white font-medium hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200 transition disabled:opacity-50"
                        onClick={saveShip}
                        disabled={savingShip}
                      >
                        {savingShip ? "Saving…" : "Done"}
                      </button>
                      <button type="button" className="text-sm text-ink-soft hover:underline" onClick={() => setShipAddr(EMPTY_ADDR)} disabled={savingShip}>
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="text-sm leading-6 text-ink">
                        <div>
                          {shipAddr.houseNumber} {shipAddr.streetName}
                        </div>
                        <div>
                          {shipAddr.town || ""} {shipAddr.city || ""} {shipAddr.postCode || ""}
                        </div>
                        <div>
                          {shipAddr.state}, {shipAddr.country}
                        </div>
                      </div>
                      <button className="text-sm text-amber-700 hover:underline" onClick={() => setShowShipForm(true)} type="button">
                        Change
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            </section>

            {/* RIGHT: Summary / Action */}
            <aside className="lg:sticky lg:top-6 h-max">
              <Card className="p-5">
                <h2 className="text-lg font-semibold text-ink">Order Summary</h2>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">Items Subtotal (retail)</span>
                    <span className="font-medium">{ngn.format(itemsSubtotal)}</span>
                  </div>

                  {taxMode === "INCLUDED" && estimatedVATIncluded > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-soft">VAT (included)</span>
                      <span className="text-ink-soft">{ngn.format(estimatedVATIncluded)}</span>
                    </div>
                  )}

                  {taxMode === "ADDED" && vatAddOn > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-ink-soft">VAT</span>
                      <span className="font-medium">{ngn.format(vatAddOn)}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">Shipping</span>
                    <span className="font-medium">Included by supplier</span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border">
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-ink">Service fee (total)</span>
                      <span className="font-semibold">{ngn.format(serviceFeeTotal)}</span>
                    </div>
                    {serviceFeeQ.isLoading && <div className="mt-1 text-xs text-ink-soft">Calculating fees…</div>}
                    {serviceFeeQ.isError && <div className="mt-1 text-xs text-danger">Failed to compute fees</div>}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-ink">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-semibold">{ngn.format(payableTotal)}</span>
                </div>

                {pricingWarning && (
                  <p className="mt-3 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">{pricingWarning}</p>
                )}

                <button
                  disabled={createOrder.isPending || serviceFeeQ.isLoading || pricingQ.isLoading || !!pricingWarning}
                  onClick={() => createOrder.mutate()}
                  className="mt-5 w-full inline-flex items-center justify-center rounded-lg bg-accent-500 text-white px-4 py-2.5 font-medium hover:bg-accent-600 active:bg-accent-700 focus:outline-none focus:ring-4 focus:ring-accent-200 transition disabled:opacity-50"
                  type="button"
                >
                  {createOrder.isPending
                    ? "Processing…"
                    : pricingQ.isLoading
                    ? "Calculating supplier prices…"
                    : "Place order & Proceed to payment"}
                </button>

                {createOrder.isError && (
                  <p className="mt-3 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                    {(() => {
                      const err = createOrder.error as any;
                      if (err && typeof err === "object" && "response" in err) {
                        const axiosErr = err as { response?: { data?: { error?: string } } };
                        return axiosErr.response?.data?.error || "Failed to create order";
                      }
                      return (err as Error)?.message || "Failed to create order";
                    })()}
                  </p>
                )}

                <button
                  onClick={() => nav("/cart")}
                  className="mt-3 w-full inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
                  type="button"
                >
                  Back to cart
                </button>

                <p className="mt-3 text-[11px] text-ink-soft text-center">
                  Totals use live supplier offers + margin. If an offer changes or stock reallocates, your pricing may update.
                </p>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
