// 页面层共用的小组件：纯展示，不含业务规则。
import type { ReactNode } from "react";

export type Tone =
  | "green"
  | "amber"
  | "red"
  | "teal"
  | "violet"
  | "slate"
  | "blue";

const TONE_CLASS: Record<Tone, string> = {
  green: "badge--green",
  amber: "badge--amber",
  red: "badge--red",
  teal: "badge--teal",
  violet: "badge--violet",
  slate: "badge--slate",
  blue: "badge--blue",
};

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function Panel({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel__head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <p className="panel__hint">{hint}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <small className="field__hint">{hint}</small>}
    </label>
  );
}

export function yuan(value: number): string {
  return `¥${value.toLocaleString("zh-CN")}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

export function fmtTimeSec(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ChipBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips" role="tablist" aria-label="状态筛选">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`chip ${value === opt.value ? "chip--active" : ""}`}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {opt.label}
          {typeof opt.count === "number" && (
            <span className="chip__count">{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
