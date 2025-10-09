// src/pages/Checkout.tsx
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type CartLine = {
  productId: string;
  title: string;
  price: number;
  qty: number;
  totalPrice: number;
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
  // backend returns { address, shippingAddress }
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

export default function Checkout() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);

  // Require login for checkout
  useEffect(() => {
    if (!token) nav('/login', { state: { from: { pathname: '/checkout' } } });
  }, [token, nav]);

  // CART
  const raw = localStorage.getItem('cart');
  const cart: CartLine[] = raw ? JSON.parse(raw) : [];
  const subtotal = useMemo(
    () => cart.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0),
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
    return () => {
      mounted = false;
    };
  }, [token]);

  // Keep shipping in sync when "same as home" toggles on
  useEffect(() => {
    if (sameAsHome) {
      setShipAddr((prev) => ({ ...prev, ...homeAddr }));
    }
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

  // Save addresses immediately
  const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;

  const saveHome = async () => {
    const v = validateAddress(homeAddr, false);
    if (v) {
      alert(v);
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
      alert(e?.response?.data?.error || 'Failed to save home address');
    } finally {
      setSavingHome(false);
    }
  };

  const saveShip = async () => {
    const v = validateAddress(shipAddr, true);
    if (v) {
      alert(v);
      return;
    }
    try {
      setSavingShip(true);
      await api.post('/api/profile/shipping', shipAddr, { headers: authHeader });
      setShowShipForm(false);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save shipping address');
    } finally {
      setSavingShip(false);
    }
  };

  // Create order → go to payment
  const createOrder = useMutation({
    mutationFn: async () => {
      const items = cart.map((it) => ({ productId: it.productId, qty: it.qty }));

      const vaHome = validateAddress(homeAddr);
      if (vaHome) throw new Error(vaHome);

      const finalShip = sameAsHome ? homeAddr : shipAddr;
      if (!sameAsHome) {
        const vaShip = validateAddress(finalShip, true);
        if (vaShip) throw new Error(vaShip);
      }

      const payload = {
        items,
        shipping: 0,
        tax: 0,
        homeAddress: homeAddr,
        shippingAddress: sameAsHome ? homeAddr : shipAddr,
      };

      const res = await api.post('/api/orders', payload, { headers: authHeader });
      return res.data as { id: string };
    },
    onSuccess: (order) => {
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
            <span className="text-ink-soft">Cart</span>
            <span className="opacity-40">›</span>
            <span className="text-ink font-medium">Address</span>
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
          {/* LEFT: Address cards */}
          <section className="space-y-6">
            {/* Home Address */}
            <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h3 className="font-semibold text-ink">Home address</h3>
                  <p className="text-xs text-ink-soft">We’ll keep this on your profile.</p>
                </div>
                {!showHomeForm && (
                  <button
                    className="text-sm text-primary-700 hover:underline"
                    onClick={() => setShowHomeForm(true)}
                  >
                    Change
                  </button>
                )}
              </div>

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
                      className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-white font-medium hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
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
            </div>

            {/* Shipping Address */}
            <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h3 className="font-semibold text-ink">Shipping address</h3>
                  <p className="text-xs text-ink-soft">Where we’ll deliver your items.</p>
                </div>
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
                          alert(err?.response?.data?.error || 'Failed to set shipping as home');
                        } finally {
                          setSavingShip(false);
                        }
                      }
                    }}
                  />
                  <span className="text-ink-soft">Same as home</span>
                </label>
              </div>

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
                      className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-white font-medium hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
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
                      className="text-sm text-primary-700 hover:underline"
                      onClick={() => setShowShipForm(true)}
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Order items (compact list) */}
            <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-ink">Items</h3>
              </div>
              <ul className="divide-y">
                {cart.map((it) => (
                  <li key={it.productId} className="p-4 flex items-center justify-between">
                    <div className="min-w-0 pr-3">
                      <div className="font-medium text-ink truncate">{it.title}</div>
                      <div className="text-xs text-ink-soft">Qty: {it.qty}</div>
                    </div>
                    <div className="text-ink font-semibold">{ngn.format(Number(it.totalPrice) || 0)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* RIGHT: Summary / Action */}
          <aside className="lg:sticky lg:top-6 h-max">
            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
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
                {createOrder.isPending ? 'Processing…' : 'Go to payment'}
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
            </div>

            <p className="mt-3 text-[11px] text-ink-soft text-center">
              You can update addresses here. Payment happens on the next step.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ---------- small presentational bits ---------- */

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
