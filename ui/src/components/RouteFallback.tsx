export default function RouteFallback({
  label = "Loading…",
  full = false,
}: {
  label?: string;
  full?: boolean;
}) {
  return (
    <div
      className={`${full ? "min-h-[60vh]" : "min-h-[40vh]"} flex items-center justify-center px-4`}
    >
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}
