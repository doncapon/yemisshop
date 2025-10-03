import fetch from 'node-fetch';
type AuthT = 'BEARER'|'BASIC'|undefined;

function buildHeaders(authType: AuthT, apiKey?: string) {
  const h: Record<string,string> = { 'Content-Type':'application/json' };
  if (authType === 'BEARER' && apiKey) h.Authorization = `Bearer ${apiKey}`;
  if (authType === 'BASIC' && apiKey) h.Authorization = `Basic ${apiKey}`;
  return h;
}

export async function placeOnlineOrder(baseUrl: string, authType: AuthT, apiKey: string|undefined, payload: any) {
  const url = `${baseUrl.replace(/\/$/,'')}/orders`;
  const res = await fetch(url, { method: 'POST', headers: buildHeaders(authType, apiKey), body: JSON.stringify(payload) });
  const data: any = await res.json().catch(()=> ({} as any));
  return { ok: res.ok, data };
}

export async function payOnlineOrder(baseUrl: string, authType: AuthT, apiKey: string|undefined, orderRef: string, amount: number) {
  const url = `${baseUrl.replace(/\/$/,'')}/orders/${orderRef}/pay`;
  const res = await fetch(url, { method: 'POST', headers: buildHeaders(authType, apiKey), body: JSON.stringify({ amount }) });
  const data: any = await res.json().catch(()=> ({} as any));
  return { ok: res.ok, data };
}

export async function getReceipt(baseUrl: string, authType: AuthT, apiKey: string|undefined, orderRef: string) {
  const url = `${baseUrl.replace(/\/$/,'')}/orders/${orderRef}/receipt`;
  const res = await fetch(url, { method: 'GET', headers: buildHeaders(authType, apiKey) });
  if (!res.ok) return { ok: false, url: undefined };
  const data: any = await res.json().catch(()=> ({} as any));
  const urlField = data.url ?? data.link ?? undefined;
  return { ok: true, url: urlField as string | undefined };
}
