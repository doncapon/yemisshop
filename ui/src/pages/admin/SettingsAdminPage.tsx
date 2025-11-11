// web/src/pages/admin/SettingsAdminPage.tsx
import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import SiteLayout from '../../layouts/SiteLayout.js';

type Setting = {
  id: string;
  key: string;
  value: string;
  isPublic?: boolean | null;
  meta?: any | null; // we'll store { options: string[] } here when using Select
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ValueType = 'text' | 'select';

// Known keys with preset options (auto-applied on key match)
const KNOWN_KEY_OPTIONS: Record<string, string[]> = {
  taxMode: ['INCLUDED', 'ADDED', 'NONE'],
  // add more if you like, e.g.:
  // orderStatus: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
};

export default function SettingsAdminPage() {
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState('');

  const [creating, setCreating] = useState<{
    key: string;
    value: string;
    isPublic: boolean;
    meta: string;           // free-form JSON editor (optional)
    valueType: ValueType;   // text | select
    optionsText: string;    // comma-separated options if valueType=select
  }>({
    key: '',
    value: '',
    isPublic: false,
    meta: '',
    valueType: 'text',
    optionsText: '',
  });

  // When key matches a known key, gently enhance with presets without fighting user choice.
  useEffect(() => {
    const key = creating.key.trim();
    const presets = KNOWN_KEY_OPTIONS[key];

    if (Array.isArray(presets) && presets.length) {
      setCreating((s) => {
        const optionsText = presets.join(',');
        const currentIsValid = presets.includes(s.value);
        return {
          ...s,
          // If user is still on "text", upgrade to "select". Otherwise respect their choice.
          valueType: s.valueType === 'text' ? 'select' : s.valueType,
          optionsText,
          value: currentIsValid ? s.value : presets[0],
        };
      });
    }
    // If no presets, do nothing (don’t override radio selection or fields)
  }, [creating.key]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get<Setting[]>('/api/settings');
        setRows(res.data);
        setErr(null);
      } catch (e: any) {
        setErr(e?.response?.data?.error || e?.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(s) ||
        (r.value || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  const optionsArray = useMemo(() => {
    if (creating.valueType !== 'select') return [];
    return (creating.optionsText || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }, [creating.valueType, creating.optionsText]);

  function safeParseJSON(s: string) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!creating.key) return;

    try {
      // Build meta: if select, include options in meta.options
      let meta: any = creating.meta ? safeParseJSON(creating.meta) : null;
      if (creating.valueType === 'select') {
        const opts = optionsArray;
        if (opts.length) {
          meta = { ...(meta && typeof meta === 'object' ? meta : {}), options: opts };
          // ensure current value is one of the options
          if (!opts.includes(creating.value)) {
            throw new Error('Selected value must be one of the provided options.');
          }
        }
      }

      const res = await api.post<Setting>('/api/settings', {
        key: creating.key.trim(),
        value: creating.value,
        isPublic: creating.isPublic,
        meta,
      });

      setRows((prev) => [res.data, ...prev]);
      setCreating({
        key: '',
        value: '',
        isPublic: false,
        meta: '',
        valueType: 'text',
        optionsText: '',
      });
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Create failed');
    }
  }

  async function update(
    id: string,
    patch: Partial<Pick<Setting, 'value' | 'isPublic' | 'meta'>>
  ) {
    try {
      const res = await api.patch<Setting>(`/api/settings/${id}`, patch);
      setRows((prev) => prev.map((r) => (r.id === id ? res.data : r)));
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Update failed');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete setting?')) return;
    try {
      await api.delete<void>(`/api/settings/${id}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Delete failed');
    }
  }

  return (
    <SiteLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Settings</h1>

        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="border rounded px-3 py-2"
            placeholder="Search key/value…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-4">
            {err}
          </div>
        )}

        {/* Create new */}
        <form onSubmit={create} className="border rounded p-4 mb-6 space-y-3">
          <div className="font-medium">Create setting</div>

          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="border rounded px-3 py-2"
              placeholder="key (e.g. taxMode)"
              value={creating.key}
              onChange={(e) => setCreating((s) => ({ ...s, key: e.target.value }))}
              required
            />

            {/* Value type toggle */}
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="valueType"
                  checked={creating.valueType === 'text'}
                  onChange={() =>
                    setCreating((s) => ({ ...s, valueType: 'text' }))
                  }
                />
                Text
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="valueType"
                  checked={creating.valueType === 'select'}
                  onChange={() =>
                    setCreating((s) => {
                      const key = s.key.trim();
                      const presets = KNOWN_KEY_OPTIONS[key];
                      const optionsText =
                        presets?.length ? presets.join(',') : s.optionsText || '';
                      const first = presets?.[0] || s.value || '';
                      return {
                        ...s,
                        valueType: 'select',
                        optionsText,
                        value: s.value || first,
                      };
                    })
                  }
                />
                Select
              </label>
            </div>
          </div>

          {/* Value input: text or select */}
          {creating.valueType === 'text' ? (
            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="border rounded px-3 py-2"
                placeholder="value (string)"
                value={creating.value}
                onChange={(e) =>
                  setCreating((s) => ({ ...s, value: e.target.value }))
                }
                required
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={creating.isPublic}
                  onChange={(e) =>
                    setCreating((s) => ({ ...s, isPublic: e.target.checked }))
                  }
                />
                Public (readable without admin)
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  className="border rounded px-3 py-2"
                  placeholder="Options (comma-separated), e.g. INCLUDED,ADDED,NONE"
                  value={creating.optionsText}
                  onChange={(e) =>
                    setCreating((s) => ({
                      ...s,
                      optionsText: e.target.value,
                    }))
                  }
                />

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={creating.isPublic}
                    onChange={(e) =>
                      setCreating((s) => ({ ...s, isPublic: e.target.checked }))
                    }
                  />
                  Public (readable without admin)
                </label>
              </div>

              <div className="grid md:grid-cols-2 gap-3 items-center">
                <div className="text-sm text-gray-600">
                  Preview/select a value:
                </div>
                <select
                  className="border rounded px-3 py-2"
                  value={creating.value}
                  onChange={(e) =>
                    setCreating((s) => ({ ...s, value: e.target.value }))
                  }
                  required
                >
                  <option value="" disabled>
                    {optionsArray.length ? 'Select…' : 'Add options above…'}
                  </option>
                  {optionsArray.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Optional meta JSON */}
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder='meta (JSON, e.g. {"help":"shown in UI"})'
            value={creating.meta}
            onChange={(e) =>
              setCreating((s) => ({ ...s, meta: e.target.value }))
            }
          />

          <div>
            <button
              type="submit"
              className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
              disabled={
                !creating.key ||
                !creating.value ||
                (creating.valueType === 'select' && optionsArray.length === 0)
              }
            >
              + Create
            </button>
          </div>
        </form>

        {/* List */}
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 w-[28%]">Key</th>
                <th className="text-left p-3 w-[36%]">Value</th>
                <th className="text-left p-3 w-[16%]">Public</th>
                <th className="text-left p-3 w-[12%]">Updated</th>
                <th className="text-right p-3 w-[8%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-4">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4">
                    No settings found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-mono text-xs md:text-sm break-all">
                      {r.key}
                    </td>
                    <td className="p-3">
                      <InlineText value={r.value} onSave={(v) => update(r.id, { value: v })} />
                    </td>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={!!r.isPublic}
                        onChange={(e) => update(r.id, { isPublic: e.target.checked })}
                      />
                    </td>
                    <td className="p-3 text-gray-500">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        className="text-red-600 hover:underline"
                        onClick={() => remove(r.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SiteLayout>
  );
}

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(value), [value]);

  return (
    <div className="flex gap-2 items-center">
      <input
        className="border rounded px-2 py-1 w-full"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="px-2 py-1 border rounded text-xs"
        disabled={busy || v === value}
        onClick={async () => {
          try {
            setBusy(true);
            await onSave(v);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </button>
    </div>
  );
}
