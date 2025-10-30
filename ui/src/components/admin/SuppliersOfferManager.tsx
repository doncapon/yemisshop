// src/components/SuppliersOfferManager.tsx
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client.js'; // your axios instance

type VariantLite = { id: string; sku?: string };
type SupplierLite = { id: string; name: string };

type Props = {
  productId: string;
  variants: VariantLite[];
  suppliers: SupplierLite[];
  token?: string | null;
  readOnly?: boolean;
};

type OfferRow = {
  id: string;
  supplierId: string;
  supplierName?: string;
  productId: string;
  variantId?: string | null;
  price: number;
  currency: string;
  availableQty: number;
  inStock: boolean;
  isActive: boolean;
  leadDays?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type OfferForm = {
  id?: string;                  // present => edit, absent => create
  supplierId: string;
  variantId?: string | '';
  price: string;
  currency: string;
  availableQty: string;
  isActive: boolean;
  leadDays?: string;
};

const emptyForm = (productId: string): OfferForm => ({
  supplierId: '',
  variantId: '',
  price: '',
  currency: 'NGN',
  availableQty: '',
  isActive: true,
  leadDays: '',
});

export default function SuppliersOfferManager({
  productId,
  variants,
  suppliers,
  token,
  readOnly,
}: Props) {
  const qc = useQueryClient();
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  const offersQ = useQuery<OfferRow[]>({
    queryKey: ['admin', 'products', productId, 'offers'],
    queryFn: async () => {
      // try a couple of endpoints to be resilient
      const attempts = [
        `/api/admin/products/${productId}/supplier-offers`,
        `/api/admin/products/${productId}/offers`,
      ];
      for (const u of attempts) {
        try {
          const { data } = await api.get(u, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
          if (Array.isArray(arr)) return arr as OfferRow[];
        } catch { }
      }
      return [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!productId,
  });

  // one editor form used for BOTH add & edit
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<OfferForm>(emptyForm(productId));

  function startAdd() {
    setForm(emptyForm(productId));
    setOpen(true);
  }
  function startEdit(row: OfferRow) {
    setForm({
      id: row.id,
      supplierId: row.supplierId,
      variantId: row.variantId || '',
      price: String(row.price ?? ''),
      currency: row.currency || 'NGN',
      availableQty: String(row.availableQty ?? ''),
      isActive: row.isActive !== false,
      leadDays: row.leadDays != null ? String(row.leadDays) : '',
    });
    setOpen(true);
  }
  function closeEditor() {
    setOpen(false);
  }
  function set<K extends keyof OfferForm>(k: K, v: OfferForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  const upsertM = useMutation({
    mutationFn: async (f: OfferForm) => {
      const payload = {
        productId,
        supplierId: f.supplierId,
        variantId: f.variantId || null,
        price: Number(f.price) || 0,
        currency: f.currency || 'NGN',
        availableQty: Math.max(0, Number(f.availableQty) || 0),
        isActive: !!f.isActive,
        leadDays: f.leadDays ? Number(f.leadDays) : null,
      };

      if (f.id) {
        // EDIT
        const { data } = await api.patch(`/api/admin/products/${payload.productId}/supplier-offers/${f.id}`, payload, { headers: hdr });
        return data?.data ?? data;
      }
      // ADD
      const { data } = await api.post(`/api/admin/products/${payload.productId}/supplier-offers`, payload, { headers: hdr });
      return data?.data ?? data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products', productId, 'offers'] });
      setOpen(false);
    },
  });

const deleteM = useMutation({
  mutationFn: async ({ productId, id }: { productId: string; id: string }) => {
    const { data } = await api.delete(
      `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers/${encodeURIComponent(id)}`,
      { headers: hdr }
    );
    return data?.data ?? data;
  },
  onSuccess: (_res, vars) => {
    // vars is the same object you passed to mutate
    qc.invalidateQueries({ queryKey: ['admin', 'products', vars.productId, 'offers'] });
  },
});


  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm text-zinc-600">
          {offersQ.isLoading ? 'Loading…' : `${offersQ.data?.length ?? 0} offer(s)`}
        </div>
        {!readOnly && (
          <button className="ml-auto px-3 py-2 rounded-lg bg-zinc-900 text-white" onClick={startAdd}>
            Add Offer
          </button>
        )}
      </div>

      {/* list */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Variant</th>
              <th className="text-left px-3 py-2">Price</th>
              <th className="text-left px-3 py-2">Avail.</th>
              <th className="text-left px-3 py-2">Stock</th>
              <th className="text-left px-3 py-2">Active</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {offersQ.isLoading && (
              <tr><td className="px-3 py-3" colSpan={7}>Loading…</td></tr>
            )}
            {!offersQ.isLoading && (offersQ.data ?? []).map(o => (
              <tr key={o.id}>
                <td className="px-3 py-2">{o.supplierName || suppliers.find(s => s.id === o.supplierId)?.name || o.supplierId}</td>
                <td className="px-3 py-2">{variants.find(v => v.id === o.variantId)?.sku || '—'}</td>
                <td className="px-3 py-2">{o.currency} {Number(o.price).toLocaleString()}</td>
                <td className="px-3 py-2">{o.availableQty}</td>
                <td className="px-3 py-2">{o.inStock ? 'In stock' : 'Out'}</td>
                <td className="px-3 py-2">{o.isActive ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2 text-right">
                  {!readOnly && (
                    <div className="inline-flex gap-2">
                      <button className="px-2 py-1 rounded border" onClick={() => startEdit(o)}>Edit</button>
                      <button
                        className="px-2 py-1 rounded bg-rose-600 text-white"
                        onClick={() => deleteM.mutate({productId: productId, id: o.id})}
                        disabled={deleteM.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!offersQ.isLoading && (offersQ.data ?? []).length === 0 && (
              <tr><td className="px-3 py-4 text-center text-zinc-500" colSpan={7}>No supplier offers</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* single editor for both Add & Edit */}
      {open && (
        <div className="rounded-2xl border bg-white p-4 md:p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="font-semibold">{form.id ? 'Edit Offer' : 'Add Offer'}</h4>
            <div className="ml-auto flex items-center gap-2">
              <button className="px-3 py-2 rounded-lg border" onClick={closeEditor}>Cancel</button>
              {!readOnly && (
                <button
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                  onClick={() => upsertM.mutate(form)}
                  disabled={
                    upsertM.isPending ||
                    !form.supplierId ||
                    !form.price ||
                    !form.availableQty
                  }
                  title={!form.supplierId ? 'Choose supplier' : (!form.price ? 'Enter price' : (!form.availableQty ? 'Enter available qty' : 'Save'))}
                >
                  {upsertM.isPending ? 'Saving…' : 'Save Offer'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Supplier */}
            <div>
              <label className="block text-xs text-zinc-600 mb-1">Supplier</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.supplierId}
                onChange={e => set('supplierId', e.target.value)}
              >
                <option value="">— Select —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {/* Variant */}
            <div>
              <label className="block text-xs text-zinc-600 mb-1">Variant (optional)</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.variantId || ''}
                onChange={e => set('variantId', e.target.value)}
              >
                <option value="">— None —</option>
                {variants.map(v => <option key={v.id} value={v.id}>{v.sku || v.id}</option>)}
              </select>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs text-zinc-600 mb-1">Price</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="decimal"
                value={form.price}
                onChange={e => set('price', e.target.value)}
                placeholder="0.00"
              />
            </div>

            {/* Currency */}
            <div>
              <label className="block text-xs text-zinc-600 mb-1">Currency</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={form.currency}
                onChange={e => set('currency', e.target.value.toUpperCase())}
                placeholder="NGN"
              />
            </div>

            {/* Available Qty */}
            <div>
              <label className="block text-xs text-zinc-600 mb-1">Available Qty</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="numeric"
                value={form.availableQty}
                onChange={e => set('availableQty', e.target.value)}
                placeholder="0"
              />
            </div>

            {/* Lead Days */}
            <div>
              <label className="block text-xs text-zinc-600 mb-1">Lead Days (optional)</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="numeric"
                value={form.leadDays || ''}
                onChange={e => set('leadDays', e.target.value)}
                placeholder="e.g. 3"
              />
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-4 col-span-1 md:col-span-3">
              <label className="inline-flex items-center gap-2">
                <span className="text-sm">In Stock</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={e => set('isActive', e.target.checked)}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
