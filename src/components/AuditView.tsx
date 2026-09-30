// 变动留痕：每次变动保留前后值、操作人、批次号、重试次数。
import { useMemo } from "react";
import type { AuditEntry } from "../types";
import { Badge, ChipBar, EmptyRow, Panel, fmtTimeSec, type Tone } from "./common";

export type AuditFilter = "all" | "dispatch" | "write" | "review" | "system";

const ACTION_META: Record<
  string,
  { label: string; tone: Tone; group: Exclude<AuditFilter, "all"> }
> = {
  dispatch: { label: "派工占用", tone: "teal", group: "dispatch" },
  confirm: { label: "写入确认", tone: "green", group: "write" },
  "write-failed": { label: "写入失败", tone: "red", group: "write" },
  retry: { label: "重试", tone: "amber", group: "write" },
  "review-change": { label: "复核 / 保额变化", tone: "violet", group: "review" },
  recalc: { label: "连带重算", tone: "blue", group: "system" },
  promote: { label: "候补顺延", tone: "blue", group: "system" },
  return: { label: "退回批次", tone: "violet", group: "review" },
  restore: { label: "恢复回执", tone: "slate", group: "system" },
  boot: { label: "初始化", tone: "slate", group: "system" },
};

function groupOf(action: string): Exclude<AuditFilter, "all"> {
  return ACTION_META[action]?.group ?? "system";
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "是" : "否";
  // 枚举值（pass / hold / reject 等）尽量给中文
  const map: Record<string, string> = {
    pass: "合格",
    hold: "待客户确认",
    reject: "不合格",
    queued: "当班队列",
    waitlisted: "候补排队",
    returned: "已退回批次",
    pending: "待确认",
    confirmed: "已确认",
    voided: "已作废",
  };
  return map[String(v)] ?? String(v);
}

export function AuditView({
  audit,
  orderFilter,
  teamFilter,
  keyword,
  statusFilter,
  onStatusChange,
}: {
  audit: AuditEntry[];
  orderFilter: string;
  teamFilter: string;
  keyword: string;
  statusFilter: AuditFilter;
  onStatusChange: (s: AuditFilter) => void;
}) {
  const options: { value: AuditFilter; label: string; count?: number }[] = [
    { value: "all", label: "全部变动" },
    { value: "dispatch", label: "派工占用" },
    { value: "write", label: "写入 / 回执" },
    { value: "review", label: "复核 / 退回" },
    { value: "system", label: "重算 / 顺延" },
  ];

  const counts = useMemo(() => {
    const c: Record<AuditFilter, number> = {
      all: audit.length,
      dispatch: 0,
      write: 0,
      review: 0,
      system: 0,
    };
    audit.forEach((e) => {
      c[groupOf(e.action)] += 1;
    });
    return c;
  }, [audit]);

  const kw = keyword.trim().toLowerCase();
  const rows = audit.filter((e) => {
    if (statusFilter !== "all" && groupOf(e.action) !== statusFilter)
      return false;
    if (orderFilter !== "all" && e.orderId !== orderFilter) return false;
    if (teamFilter !== "all" && e.teamId !== teamFilter) return false;
    if (kw) {
      const hay = [
        e.summary,
        e.operator,
        e.batchId,
        e.stoneId,
        e.orderId,
        e.teamId,
        ...(e.changes ?? []).map((c) => `${c.field} ${c.before} ${c.after}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  return (
    <Panel
      title="变动留痕"
      hint="每条记录含前后值、操作人、批次号；回执相关变动含写入尝试次数。"
      actions={
        <ChipBar
          options={options.map((o) => ({ ...o, count: counts[o.value] }))}
          value={statusFilter}
          onChange={onStatusChange}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyRow>没有符合条件的变动记录</EmptyRow>
      ) : (
        <ol className="audit-list">
          {rows.map((e) => {
            const meta = ACTION_META[e.action] ?? {
              label: e.action,
              tone: "slate" as Tone,
            };
            return (
              <li key={e.id} className="audit-item">
                <div className="audit-item__head">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <strong className="audit-item__summary">{e.summary}</strong>
                </div>
                <div className="audit-item__meta">
                  <span>操作人：{e.operator}</span>
                  <span>{fmtTimeSec(e.at)}</span>
                  {e.batchId && <span>批次号：{e.batchId}</span>}
                  {typeof e.attempts === "number" && (
                    <span className="attempts">
                      写入尝试：第 {e.attempts} 次
                    </span>
                  )}
                </div>
                {e.changes && e.changes.length > 0 && (
                  <div className="change-list">
                    {e.changes.map((c, i) => (
                      <span key={i} className="change-chip">
                        {c.field}：<del>{fmtValue(c.before)}</del> →{" "}
                        <ins>{fmtValue(c.after)}</ins>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
