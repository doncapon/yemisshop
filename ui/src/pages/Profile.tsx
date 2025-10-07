import { useEffect, useState } from 'react';
import api from '../api/client';

type MeResponse = {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPPLIER' | 'SHOPPER';
  status: 'PENDING' | 'PARTIAL' | 'VERIFIED';
  name?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  address?: string | null;
  // If you have separate shipping address table/fields, adapt accordingly
  shippingAddress?: string | null;
  bank?: {
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
  } | null;
};

export default function Profile() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // editable local form (adjust to your backend model)
  const [form, setForm] = useState({
    phone: '',
    dateOfBirth: '',
    address: '',
    shippingAddress: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<MeResponse>('/api/auth/me');
        setMe(data);
        setForm({
          phone: data.phone || '',
          dateOfBirth: data.dateOfBirth ? data.dateOfBirth.substring(0, 10) : '',
          address: data.address || '',
          shippingAddress: data.shippingAddress || '',
          bankName: data.bank?.bankName || '',
          accountName: data.bank?.accountName || '',
          accountNumber: data.bank?.accountNumber || '',
        });
      } catch (e: any) {
        setErr(e?.response?.data?.error || 'Failed to load profile');
      }
    })();
  }, []);

  const onChange =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setErr(null);
    setMsg(null);
    setSaving(true);
    try {
      await api.put('/api/profile', {
        phone: form.phone || null,
        dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
        address: form.address || null,
        shippingAddress: form.shippingAddress || null,
        bank: {
          bankName: form.bankName || null,
          accountName: form.accountName || null,
          accountNumber: form.accountNumber || null,
        },
      });
      setMsg('Profile updated');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const resendEmail = async () => {
    setErr(null); setMsg(null);
    try {
      await api.post('/api/auth/resend-email', {});
      setMsg('Verification email sent.');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to resend email');
    }
  };

  const resendOtp = async () => {
    setErr(null); setMsg(null);
    try {
      await api.post('/api/auth/resend-otp', {});
      setMsg('OTP sent to your phone.');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to resend OTP');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My Account</h1>
          <p className="text-sm opacity-70">Manage your details and verification.</p>
        </div>
      </header>

      {msg && <div className="p-2 rounded bg-green-50 text-green-700">{msg}</div>}
      {err && <div className="p-2 rounded bg-red-50 text-red-700">{err}</div>}

      {/* Verification status */}
      {me && (
        <section className="grid md:grid-cols-3 gap-4">
          <div className="border rounded p-4">
            <div className="text-xs opacity-70">Email</div>
            <div className="font-medium break-all">{me.email}</div>
            <div className={`mt-2 text-sm ${me.emailVerified ? 'text-green-700' : 'text-amber-700'}`}>
              {me.emailVerified ? 'Verified' : 'Not verified'}
            </div>
            {!me.emailVerified && (
              <button className="mt-2 text-sm underline" onClick={resendEmail}>Resend verification email</button>
            )}
          </div>

          <div className="border rounded p-4">
            <div className="text-xs opacity-70">Phone</div>
            <div className="font-medium">{form.phone || '—'}</div>
            <div className={`mt-2 text-sm ${me.phoneVerified ? 'text-green-700' : 'text-amber-700'}`}>
              {me.phoneVerified ? 'Verified' : 'Not verified'}
            </div>
            {!me.phoneVerified && (
              <button className="mt-2 text-sm underline" onClick={resendOtp}>Resend OTP</button>
            )}
          </div>

          <div className="border rounded p-4">
            <div className="text-xs opacity-70">Account Status</div>
            <div className="font-medium">{me.status}</div>
          </div>
        </section>
      )}

      {/* Editable info */}
      <section className="grid md:grid-cols-2 gap-6">
        <div className="border rounded p-4 space-y-3">
          <h2 className="font-semibold">Contact & Personal</h2>
          <label className="text-sm block">Phone</label>
          <input className="border p-2 w-full rounded" value={form.phone} onChange={onChange('phone')} placeholder="+234..." />
          <label className="text-sm block mt-2">Date of birth</label>
          <input type="date" className="border p-2 w-full rounded" value={form.dateOfBirth} onChange={onChange('dateOfBirth')} />
        </div>

        <div className="border rounded p-4 space-y-3">
          <h2 className="font-semibold">Addresses</h2>
          <label className="text-sm block">Default address</label>
          <textarea className="border p-2 w-full rounded" rows={3} value={form.address} onChange={onChange('address')} />
          <label className="text-sm block mt-2">Shipping address</label>
          <textarea className="border p-2 w-full rounded" rows={3} value={form.shippingAddress} onChange={onChange('shippingAddress')} />
        </div>

        <div className="md:col-span-2 border rounded p-4 space-y-3">
          <h2 className="font-semibold">Bank details (Nigeria)</h2>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm block">Bank name</label>
              <input className="border p-2 w-full rounded" value={form.bankName} onChange={onChange('bankName')} placeholder="GTBank" />
            </div>
            <div>
              <label className="text-sm block">Account name</label>
              <input className="border p-2 w-full rounded" value={form.accountName} onChange={onChange('accountName')} placeholder="John Doe" />
            </div>
            <div>
              <label className="text-sm block">Account number</label>
              <input className="border p-2 w-full rounded" value={form.accountNumber} onChange={onChange('accountNumber')} placeholder="0123456789" />
            </div>
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <button onClick={save} disabled={saving} className="border px-4 py-2 rounded disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
