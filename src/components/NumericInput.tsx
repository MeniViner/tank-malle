import { forwardRef, useRef, type InputHTMLAttributes } from "react";
import { isNumericInputEdit } from "../lib/numeric";

/** The keyboard hint alone does not restrict typing or paste on mobile. */
export const NumericInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function NumericInput({
  value, defaultValue, onChange, inputMode = "decimal", ...props
}, ref) {
  const accepted = useRef(String(defaultValue ?? ""));
  return <input {...props} ref={ref} value={value} defaultValue={defaultValue} inputMode={inputMode}
    onChange={event => {
      const next = event.currentTarget.value;
      if (!isNumericInputEdit(next)) {
        event.currentTarget.value = String(value ?? accepted.current);
        return;
      }
      accepted.current = next;
      onChange?.(event);
    }} />;
});
