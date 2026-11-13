"use client";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { currencyDecimals, currencySymbol, sanitizeNumeric, type NumericKind } from "./sanitize";

interface BaseProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  /** Upper bound, enforced while typing. */
  max?: number;
  fullWidth?: boolean;
  autoFocus?: boolean;
}

function NumericField({
  kind,
  start,
  end,
  decimals,
  onChange,
  value,
  max,
  error,
  ...rest
}: BaseProps & { kind: NumericKind; start?: string; end?: string; decimals?: number }) {
  return (
    <TextField
      {...rest}
      value={value}
      size="small"
      // Never type="number": no spinner, no e/E/+/-.
      type="text"
      {...(error !== undefined ? { error } : {})}
      slotProps={{
        htmlInput: {
          inputMode: kind === "integer" || kind === "percent" ? "numeric" : "decimal",
          autoComplete: "off",
          spellCheck: false,
        },
        input: {
          ...(start
            ? { startAdornment: <InputAdornment position="start">{start}</InputAdornment> }
            : {}),
          ...(end ? { endAdornment: <InputAdornment position="end">{end}</InputAdornment> } : {}),
        },
      }}
      onChange={(e) =>
        onChange(
          sanitizeNumeric(
            kind,
            e.target.value,
            {
              ...(decimals !== undefined ? { decimals } : {}),
              ...(max !== undefined ? { max } : {}),
            },
            value,
          ),
        )
      }
    />
  );
}

export interface MoneyFieldProps extends BaseProps {
  /** ISO 4217 code of the marketplace; the symbol and exponent come from it. */
  currency: string;
  locale?: string;
}

/** Money: digits and one dot, exponent of the currency, symbol from the marketplace currency. */
export function MoneyField({ currency, locale, ...props }: MoneyFieldProps) {
  return (
    <NumericField
      kind="money"
      start={currencySymbol(currency, locale)}
      decimals={currencyDecimals(currency, locale)}
      {...props}
    />
  );
}

/** Whole numbers: digits only. */
export function IntegerField(props: BaseProps) {
  return <NumericField kind="integer" {...props} />;
}

export interface PercentFieldProps extends BaseProps {
  /** A fractional filter threshold may take one dot; budget/bid percentages may not. */
  allowDecimal?: boolean;
}

/** Percentage: digits only by default, `%` suffix. */
export function PercentField({ allowDecimal, ...props }: PercentFieldProps) {
  return <NumericField kind={allowDecimal ? "decimal" : "percent"} end="%" {...props} />;
}
