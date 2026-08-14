"use client";

import { useEffect } from "react";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

/* ------------------------------ الأيقونات ------------------------------ */
const PATHS: Record<string, string[]> = {
  home: ["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
  pos: [
    "M9 6h6l2.5 6L15 19H9L6.5 12z",
    "M6.5 12h11",
    "M9 19v2a2 2 0 0 1-4 0v-1",
    "M15 19v2a2 2 0 0 0 4 0v-1",
    "M12 9v2M10.5 11h3",
  ],
  sales: ["M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1z", "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8", "M12 17.5v-11"],
  purchase: ["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  cash: ["M21 12V7H5a2 2 0 0 1 0-4h14v4", "M3 5v14a2 2 0 0 0 2 2h16v-5", "M18 12a2 2 0 0 0 0 4h4v-4z"],
  expense: ["M2 6h20v12H2z", "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M6 12h.01", "M18 12h.01"],
  customers: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  suppliers: ["M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z", "M17 18h1", "M12 18h1", "M7 18h1"],
  products: ["M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.3 7l8.7 5 8.7-5", "M12 22V12"],
  reports: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
  timeline: ["M3 3v5h5", "M3.05 13A9 9 0 1 0 6 5.3L3 8", "M12 7v5l4 2"],
  assistant: ["M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7 1 1 0 0 1-1 1h-2v1a2 2 0 0 1-2 2h-1v1h2a1 1 0 0 1 1 1v2h-8v-2a1 1 0 0 1 1-1h2v-1H9a2 2 0 0 1-2-2v-1H5a1 1 0 0 1-1-1 7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z", "M9 11h6M9 14h4"],
  employees: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  bell: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  x: ["M18 6L6 18", "M6 6l12 12"],
  check: ["M20 6L9 17l-5-5"],
  print: ["M6 9V2h12v7", "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2", "M6 14h12v8H6z"],
  alert: ["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  chevron: ["M6 9l6 6 6-6"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
  edit: ["M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7", "M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"],
  weight: ["M12 3v18", "M5 7h14", "M7 7l-2 7a5 5 0 0 0 14 0l-2-7", "M7 21h10"],
  cart: ["M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"],
  wallet2: ["M2 6h20v14H2z", "M2 10h20", "M6 15h4"],
  arrow: ["M19 12H5", "M12 19l-7-7 7-7"],
  coins: ["M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M18.09 10.37A6 6 0 1 1 10.34 18", "M7 8h1v4", "M16.71 13.88l.7.71-2.82 2.82"],
  refresh: ["M21 2v6h-6", "M21 8a9 9 0 1 0 2 5"],
  wifi: ["M5 12.55a11 11 0 0 1 14.08 0", "M8.53 16.11a6 6 0 0 1 6.95 0", "M12 20h.01", "M1.42 9a16 16 0 0 1 21.16 0"],
  wifi_off: ["M1 1l22 22", "M16.72 11.06A10.94 10.94 0 0 1 19 12.55", "M5 12.55a10.94 10.94 0 0 1 5.17-2.39", "M10.71 5.05A16 16 0 0 1 22.58 9", "M1.42 9a15.91 15.91 0 0 1 4.7-2.88", "M8.53 16.11a6 6 0 0 1 6.95 0", "M12 20h.01"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
};

export function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 2,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const paths = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/* ------------------------------ المكونات ------------------------------ */
const BTN_VARIANTS: Record<string, string> = {
  primary:
    "bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm disabled:bg-emerald-700/50",
  dark: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-900/50",
  outline:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:opacity-50",
  danger:
    "bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-600/50",
  warn: "bg-amber-500 text-white hover:bg-amber-600 shadow-sm disabled:opacity-50",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50",
};

export function Btn({
  variant = "primary",
  size = "md",
  className = "",
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN_VARIANTS;
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
}) {
  const sizes = {
    sm: "px-2.5 py-1.5 text-xs rounded-lg gap-1",
    md: "px-4 py-2 text-sm rounded-xl gap-1.5",
    lg: "px-5 py-2.5 text-base rounded-xl gap-2",
    xl: "px-6 py-3.5 text-lg rounded-2xl gap-2",
  };
  return (
    <button
      className={`inline-flex items-center justify-center font-bold transition-colors disabled:cursor-not-allowed ${BTN_VARIANTS[variant]} ${sizes[size]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner size={size === "sm" ? 12 : 16} />}
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-emerald-700 shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h3 className="font-extrabold text-slate-900 truncate">{title}</h3>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={pad ? "p-5" : "p-0"}>{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn" | "money";
  icon?: ReactNode;
  href?: string;
}) {
  const tones: Record<string, string> = {
    default: "text-slate-900",
    good: "text-emerald-700",
    bad: "text-red-600",
    warn: "text-amber-600",
    money: "text-emerald-700",
  };
  const inner = (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${href ? "transition hover:border-emerald-300 hover:shadow" : ""}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500">{label}</p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className={`mt-1.5 text-xl font-black ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}

export function Badge({
  tone = "gray",
  children,
  className = "",
}: {
  tone?: "gray" | "green" | "red" | "amber" | "blue";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    gray: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-sky-100 text-sky-800",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputCls} ${className}`} {...rest} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${inputCls} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...rest }: InputHTMLAttributes<HTMLTextAreaElement> & { children?: ReactNode }) {
  return <textarea className={`${inputCls} min-h-[70px] ${className}`} {...rest} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = "products", title, desc }: { icon?: string; title: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="rounded-2xl bg-slate-100 p-4 text-slate-400">
        <Icon name={icon} size={28} />
      </span>
      <p className="font-bold text-slate-700">{title}</p>
      {desc && <p className="max-w-xs text-sm text-slate-500">{desc}</p>}
    </div>
  );
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 font-black text-white shadow-md"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      ت
    </span>
  );
}
