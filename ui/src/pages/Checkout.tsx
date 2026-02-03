// src/pages/Checkout.tsx

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuthStore } from '../store/auth';
import { useModal } from '../components/ModalProvider';
import SiteLayout from '../layouts/SiteLayout.js';
import { getAttribution } from '../utils/attribution.js';

/* ----------------------------- Config ----------------------------- */
const VERIFY_PATH = '/verify';

/* ----------------------------- Types ----------------------------- */
type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartLine = {
  kind?: 'BASE' | 'VARIANT'; // ✅ preserve cart separation

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
  houseNumber: '',
  streetName: '',
  postCode: '',
  town: '',
  city: '',
  state: '',
  country: 'Nigeria',
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* ----------------------------- Helpers ----------------------------- */
const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = toArray<SelectedOption>(raw)
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ''),
      attribute: String(o.attribute ?? ''),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ''),
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
  if (!s.length) return '';
  return s.map((o) => `${o.attributeId}=${o.valueId ?? o.value}`).join('|');
}

/**
 * ✅ Stable cart line key (must match Cart.tsx intent)
 * - base product: productId::base
 * - variant by id: productId::v:<variantId>
 * - options-only fallback: productId::o:<optionsKey>
 */
function lineKeyFor(item: Pick<CartLine, 'productId' | 'variantId' | 'selectedOptions' | 'kind'>) {
  const pid = String(item.productId);
  const vid = item.variantId == null ? null : String(item.variantId);
  const sel = normalizeSelectedOptions(item.selectedOptions);

  const kind: 'BASE' | 'VARIANT' =
    item.kind === 'BASE' || item.kind === 'VARIANT' ? item.kind : item.variantId ? 'VARIANT' : 'BASE';

  if (kind === 'VARIANT') {
    if (vid) return `${pid}::v:${vid}`;
    return sel.length ? `${pid}::o:${optionsKey(sel)}` : `${pid}::v:unknown`;
  }

  return `${pid}::base`;
}

// Normalize whatever we find in localStorage to a consistent shape
function readCart(): CartLine[] {
  try {
    const raw = localStorage.getItem('cart');
    const arr: any[] = raw ? JSON.parse(raw) : [];

    return arr.map((x) => {
      const unit = num(x.unitPrice, num(x.price, 0));
      const qty = Math.max(1, num(x.qty, 1));

      const rawKind = x.kind === 'BASE' || x.kind === 'VARIANT' ? x.kind : undefined;
      const inferredKind: 'BASE' | 'VARIANT' = rawKind ?? (x.variantId ? 'VARIANT' : 'BASE');

      const selectedOptions = normalizeSelectedOptions(x.selectedOptions);

      return {
        kind: inferredKind,

        productId: String(x.productId),
        title: String(x.title ?? ''),
        qty,
        unitPrice: unit,
        variantId: x.variantId ?? null,
        selectedOptions,

        price: unit,
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

    const rawKind = l.kind === 'BASE' || l.kind === 'VARIANT' ? l.kind : undefined;
    const inferredKind: 'BASE' | 'VARIANT' = rawKind ?? (l.variantId ? 'VARIANT' : 'BASE');

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

      // legacy mirror
      price: unit,
      totalPrice: total,
    };
  });

  localStorage.setItem('cart', JSON.stringify(out));
}

function computeLineTotal(line: CartLine): number {
  const unit = num(line.unitPrice, num(line.price, 0));
  const qty = Math.max(1, num(line.qty, 1));
  return unit * qty;
}

/* -------- Verification helpers -------- */
type ProfileMe = {
  emailVerifiedAt?: unknown;
  phoneVerifiedAt?: unknown;
  address?: Partial<Address> | null;
  shippingAddress?: Partial<Address> | null;
};

const normalizeStampPresent = (v: unknown) => {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'null' || s === 'undefined') return false;
  if (typeof v === 'boolean') return v;
  return true;
};

function computeVerificationFlags(p?: ProfileMe) {
  const emailOk = normalizeStampPresent(p?.emailVerifiedAt);
  const phoneOk = normalizeStampPresent(p?.phoneVerifiedAt);
  return { emailOk, phoneOk };
}

/* ---------------- Supplier offers helpers (for price fallback) --------------- */

const asInt = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};
const asMoney = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* ----------------------------- Small UI bits ----------------------------- */
const IconCart = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ''}`} {...props}>
    <path d="M6 6h15l-1.5 9h-12L6 6Z" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="20" r="1" fill="currentColor" />
    <circle cx="18" cy="20" r="1" fill="currentColor" />
    <path d="M6 6l-1-3H2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const IconHome = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ''}`} {...props}>
    <path
      d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

const IconTruck = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ''}`} {...props}>
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
  className = '',
  tone = 'neutral',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'primary' | 'emerald' | 'amber' | 'neutral';
}) {
  const toneBorder =
    tone === 'primary'
      ? 'border-primary-200'
      : tone === 'emerald'
        ? 'border-emerald-200'
        : tone === 'amber'
          ? 'border-amber-200'
          : 'border-border';

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
  tone = 'neutral',
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'primary' | 'emerald' | 'amber' | 'neutral';
}) {
  const toneBg =
    tone === 'primary'
      ? 'from-primary-50 to-white'
      : tone === 'emerald'
        ? 'from-emerald-50 to-white'
        : tone === 'amber'
          ? 'from-amber-50 to-white'
          : 'from-surface to-white';

  const toneIcon =
    tone === 'primary'
      ? 'text-primary-600'
      : tone === 'emerald'
        ? 'text-emerald-600'
        : tone === 'amber'
          ? 'text-amber-600'
          : 'text-ink-soft';

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
      className={`border border-border rounded-md px-3 py-2 bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 ${props.className || ''
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
        {a.town || ''} {a.city || ''} {a.postCode || ''}
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
  const token = useAuthStore((s) => s.token);

  // Verification state
  const [checkingVerification, setCheckingVerification] = useState(true);
  const [emailOk, setEmailOk] = useState<boolean>(false);
  const [phoneOk, setPhoneOk] = useState<boolean>(false);
  const [showNotVerified, setShowNotVerified] = useState<boolean>(false);

  // require login for checkout
  useEffect(() => {
    if (!token) nav('/login', { state: { from: { pathname: '/checkout' } } });
  }, [token, nav]);

  // CART — normalize & persist
  const [cart, setCart] = useState<CartLine[]>(() => readCart());
  useEffect(() => {
    writeCart(cart);
  }, [cart]);

  // This prevents “client sent X, server computed Y” mismatches.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // cache product fetches so we only hit API once per productId
        const productCache = new Map<string, any>();

        const getProduct = async (productId: string) => {
          const pid = String(productId);
          if (productCache.has(pid)) return productCache.get(pid);

          const resp = await api.get(`/api/products/${pid}`, {
            params: { include: "variants" }, // keep light; add "variants.options" only if your API supports it
          });
          const productData = resp.data?.data ?? resp.data ?? null;
          productCache.set(pid, productData);
          return productData;
        };

        const computeRetailUnit = (productData: any, line: CartLine): number => {
          const baseRetail = num(productData?.retailPrice, 0);
          if (!(baseRetail > 0)) return 0;

          const isVariant = line.kind === "VARIANT" || !!line.variantId;
          if (!isVariant) return baseRetail;

          const vid = line.variantId ? String(line.variantId) : null;

          // Prefer explicit variant bump if present
          if (vid && Array.isArray(productData?.variants)) {
            const v = productData.variants.find((vv: any) => String(vv.id) === vid);
            if (v) {
              // In your backend: Variant.retailPrice is treated as a bump
              const bump1 = Math.max(0, num(v?.retailPrice, 0));
              if (bump1 > 0) return baseRetail + bump1;

              // Optional fallback: if your product endpoint includes options with priceBump
              const optionBumps: number[] = Array.isArray(v?.options)
                ? v.options.map((o: any) => Math.max(0, num(o?.priceBump, 0))).filter((x: number) => x > 0)
                : [];

              const bump2 = optionBumps.length ? Math.max(...optionBumps) : 0;
              return baseRetail + bump2;
            }
          }

          // If we cannot resolve the variant record, still price as base retail (safer than offers)
          return baseRetail;
        };

        const updated = await Promise.all(
          cart.map(async (line) => {
            const productData = await getProduct(line.productId);

            const retailUnit = computeRetailUnit(productData, line);

            // If we cannot compute retail, keep existing value (but createOrder will block if 0)
            const finalUnit = retailUnit > 0 ? retailUnit : num(line.unitPrice, num(line.price, 0));

            const qty = Math.max(1, num(line.qty, 1));

            // Image refresh (optional)
            let img: string | null = line.image ?? null;
            if (!img && productData) {
              if (line.variantId && Array.isArray(productData?.variants)) {
                const v = productData.variants.find((vv: any) => String(vv.id) === String(line.variantId));
                if (!img && Array.isArray(v?.imagesJson) && v.imagesJson[0]) img = v.imagesJson[0];
              }
              if (!img && Array.isArray(productData?.imagesJson) && productData.imagesJson[0]) img = productData.imagesJson[0];
            }

            return {
              ...line,
              unitPrice: finalUnit,
              price: finalUnit, // keep legacy mirror in sync
              totalPrice: finalUnit * qty,
              image: img,
            };
          })
        );

        if (!mounted) return;

        setCart(updated);
        writeCart(updated);
      } catch {
        // ignore; we still have original cart
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;

  // Distinct ids (used mainly for display + passing through to backend)
  const productIds = useMemo(() => Array.from(new Set(cart.map((l) => l.productId))), [cart]);
  const supplierIds = useMemo(
    () => Array.from(new Set(cart.map((l) => l.supplierId).filter(Boolean) as string[])),
    [cart]
  );

  // totals needed for fee query
  const itemsSubtotal = useMemo(() => cart.reduce((s, it) => s + computeLineTotal(it), 0), [cart]);
  const units = useMemo(() => cart.reduce((s, it) => s + Math.max(1, num(it.qty, 1)), 0), [cart]);

  // ✅ Authoritative fees from backend (MATCHES orders.ts)
  const serviceFeeQ = useQuery({
    queryKey: ['checkout', 'service-fee', { itemsSubtotal, units, productIds, supplierIds }],
    enabled: cart.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('itemsSubtotal', String(itemsSubtotal));
      qs.set('units', String(units));

      // display-only
      if (productIds.length) qs.set('productIds', productIds.join(','));
      if (supplierIds.length) qs.set('supplierIds', supplierIds.join(','));

      const { data } = await api.get(`/api/settings/checkout/service-fee?${qs.toString()}`);

      return {
        unitFee: Number(data?.unitFee) || 0,
        units: Number(data?.units) || 0,

        taxMode: String(data?.taxMode || 'INCLUDED') as 'INCLUDED' | 'ADDED' | 'NONE',
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
  const taxMode = fee?.taxMode ?? 'INCLUDED';
  const taxRatePct = fee?.taxRatePct ?? 0;
  const vatAddOn = fee?.vatAddOn ?? 0;

  const taxRate = useMemo(() => (Number.isFinite(taxRatePct) ? taxRatePct / 100 : 0), [taxRatePct]);
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Display-only: VAT "included" estimate (when mode is INCLUDED)
  const estimatedVATIncluded = useMemo(() => {
    if (taxMode !== 'INCLUDED' || taxRate <= 0) return 0;
    const gross = itemsSubtotal; // includes VAT
    const vat = gross - gross / (1 + taxRate);
    return round2(vat);
  }, [itemsSubtotal, taxMode, taxRate]);

  const serviceFeeTotal = fee?.serviceFeeTotal ?? 0;

  // ✅ Matches backend: subtotal + vatAddOn (if ADDED) + serviceFeeTotal
  const payableTotal = itemsSubtotal + (taxMode === 'ADDED' ? vatAddOn : 0) + serviceFeeTotal;

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
      if (!token) return;

      setCheckingVerification(true);
      setLoadingProfile(true);
      setProfileErr(null);

      try {
        const res = await api.get<ProfileMe>('/api/profile/me', { headers: authHeader });
        if (!mounted) return;

        const flags = computeVerificationFlags(res.data);
        setEmailOk(flags.emailOk);
        setPhoneOk(flags.phoneOk);

        if (!flags.emailOk /* || !flags.phoneOk */) {
          setShowNotVerified(true);
        }

        const h = res.data?.address ?? (res.data as any)?.address ?? null;
        const saddr = res.data?.shippingAddress ?? (res.data as any)?.shipping_address ?? null;

        if (h) setHomeAddr({ ...EMPTY_ADDR, ...h });
        if (saddr) setShipAddr({ ...EMPTY_ADDR, ...saddr });

        setShowHomeForm(!h);
        setShowShipForm(!saddr);
        setSameAsHome(!!h && !saddr);
      } catch (e: any) {
        if (!mounted) return;
        setEmailOk(false);
        setPhoneOk(false);
        setShowNotVerified(true);
        setProfileErr(e?.response?.data?.error || 'Failed to load profile');
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
  }, [token]);

  useEffect(() => {
    if (sameAsHome) setShipAddr((prev) => ({ ...prev, ...homeAddr }));
  }, [sameAsHome, homeAddr]);

  const onChangeHome =
    (k: keyof Address) =>
      (e: React.ChangeEvent<HTMLInputElement>) =>
        setHomeAddr((a) => ({ ...a, [k]: e.target.value }));

  const onChangeShip =
    (k: keyof Address) =>
      (e: React.ChangeEvent<HTMLInputElement>) =>
        setShipAddr((a) => ({ ...a, [k]: e.target.value }));

  function validateAddress(a: Address, isShipping = false): string | null {
    const label = isShipping ? 'Shipping' : 'Home';
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
      openModal({ title: 'Checkout', message: v });
      return;
    }
    try {
      setSavingHome(true);
      await api.post('/api/profile/address', homeAddr, { headers: authHeader });
      setShowHomeForm(false);

      if (sameAsHome) {
        await api.post('/api/profile/shipping', homeAddr, { headers: authHeader });
        setShipAddr(homeAddr);
        setShowShipForm(false);
      }
    } catch (e: any) {
      openModal({
        title: 'Checkout',
        message: e?.response?.data?.error || 'Failed to save home address',
      });
    } finally {
      setSavingHome(false);
    }
  };

  const saveShip = async () => {
    const v = validateAddress(shipAddr, true);
    if (v) {
      openModal({ title: 'Checkout', message: v });
      return;
    }
    try {
      setSavingShip(true);
      await api.post('/api/profile/shipping', shipAddr, { headers: authHeader });
      setShowShipForm(false);
    } catch (e: any) {
      openModal({
        title: 'Checkout',
        message: e?.response?.data?.error || 'Failed to save shipping address',
      });
    } finally {
      setSavingShip(false);
    }
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      if (checkingVerification) throw new Error('Checking your account verification…');
      if (!emailOk /* || !phoneOk */) throw new Error('Your email is not verified.');

      if (cart.length === 0) throw new Error('Your cart is empty');

      // Ensure fees are computed before creating order (prevents mismatch)
      if (serviceFeeQ.isLoading || !fee) throw new Error('Calculating fees… Please try again in a moment.');

      const bad = cart.find((l) => num(l.unitPrice, num(l.price, 0)) <= 0);
      if (bad) throw new Error('One or more items have no price. Please remove and re-add them to cart.');

      const vaHome = validateAddress(homeAddr);
      if (vaHome) throw new Error(vaHome);

      const finalShip = sameAsHome ? homeAddr : shipAddr;
      if (!sameAsHome) {
        const vaShip = validateAddress(finalShip, true);
        if (vaShip) throw new Error(vaShip);
      }

      const items = cart.map((it) => ({
        productId: it.productId,
        variantId: it.variantId || undefined,
        qty: Math.max(1, num(it.qty, 1)),

        // ✅ send offerId if present
        offerId: it.offerId || undefined,

        selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : undefined,

        // ✅ optional pass-through (harmless if backend ignores)
        kind: it.kind,
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

        // snapshot (optional but useful)
        itemsSubtotal,
        taxMode: fee.taxMode,
        taxRatePct: fee.taxRatePct,
        vatAddOn: fee.vatAddOn,
        total: payableTotal,
      };

      let res;
      try {
        res = await api.post('/api/orders', payload, { headers: authHeader });
      } catch (e: any) {
        console.error('create order failed:', e?.response?.status, e?.response?.data);
        throw new Error(e?.response?.data?.error || 'Failed to create order');
      }

      return res.data as { data: { id: string } };
    },
    onSuccess: (resp) => {
      const orderId = (resp as any)?.data?.id;
      localStorage.removeItem('cart');
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
            onClick={() => nav('/')}
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
      !emailOk && !phoneOk
        ? 'Email and password not verified'
        : !emailOk
          ? 'Email not verified'
          : 'Phone is not verified';

    const lines: string[] = [];
    if (!emailOk) lines.push('• Your email is not verified.');
    lines.push('Please fix this, then return to your cart/checkout.');

    const next = encodeURIComponent('/checkout');
    const verifyHref = `${VERIFY_PATH}?next=${next}`;

    return (
      <div
        role="dialog"
        aria-modal="true"
        onClick={() => {
          setShowNotVerified(false);
          nav('/cart');
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
                >
                  Verify email now
                </button>
              )}
              <div className="text-xs text-ink-soft text-center">
                {!emailOk && (
                  <>
                    Or{' '}
                    <a
                      className="underline"
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
                nav('/cart');
              }}
            >
              Back to cart
            </button>
            <button
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90 text-sm"
              onClick={() => { }}
              disabled
              title="Complete the steps above"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  };

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
            {profileErr && (
              <p className="mt-2 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                {profileErr}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
            {/* LEFT: Items / Addresses */}
            <section className="space-y-6">
              <Card tone="primary" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CardHeader
                  tone="primary"
                  title="Items in your order"
                  subtitle="Review quantities and pricing before adding addresses."
                  icon={<IconCart />}
                />
                <ul className="divide-y">
                  {cart.map((it) => {
                    const unit = num(it.unitPrice, num(it.price, 0));
                    const lineTotal = computeLineTotal(it);
                    const hasOptions = Array.isArray(it.selectedOptions) && it.selectedOptions!.length > 0;
                    const optionsText = hasOptions
                      ? normalizeSelectedOptions(it.selectedOptions).map((o) => `${o.attribute}: ${o.value}`).join(' • ')
                      : null;

                    return (
                      <li key={lineKeyFor(it)} className="p-4">
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
                                  {it.kind === 'VARIANT' || it.variantId ? ' (Variant)' : ''}
                                </div>
                                <div className="text-xs text-ink-soft">
                                  Qty: {it.qty} • Unit: {ngn.format(unit)}
                                </div>
                                {optionsText && <div className="mt-1 text-xs text-ink-soft">{optionsText}</div>}
                              </div>
                              <div className="text-ink font-semibold whitespace-nowrap">{ngn.format(lineTotal)}</div>
                            </div>
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
                      <button className="text-sm text-emerald-700 hover:underline" onClick={() => setShowHomeForm(true)}>
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
                      <Input value={homeAddr.houseNumber} onChange={onChangeHome('houseNumber')} placeholder="House No." />
                      <Input value={homeAddr.postCode} onChange={onChangeHome('postCode')} placeholder="Post code" />
                    </div>
                    <Input value={homeAddr.streetName} onChange={onChangeHome('streetName')} placeholder="Street name" />
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={homeAddr.town} onChange={onChangeHome('town')} placeholder="Town" />
                      <Input value={homeAddr.city} onChange={onChangeHome('city')} placeholder="City" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={homeAddr.state} onChange={onChangeHome('state')} placeholder="State" />
                      <Input value={homeAddr.country} onChange={onChangeHome('country')} placeholder="Country" />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-white font-medium hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 transition disabled:opacity-50"
                        onClick={saveHome}
                        disabled={savingHome}
                      >
                        {savingHome ? 'Saving…' : 'Done'}
                      </button>
                      <button
                        type="button"
                        className="text-sm text-ink-soft hover:underline"
                        onClick={() => setHomeAddr(EMPTY_ADDR)}
                        disabled={savingHome}
                      >
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
                              await api.post('/api/profile/shipping', homeAddr, { headers: authHeader });
                              setShipAddr(homeAddr);
                              setShowShipForm(false);
                            } catch (err: any) {
                              openModal({
                                title: 'Checkout',
                                message: err?.response?.data?.error || 'Failed to set shipping as home',
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
                      <Input value={shipAddr.houseNumber} onChange={onChangeShip('houseNumber')} placeholder="House No." />
                      <Input value={shipAddr.postCode} onChange={onChangeShip('postCode')} placeholder="Post code" />
                    </div>
                    <Input value={shipAddr.streetName} onChange={onChangeShip('streetName')} placeholder="Street name" />
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={shipAddr.town} onChange={onChangeShip('town')} placeholder="Town" />
                      <Input value={shipAddr.city} onChange={onChangeShip('city')} placeholder="City" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={shipAddr.state} onChange={onChangeShip('state')} placeholder="State" />
                      <Input value={shipAddr.country} onChange={onChangeShip('country')} placeholder="Country" />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-white font-medium hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200 transition disabled:opacity-50"
                        onClick={saveShip}
                        disabled={savingShip}
                      >
                        {savingShip ? 'Saving…' : 'Done'}
                      </button>
                      <button
                        type="button"
                        className="text-sm text-ink-soft hover:underline"
                        onClick={() => setShipAddr(EMPTY_ADDR)}
                        disabled={savingShip}
                      >
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
                          {shipAddr.town || ''} {shipAddr.city || ''} {shipAddr.postCode || ''}
                        </div>
                        <div>
                          {shipAddr.state}, {shipAddr.country}
                        </div>
                      </div>
                      <button className="text-sm text-amber-700 hover:underline" onClick={() => setShowShipForm(true)}>
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
                    <span className="text-ink-soft">Items Subtotal</span>
                    <span className="font-medium">{ngn.format(itemsSubtotal)}</span>
                  </div>

                  {taxMode === 'INCLUDED' && estimatedVATIncluded > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-soft">VAT (included)</span>
                      <span className="text-ink-soft">{ngn.format(estimatedVATIncluded)}</span>
                    </div>
                  )}

                  {taxMode === 'ADDED' && vatAddOn > 0 && (
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

                <button
                  disabled={createOrder.isPending || serviceFeeQ.isLoading}
                  onClick={() => createOrder.mutate()}
                  className="mt-5 w-full inline-flex items-center justify-center rounded-lg bg-accent-500 text-white px-4 py-2.5 font-medium hover:bg-accent-600 active:bg-accent-700 focus:outline-none focus:ring-4 focus:ring-accent-200 transition disabled:opacity-50"
                >
                  {createOrder.isPending ? 'Processing…' : 'Place order & Proceed to payment'}
                </button>

                {createOrder.isError && (
                  <p className="mt-3 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                    {(() => {
                      const err = createOrder.error as any;
                      if (err && typeof err === 'object' && 'response' in err) {
                        const axiosErr = err as { response?: { data?: { error?: string } } };
                        return axiosErr.response?.data?.error || 'Failed to create order';
                      }
                      return (err as Error)?.message || 'Failed to create order';
                    })()}
                  </p>
                )}

                <button
                  onClick={() => nav('/cart')}
                  className="mt-3 w-full inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
                >
                  Back to cart
                </button>

                <p className="mt-3 text-[11px] text-ink-soft text-center">
                  Fees are estimates. Any gateway differences are reconciled on your receipt.
                </p>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
