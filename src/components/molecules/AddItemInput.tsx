import { useState } from "react";

/**
 * A text input paired with an "Add" button for appending items to a list.
 *
 * Supports Enter key submission. The input is cleared after a successful add.
 *
 * @param placeholder - Input placeholder text.
 * @param onAdd       - Called with the trimmed value when the user submits.
 * @param disabled    - Disables both input and button when `true`.
 * @param transform   - Optional transform applied before calling `onAdd` (e.g. strip `r/` prefix).
 *
 * @example
 * ```tsx
 * <AddItemInput
 *   placeholder="Add subreddit..."
 *   onAdd={(v) => addSubreddit(v)}
 *   transform={(v) => v.replace(/^r\//, "")}
 * />
 * ```
 */
export interface AddItemInputProps {
  placeholder?: string;
  onAdd: (value: string) => void;
  disabled?: boolean;
  transform?: (value: string) => string;
}

export function AddItemInput({
  placeholder = "Add item...",
  onAdd,
  disabled = false,
  transform,
}: AddItemInputProps) {
  const [value, setValue] = useState("");

  const handleAdd = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const final = transform ? transform(trimmed) : trimmed;
    onAdd(final);
    setValue("");
  };

  return (
    <div className="flex flex-1 gap-2">
      <input
        type="text"
        className="input flex-1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
        }}
      />
      <button
        type="button"
        className="btn"
        onClick={handleAdd}
        disabled={disabled || !value.trim()}
      >
        Add
      </button>
    </div>
  );
}
