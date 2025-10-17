// api/src/lib/csv.ts
type Row = Record<string, string | number | boolean | null | undefined>;

export function toCsv(headers: string[], rows: Row[]) {
  const esc = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = headers.join(',');
  const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}