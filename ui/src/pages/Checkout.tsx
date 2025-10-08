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
  // NOTE: backend returns { address, shippingAddress }
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

  // --- CART ---------------------------------------------------------------
  const raw = localStorage.getItem('cart');
  const cart: CartLine[] = raw ? JSON.parse(raw) : [];
  const total = useMemo(
    () => cart.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0),
    [cart]
  );

  // --- ADDRESSES ----------------------------------------------------------
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [homeAddr, setHomeAddr] = useState<Address>(EMPTY_ADDR);
  const [shipAddr, setShipAddr] = useState<Address>(EMPTY_ADDR);

  const [showHomeForm, setShowHomeForm] = useState(false);
  const [showShipForm, setShowShipForm] = useState(false);
  const [sameAsHome, setSameAsHome] = useState(true);

  // “Done” button spinners
  const [savingHome, setSavingHome] = useState(false);
  const [savingShip, setSavingShip] = useState(false);

  // Load existing addresses (if any)
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
        const h = res.data?.address || null;            // 👈 note: address (home)
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

  // When Same-as-home toggles ON, also copy into shipping and save it
  useEffect(() => {
    if (sameAsHome) {
      setShipAddr((prev) => ({ ...prev, ...homeAddr }));
    }
  }, [sameAsHome, homeAddr]);

  // --- FORM HELPERS -------------------------------------------------------
  const onChangeHome = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setHomeAddr((a) => ({ ...a, [k]: e.target.value }));

  const onChangeShip = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setShipAddr((a) => ({ ...a, [k]: e.target.value }));

  function validateAddress(a: Address, isShipping = false): string | null {
    const label = isShipping ? 'Shipping' : 'Home';
    if (!a.houseNumber.trim()) return `Enter ${label} address: house/plot number`;
    if (!a.streetName.trim())  return `Enter ${label} address: street name`;
    if (!a.city.trim())        return `Enter ${label} address: city`;
    if (!a.state.trim())       return `Enter ${label} address: state`;
    if (!a.country.trim())     return `Enter ${label} address: country`;
    return null;
  }

  // --- SAVE ADDRESSES IMMEDIATELY ----------------------------------------
  const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;

  const saveHome = async () => {
    const v = validateAddress(homeAddr, false);
    if (v) { alert(v); return; }
    try {
      setSavingHome(true);
      await api.post('/api/profile/address', homeAddr, { headers: authHeader }); // 👈 adjust if your route differs
      setShowHomeForm(false);

      // If “same as home”, also persist shipping as a copy
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
    if (v) { alert(v); return; }
    try {
      setSavingShip(true);
      await api.post('/api/profile/shipping', shipAddr, { headers: authHeader }); // 👈 adjust if your route differs
      setShowShipForm(false);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save shipping address');
    } finally {
      setSavingShip(false);
    }
  };

  // --- ORDER CREATION -----------------------------------------------------
  const createOrder = useMutation({
    mutationFn: async () => {
      const items = cart.map((it) => ({ productId: it.productId, qty: it.qty }));

      // Make sure addresses are valid (and saved)
      const vaHome = validateAddress(homeAddr);
      if (vaHome) throw new Error(vaHome);

      const finalShip = sameAsHome ? homeAddr : shipAddr;
      if (!sameAsHome) {
        const vaShip = validateAddress(finalShip, true);
        if (vaShip) throw new Error(vaShip);
      }

      // Create order — backend will link saved addresses (or upsert as needed)
      const payload = {
        items,
        shipping: 0,
        tax: 0,
        homeAddress: homeAddr,
        shippingAddress: sameAsHome ? homeAddr : shipAddr,
      };

      const res = await api.post('/api/orders', payload, {
        headers: authHeader,
      });

      return res.data as { id: string };
    },
    onSuccess: (order) => {
      // Pass data to the payment page via router state
      nav(`/payment?orderId=${order.id}`, {
        state: {
          orderId: order.id,
          total,
          homeAddress: homeAddr,
          shippingAddress: sameAsHome ? homeAddr : shipAddr,
        },
        replace: true,
      });
    },
  });

  // --- RENDER -------------------------------------------------------------
  if (cart.length === 0) {
    return <p className="max-w-xl mx-auto p-6">Your cart is empty.</p>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>

      {/* CART SUMMARY */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Order summary</h2>
        <ul className="space-y-2">
          {cart.map((it) => (
            <li
              key={it.productId}
              className="flex justify-between border p-2 rounded bg-white"
            >
              <span className="truncate pr-3">
                {it.title} × {it.qty}
              </span>
              <span className="font-medium">{ngn.format(Number(it.totalPrice) || 0)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between font-semibold text-lg bg-zinc-50 border rounded p-3">
          <span>Total</span>
          <span>{ngn.format(total)}</span>
        </div>
      </section>

      {/* ADDRESSES */}
      <section className="grid md:grid-cols-2 gap-6">
        {/* HOME ADDRESS CARD */}
        <div className="border rounded-lg bg-white">
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="font-medium">Home address</h3>
            {!showHomeForm && (
              <button
                className="text-sm underline"
                onClick={() => setShowHomeForm(true)}
              >
                Change
              </button>
            )}
          </div>

          {loadingProfile ? (
            <div className="p-3 text-sm opacity-70">Loading…</div>
          ) : profileErr ? (
            <div className="p-3 text-sm text-red-600">{profileErr}</div>
          ) : showHomeForm ? (
            <div className="p-4 grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="House No."
                  className="border rounded p-2"
                  value={homeAddr.houseNumber}
                  onChange={onChangeHome('houseNumber')}
                />
                <input
                  placeholder="Post code"
                  className="border rounded p-2"
                  value={homeAddr.postCode}
                  onChange={onChangeHome('postCode')}
                />
              </div>
              <input
                placeholder="Street name"
                className="border rounded p-2"
                value={homeAddr.streetName}
                onChange={onChangeHome('streetName')}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="Town"
                  className="border rounded p-2"
                  value={homeAddr.town}
                  onChange={onChangeHome('town')}
                />
                <input
                  placeholder="City"
                  className="border rounded p-2"
                  value={homeAddr.city}
                  onChange={onChangeHome('city')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="State"
                  className="border rounded p-2"
                  value={homeAddr.state}
                  onChange={onChangeHome('state')}
                />
                <input
                  placeholder="Country"
                  className="border rounded p-2"
                  value={homeAddr.country}
                  onChange={onChangeHome('country')}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={saveHome}
                  disabled={savingHome}
                >
                  {savingHome ? 'Saving…' : 'Done'}
                </button>
                <button
                  type="button"
                  className="text-sm underline opacity-70"
                  onClick={() => setHomeAddr(EMPTY_ADDR)}
                  disabled={savingHome}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm leading-6">
              <div>{homeAddr.houseNumber} {homeAddr.streetName}</div>
              <div>{homeAddr.town || ''} {homeAddr.city || ''} {homeAddr.postCode || ''}</div>
              <div>{homeAddr.state}, {homeAddr.country}</div>
            </div>
          )}
        </div>

        {/* SHIPPING ADDRESS CARD */}
        <div className="border rounded-lg bg-white">
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="font-medium">Shipping address</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameAsHome}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setSameAsHome(checked);
                  if (checked) {
                    // Immediately persist shipping = home (best UX)
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
              Same as home
            </label>
          </div>

          {sameAsHome ? (
            <div className="p-4 text-sm leading-6 opacity-80">
              Will use your Home address for shipping.
            </div>
          ) : loadingProfile ? (
            <div className="p-3 text-sm opacity-70">Loading…</div>
          ) : showShipForm ? (
            <div className="p-4 grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="House No."
                  className="border rounded p-2"
                  value={shipAddr.houseNumber}
                  onChange={onChangeShip('houseNumber')}
                />
                <input
                  placeholder="Post code"
                  className="border rounded p-2"
                  value={shipAddr.postCode}
                  onChange={onChangeShip('postCode')}
                />
              </div>
              <input
                placeholder="Street name"
                className="border rounded p-2"
                value={shipAddr.streetName}
                onChange={onChangeShip('streetName')}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="Town"
                  className="border rounded p-2"
                  value={shipAddr.town}
                  onChange={onChangeShip('town')}
                />
                <input
                  placeholder="City"
                  className="border rounded p-2"
                  value={shipAddr.city}
                  onChange={onChangeShip('city')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="State"
                  className="border rounded p-2"
                  value={shipAddr.state}
                  onChange={onChangeShip('state')}
                />
                <input
                  placeholder="Country"
                  className="border rounded p-2"
                  value={shipAddr.country}
                  onChange={onChangeShip('country')}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={saveShip}
                  disabled={savingShip}
                >
                  {savingShip ? 'Saving…' : 'Done'}
                </button>
                <button
                  type="button"
                  className="text-sm underline opacity-70"
                  onClick={() => setShipAddr(EMPTY_ADDR)}
                  disabled={savingShip}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm leading-6">
              <div className="flex items-center justify-between">
                <div>
                  <div>{shipAddr.houseNumber} {shipAddr.streetName}</div>
                  <div>{shipAddr.town || ''} {shipAddr.city || ''} {shipAddr.postCode || ''}</div>
                  <div>{shipAddr.state}, {shipAddr.country}</div>
                </div>
                <button
                  className="text-sm underline"
                  onClick={() => setShowShipForm(true)}
                >
                  Change
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ACTIONS */}
      <div className="pt-2">
        <button
          disabled={createOrder.isPending}
          onClick={() => createOrder.mutate()}
          className="rounded-md border bg-accent-500 px-5 py-2 text-white hover:bg-accent-600 transition disabled:opacity-50"
        >
          {createOrder.isPending ? 'Processing…' : 'Go to payment'}
        </button>
        {createOrder.isError && (
          <p className="text-red-600 mt-2">
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
      </div>
    </div>
  );
}
