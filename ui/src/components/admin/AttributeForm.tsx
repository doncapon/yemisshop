import { useCallback, useId, useState } from "react";

type AttrType = 'TEXT' | 'SELECT' | 'MULTISELECT';

export function AttributeForm({
  onCreate,
}: {
  onCreate: (payload: { name: string; type: AttrType; isActive: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AttrType>('SELECT');
  const [isActive, setIsActive] = useState(true);

  const uid = useId();
  const nameId = `${uid}-attr-name`;
  const typeId = `${uid}-attr-type`;
  const activeId = `${uid}-attr-active`;

  const submit = useCallback(() => {
    const n = name.trim();
    if (!n) return;
    onCreate({ name: n, type, isActive });
    setName('');
    setType('SELECT');
    setIsActive(true);
  }, [name, type, isActive, onCreate]);

  return (
    <form
      className="mb-3 grid grid-cols-2 gap-2"
      onSubmit={(e) => { e.preventDefault(); submit(); }}   // ← stop native submit/navigation
      onClick={(e) => e.stopPropagation()}                   // ← don’t bubble to any parent click handlers
      onMouseDown={(e) => e.stopPropagation()}
      autoComplete="off"
    >
      <label htmlFor={nameId} className="sr-only">Name</label>
      <input
        id={nameId}
        placeholder="Name"
        className="border rounded-lg px-3 py-2"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label htmlFor={typeId} className="sr-only">Type</label>
      <select
        id={typeId}
        className="border rounded-lg px-3 py-2"
        value={type}
        onChange={(e) => setType(e.target.value as AttrType)}
      >
        <option value="TEXT">TEXT</option>
        <option value="SELECT">SELECT</option>
        <option value="MULTISELECT">MULTISELECT</option>
      </select>

      <label htmlFor={activeId} className="flex items-center gap-2">
        <input
          id={activeId}
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        <span className="text-sm">Active</span>
      </label>

      {/* Put the button on its own row so it doesn’t wrap the inputs */}
      <div className="col-span-2 justify-self-end">
        <button
          type="submit"                                        // ← explicit submit
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
        >
          Add
        </button>
      </div>
    </form>
  );
}
