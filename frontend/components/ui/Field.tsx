import React, { useId } from "react";

interface FieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  disabled?: boolean;
}

export default function Field({
  label,
  value,
  onChange,
  hint,
  required = false,
  type = "text",
  placeholder,
  disabled = false,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-required={required}
        aria-describedby={hintId}
        className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 dark:disabled:bg-gray-900 disabled:text-gray-500 dark:disabled:text-gray-400"
      />
      {hint && <p id={hintId} className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
