import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useModal } from '../components/ModalProvider';

/* ----------------------------- Types ----------------------------- */
type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartLine = {
  productId: string;
  title: string;
  qty: number;

  unitPrice?: number;
  variantId?: string | null;
  selectedOptions?: SelectedOption[];

  // legacy mirror
  price?: number;
  totalPrice?: number;

  // NEW: keep image through checkout
  image?: string | null;
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

type ProfileMe = {
  address?: Address | null;
  shippingAddress?: Address | null;
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

// Normalize whatever we find in localStorage to a consistent shape
function readCart(): CartLine[] {
  try {
    const raw = localStorage.getItem('cart');
    const arr: any[] = raw ? JSON.parse(raw) : [];
    return arr.map((x) => {
      const unit = num(x.unitPrice, num(x.price, 0));
      const qty = Math.max(1, num(x.qty, 1));
      return {
        productId: String(x.productId),
        title: String(x.title ?? ''),
        qty,
        unitPrice: unit,
        variantId: x.variantId ?? null,
        selectedOptions: Array.isArray(x.selectedOptions) ? x.selectedOptions : undefined,
        price: unit,                          // legacy
        totalPrice: num(x.totalPrice, unit * qty), // legacy
        image: x.image ?? null,
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
    return {
      productId: l.productId,
      title: l.title,
      qty,
      unitPrice: unit,
      variantId: l.variantId ?? null,
      selectedOptions: l.selectedOptions ?? [],
      image: l.image ?? null,

      // legacy mirror:
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
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const IconTruck = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ''}`} {...props}>
    <path d="M14 17H6a1 1 0 0 1-1-1V5h9v12ZM14 8h4l3 3v5a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.5" />
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
    tone === 'primary' ? 'border-primary-200' :
    tone === 'emerald' ? 'border-emerald-200' :
    tone === 'amber' ? 'border-amber-200' :
    'border-border';

  return (
    <div className={`rounded-2xl border ${toneBorder} bg-white/90 backdrop-blur shadow-sm overflow-hidden hover:shadow-md transition ${className}`}>
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
    tone === 'primary' ? 'from-primary-50 to-white' :
    tone === 'emerald' ? 'from-emerald-50 to-white' :
    tone === 'amber' ? 'from-amber-50 to-white' :
    'from-surface to-white';

  const toneIcon =
    tone === 'primary' ? 'text-primary-600' :
    tone === 'emerald' ? 'text-emerald-600' :
    tone === 'amber' ? 'text-amber-600' :
    'text-ink-soft';

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
      className={`border border-border rounded-md px-3 py-2 bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 ${props.className || ''}`}
    />
  );
}

function AddressPreview({ a }: { a: Address }) {
  return (
    <div className="p-4 text-sm leading-6 text-ink">
      <div>{a.houseNumber} {a.streetName}</div>
      <div>{a.town || ''} {a.city || ''} {a.postCode || ''}</div>
      <div>{a.state}, {a.country}</div>
    </div>
  );
}

/* ----------------------------- Component ----------------------------- */
export default function Checkout() {
  const nav = useNavigate();
  const { openModal } = useModal();
  const token = useAuthStore((s) => s.token);

  // Require login for checkout
  useEffect(() => {
    if (!token) nav('/login', { state: { from: { pathname: '/checkout' } } });
  }, [token, nav]);

  // CART — normalize & persist the normalized shape
  const [cart, setCart] = useState<CartLine[]>(() => readCart());
  useEffect(() => {
    writeCart(cart);
  }, [cart]);

  // 🔧 Hydrate missing prices if any (safety net)
  useEffect(() => {
    (async () => {
      const needs = cart.filter((l) => num(l.unitPrice, num(l.price, 0)) <= 0);
      if (needs.length === 0) return;

      try {
        const updated = await Promise.all(cart.map(async (line) => {
          const currentUnit = num(line.unitPrice, num(line.price, 0));
          if (currentUnit > 0) return line;

          const resp = await api.get(`/api/products/${line.productId}?include=variants`);
          const p = resp.data || {};
          const base = num(p?.price, 0);

          let unit = base;
          if (line.variantId && Array.isArray(p?.variants)) {
            const v = p.variants.find((vv: any) => String(vv.id) === String(line.variantId));
            if (v && num(v.price, NaN) >= 0) {
              unit = num(v.price, base);
            }
          }

          const qty = Math.max(1, num(line.qty, 1));
          return {
            ...line,
            unitPrice: unit,
            price: unit,
            totalPrice: unit * qty,
            image: line.image ?? (Array.isArray(p?.imagesJson) ? p.imagesJson[0] : null),
          };
        }));

        setCart(updated);
        writeCart(updated);
      } catch {
        // ignore; guard below prevents ordering with zero prices
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = useMemo(
    () => cart.reduce((sum, it) => sum + computeLineTotal(it), 0),
    [cart]
  );

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

  // Load existing addresses
  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!token) return;
      setLoadingProfile(true);
      setProfileErr(null);
      try {
        const res = await api.get<ProfileMe>('/api/profile/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!mounted) return;

        const h = res.data?.address || null;
        const s = res.data?.shippingAddress || null;

        if (h) setHomeAddr({ ...EMPTY_ADDR, ...h });
        if (s) setShipAddr({ ...EMPTY_ADDR, ...s });

        setShowHomeForm(!h);
        setShowShipForm(!s);
        setSameAsHome(!!h && !s);
      } catch (e: any) {
        if (!mounted) return;
        setProfileErr(e?.response?.data?.error || 'Failed to load profile');
      } finally {
        if (mounted) setLoadingProfile(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [token]);

  // Keep shipping in sync when "same as home" toggles on
  useEffect(() => {
    if (sameAsHome) setShipAddr((prev) => ({ ...prev, ...homeAddr }));
  }, [sameAsHome, homeAddr]);

  // Helpers
  const onChangeHome = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setHomeAddr((a) => ({ ...a, [k]: e.target.value }));

  const onChangeShip = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
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

  const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;

  const saveHome = async () => {
    const v = validateAddress(homeAddr, false);
    if (v) { openModal({ title: 'Checkout', message: v }); return; }
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
      openModal({ title: 'Checkout', message: e?.response?.data?.error || 'Failed to save home address' });
    } finally {
      setSavingHome(false);
    }
  };

  const saveShip = async () => {
    const v = validateAddress(shipAddr, true);
    if (v) { openModal({ title: 'Checkout', message: v }); return; }
    try {
      setSavingShip(true);
      await api.post('/api/profile/shipping', shipAddr, { headers: authHeader });
      setShowShipForm(false);
    } catch (e: any) {
      openModal({ title: 'Checkout', message: e?.response?.data?.error || 'Failed to save shipping address' });
    } finally {
      setSavingShip(false);
    }
  };

  // Create order → go to payment
  const createOrder = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error('Your cart is empty');

      // guard: any line still without price? stop
      const bad = cart.find((l) => num(l.unitPrice, num(l.price, 0)) <= 0);
      if (bad) throw new Error('One or more items have no price. Please remove and re-add them to cart.');

      const vaHome = validateAddress(homeAddr);
      if (vaHome) throw new Error(vaHome);

      const finalShip = sameAsHome ? homeAddr : shipAddr;
      if (!sameAsHome) {
        const vaShip = validateAddress(finalShip, true);
        if (vaShip) throw new Error(vaShip);
      }

      // Build order items (includes variants & options if present)
      const items = cart.map((it) => ({
        productId: it.productId,
        variantId: it.variantId || undefined,
        qty: Math.max(1, num(it.qty, 1)),
        title: it.title,
        unitPrice: num(it.unitPrice, num(it.price, 0)),
        selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : undefined,
        imageUrl: it.image ?? undefined, // optional; backend may ignore
      }));

      const payload = {
        items,
        shipping: 0,
        tax: 0,
        homeAddress: homeAddr,
        shippingAddress: finalShip,
      };

      const res = await api.post('/api/orders', payload, { headers: authHeader });
      return res.data as { id: string };
    },
    onSuccess: (order) => {
      localStorage.removeItem('cart');
      nav(`/payment?orderId=${order.id}`, {
        state: {
          orderId: order.id,
          total: subtotal,
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

  return (
    <div className="bg-bg-soft bg-hero-radial">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        {/* Step header */}
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
          {/* LEFT: Items → Home → Shipping */}
          <section className="space-y-6">
            {/* Items */}
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
                  const hasOptions = Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0;
                  const optionsText = hasOptions
                    ? it.selectedOptions!.map(o => `${o.attribute}: ${o.value}`).join(' • ')
                    : null;

                  return (
                    <li key={`${it.productId}-${it.variantId ?? 'base'}`} className="p-4">
                      <div className="flex items-center gap-4">
                        {it.image ? (
                          <img
                            src={it.image}
                            alt={it.title}
                            className="w-14 h-14 rounded-md object-cover border"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-md bg-zinc-100 grid place-items-center text-[10px] text-ink-soft border">
                            No image
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-ink truncate">
                                {it.title}{it.variantId ? ' (Variant)' : ''}
                              </div>
                              <div className="text-xs text-ink-soft">
                                Qty: {it.qty} • Unit: {ngn.format(unit)}
                              </div>
                              {optionsText && (
                                <div className="mt-1 text-xs text-ink-soft">
                                  {optionsText}
                                </div>
                              )}
                            </div>
                            <div className="text-ink font-semibold whitespace-nowrap">
                              {ngn.format(lineTotal)}
                            </div>
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
                    <button
                      className="text-sm text-emerald-700 hover:underline"
                      onClick={() => setShowHomeForm(true)}
                    >
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
                            openModal({ title: 'Checkout', message: err?.response?.data?.error || 'Failed to set shipping as home' });
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
                      <div>{shipAddr.houseNumber} {shipAddr.streetName}</div>
                      <div>{shipAddr.town || ''} {shipAddr.city || ''} {shipAddr.postCode || ''}</div>
                      <div>{shipAddr.state}, {shipAddr.country}</div>
                    </div>
                    <button
                      className="text-sm text-amber-700 hover:underline"
                      onClick={() => setShowShipForm(true)}
                    >
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
                  <span className="text-ink-soft">Items</span>
                  <span className="font-medium">{cart.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Subtotal</span>
                  <span className="font-medium">{ngn.format(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Shipping</span>
                  <span className="font-medium">Calculated at payment</span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-ink">
                <span className="font-semibold">Total</span>
                <span className="text-xl font-semibold">{ngn.format(subtotal)}</span>
              </div>

              <button
                disabled={createOrder.isPending}
                onClick={() => createOrder.mutate()}
                className="mt-5 w-full inline-flex items-center justify-center rounded-lg bg-accent-500 text-white px-4 py-2.5 font-medium hover:bg-accent-600 active:bg-accent-700 focus:outline-none focus:ring-4 focus:ring-accent-200 transition disabled:opacity-50"
              >
                {createOrder.isPending ? 'Processing…' : 'Place order & Proceed to payment'}
              </button>

              {createOrder.isError && (
                <p className="mt-3 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                  {(() => {
                    const err = createOrder.error as unknown;
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
            </Card>

            <p className="mt-3 text-[11px] text-ink-soft text-center">
              You can update addresses here. Payment happens on the next step.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
