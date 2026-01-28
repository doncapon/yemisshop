import * as React from "react";

/**
 * A tiny "shadcn-like" Select implementation:
 * - <Select value onValueChange>
 * - <SelectTrigger className>
 * - <SelectValue placeholder />
 * - <SelectContent className>
 * - <SelectItem value disabled>Label</SelectItem>
 *
 * Notes:
 * - No portals; content is positioned under trigger.
 * - Keyboard: Escape closes; click outside closes.
 */

type SelectCtx = {
  value: string;
  setValue: (v: string) => void;

  open: boolean;
  setOpen: (b: boolean) => void;

  placeholder?: string;
  setPlaceholder: (s?: string) => void;

  // ✅ MUST be nullable (refs start null)
  triggerRef: React.RefObject<HTMLButtonElement | null>;

  labels: Map<string, string>;
  registerLabel: (value: string, label: string) => void;
};

const Ctx = React.createContext<SelectCtx | null>(null);

function useSelectCtx() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("Select components must be used within <Select>.");
  return ctx;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState<string>(defaultValue ?? "");
  const [open, setOpen] = React.useState(false);
  const [placeholder, setPlaceholder] = React.useState<string | undefined>(undefined);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  const labelsRef = React.useRef<Map<string, string>>(new Map());

  const registerLabel = React.useCallback((v: string, label: string) => {
    labelsRef.current.set(v, label);
  }, []);

  const setValue = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternal(next);
      onValueChange?.(next);
    },
    [value, onValueChange]
  );

  const currentValue = value ?? internal;

  // click outside to close
  React.useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;

      const trig = triggerRef.current;
      const cont = contentRef.current;

      if (trig?.contains(t)) return;
      if (cont?.contains(t)) return;

      setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ✅ this is the ctx you were missing
  const ctx: SelectCtx = {
    value: currentValue,
    setValue,
    open,
    setOpen,
    placeholder,
    setPlaceholder,
    triggerRef,
    labels: labelsRef.current,
    registerLabel,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function SelectTrigger({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { open, setOpen, triggerRef } = useSelectCtx();

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={[
        // default styles
        "w-full flex items-center justify-between gap-2",
        "border bg-white text-zinc-900",
        "px-4 py-2 rounded-xl",
        "focus:outline-none focus:ring-4 focus:ring-zinc-300/40",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
    >
      <span className="min-w-0 flex-1 text-left">{children}</span>
      <span className="text-zinc-500">▾</span>
    </button>
  );
}

export function SelectValue({
  placeholder,
}: {
  placeholder?: string;
}) {
  const { value, labels, setPlaceholder } = useSelectCtx();

  React.useEffect(() => {
    setPlaceholder(placeholder);
  }, [placeholder, setPlaceholder]);

  const label = value ? labels.get(value) : null;

  return (
    <span className={label ? "text-zinc-900" : "text-zinc-500"}>
      {label ?? placeholder ?? "Select…"}
    </span>
  );
}

export function SelectContent({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { open, triggerRef } = useSelectCtx();
  const [pos, setPos] = React.useState<{ left: number; top: number; width: number }>({
    left: 0,
    top: 0,
    width: 0,
  });

  React.useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    setPos({
      left: r.left + window.scrollX,
      top: r.bottom + window.scrollY + 6,
      width: r.width,
    });
  }, [open, triggerRef]);

  if (!open) return null;

  return (
    <div
      className={[
        "absolute z-[80] rounded-xl border bg-white shadow-lg",
        "max-h-72 overflow-auto",
        className,
      ].join(" ")}
      style={{ left: pos.left, top: pos.top, width: pos.width }}
      role="listbox"
    >
      <div className="p-1">{children}</div>
    </div>
  );
}

export function SelectItem({
  value,
  disabled,
  textValue,
  children,
}: {
  value: string;
  disabled?: boolean;
  textValue?: string;
  children: React.ReactNode;
}) {
  const { value: current, setValue, setOpen, registerLabel } = useSelectCtx();

  // register label for SelectValue display (prefer explicit textValue)
  React.useEffect(() => {
    const label =
      (typeof textValue === "string" && textValue.trim() ? textValue.trim() : null) ??
      (typeof children === "string" && children.trim() ? children.trim() : null);

    if (label) registerLabel(value, label);
  }, [children, registerLabel, textValue, value]);

  const active = current === value;

  return (
    <button
      type="button"
      disabled={!!disabled}
      onClick={() => {
        if (disabled) return;

        // ensure label exists (prefer textValue)
        const label =
          (typeof textValue === "string" && textValue.trim() ? textValue.trim() : null) ??
          (typeof children === "string" && children.trim() ? children.trim() : null) ??
          value;

        registerLabel(value, label);

        setValue(value);
        setOpen(false);
      }}
      className={[
        "w-full text-left px-3 py-2 rounded-lg",
        "hover:bg-zinc-50",
        active ? "bg-zinc-100" : "",
        disabled ? "opacity-40 cursor-not-allowed line-through hover:bg-white" : "",
      ].join(" ")}
      role="option"
      aria-selected={active}
    >
      {children}
    </button>
  );
}

