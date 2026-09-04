import { forwardRef } from "react";

export const ListSearch = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }
>(function ListSearch({ value, onChange, label }, ref) {
  return (
    <input
      ref={ref}
      className="log-search list-search"
      value={value}
      aria-label={label}
      placeholder="Filter…"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onChange("");
      }}
    />
  );
});
