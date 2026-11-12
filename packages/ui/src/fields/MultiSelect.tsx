"use client";
import Autocomplete from "@mui/material/Autocomplete";
import Checkbox from "@mui/material/Checkbox";
import TextField from "@mui/material/TextField";
import { useMessages } from "../messages";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  label: string;
  options: readonly SelectOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Selection maximum, enforced at tick time. */
  max?: number;
  loading?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  width?: number | string;
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  max,
  loading,
  disabled,
  error,
  helperText,
  width = 280,
}: MultiSelectProps) {
  const t = useMessages();
  const selected = options.filter((o) => value.includes(o.value));
  return (
    <Autocomplete<SelectOption, true, false, false>
      multiple
      size="small"
      disableCloseOnSelect
      limitTags={2}
      sx={{ width }}
      options={[...options]}
      value={selected}
      loading={loading}
      disabled={disabled}
      noOptionsText={t("common.noOptions")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      getOptionDisabled={(o) =>
        Boolean(o.disabled) ||
        (max !== undefined && value.length >= max && !value.includes(o.value))
      }
      onChange={(_, next) => onChange(next.map((o) => o.value))}
      renderOption={(props, option, { selected: isSelected }) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest}>
            <Checkbox size="small" checked={isSelected} sx={{ mr: 1 }} tabIndex={-1} />
            {option.label}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={label} error={error ?? false} helperText={helperText} />
      )}
    />
  );
}
