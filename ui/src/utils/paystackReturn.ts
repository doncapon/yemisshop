export function markPaystackExit() {
  try {
    sessionStorage.setItem('paystack.back.ts', String(Date.now()));
  } catch {}
}