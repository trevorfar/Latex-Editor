import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-60",
  secondary: "bg-bg text-fg border border-line-strong hover:bg-muted disabled:opacity-50",
  ghost: "text-fg-muted hover:text-fg hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent",
  subtle: "bg-muted text-fg hover:bg-hover disabled:opacity-50",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-60",
};

const SIZES: Record<Size, string> = {
  xs: "h-7 text-xs px-2 gap-1",
  sm: "h-8 text-[13px] px-2.5 gap-1.5",
  md: "h-9 text-sm px-3.5 gap-2",
};

const ICON_SIZES: Record<Size, string> = {
  xs: "h-7 w-7",
  sm: "h-8 w-8",
  md: "h-9 w-9",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", icon = false, className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors select-none ${VARIANTS[variant]} ${
        icon ? ICON_SIZES[size] : SIZES[size]
      } ${className}`}
      {...rest}
    />
  );
});
