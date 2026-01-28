// src/lib/idleLogout.ts
type IdleLogoutOptions = {
  idleMs: number;
  onIdle: () => void;
  events?: string[];
};

export function setupIdleLogout(opts: IdleLogoutOptions) {
  const events = opts.events ?? [
    "mousemove",
    "mousedown",
    "keydown",
    "touchstart",
    "scroll",
    "pointerdown",
  ];

  let t: number | undefined;

  const reset = () => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => {
      opts.onIdle();
    }, opts.idleMs);
  };

  const onEvent = () => reset();

  // start
  reset();
  events.forEach((ev) => window.addEventListener(ev, onEvent, { passive: true }));

  // return cleanup
  return () => {
    if (t) window.clearTimeout(t);
    events.forEach((ev) => window.removeEventListener(ev, onEvent as any));
  };
}
