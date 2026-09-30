// 裸石台账：按批次查看石头；可修改复核结论 / 保险额度。
// 复核结论变化由规则引擎连带重算：不合格的退回原批次、释放工位、候补顺延。
import { useMemo, useState } from "react";
import type { LedgerState, ReviewStatus } from "../types";
import {
  activeAssignmentOfStone,
  assignmentContext,
  stonePhase,
} from "../engine/rules";
import {
  PHASE_LABEL,
  REVIEW_LABEL,
  type StonePhase as Phase,
} from "../types";
import {
  Badge,
  ChipBar,
  EmptyRow,
  Panel,
  fmtTime,
  yuan,
  type Tone,
} from "./common";
import type { ReviewChangeArgs } from "../engine/store";

type StatusFilter = "all" | Phase;

export const STONE_STATUS_OPTIONS: {
  value: StatusFilter;
  label: string;
}[] = [
  { value: "all", label: "全部" },
  { value: "unassigned", label: "待派工" },
  { value: "assigned", label: "已派工" },
  { value: "returned", label: "已退回批次" },
];

function reviewTone(review: ReviewStatus): Tone {
  if (review === "pass") return "green";
  if (review === "hold") return "amber";
  return "red";
}

function phaseTone(phase: Phase): Tone {
  if (phase === "assigned") return "teal";
  if (phase === "returned") return "violet";
  return "slate";
}

export function StonesView({
  state,
  operator,
  statusFilter,
  onStatusChange,
  onChangeReview,
}: {
  state: LedgerState;
  operator: string;
  statusFilter: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  onChangeReview: (args: ReviewChangeArgs) => void;
}) {
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});

  const phases = useMemo(() => {
    const map = new Map<string, Phase>();
    state.stones.forEach((s) => map.set(s.id, stonePhase(state, s.id)));
    return map;
  }, [state]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: state.stones.length,
      unassigned: 0,
      assigned: 0,
      returned: 0,
    };
    phases.forEach((p) => {
      c[p] += 1;
    });
    return c;
  }, [state.stones.length, phases]);

  const batches = state.stones.reduce<Map<string, typeof state.stones>>(
    (map, stone) => {
      const list = map.get(stone.batchId) ?? [];
      list.push(stone);
      map.set(stone.batchId, list);
      return map;
    },
    new Map()
  );

  const visible = (stoneId: string) =>
    statusFilter === "all" || phases.get(stoneId) === statusFilter;

  return (
    <div className="stack">
      <Panel
        title="裸石台账（按批次）"
        hint="复核结论与保险额度常在派工后变化；改动后自动连带重算相关订单与候补。"
        actions={
          <ChipBar
            options={STONE_STATUS_OPTIONS.map((o) => ({
              ...o,
              count: counts[o.value],
            }))}
            value={statusFilter}
            onChange={onStatusChange}
          />
        }
      >
        {Array.from(batches.entries()).map(([batchId, list]) => {
          const shown = list.filter((s) => visible(s.id));
          if (shown.length === 0) return null;
          return (
            <section key={batchId} className="batch-block">
              <h3 className="subhead">
                批次 {batchId}
                <span className="muted">（{shown.length} 颗）</span>
              </h3>
              <div className="table-wrap">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>裸石</th>
                      <th>规格</th>
                      <th>复核结论</th>
                      <th>保险额度</th>
                      <th>当前占用</th>
                      <th>变动操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((stone) => {
                      const phase = phases.get(stone.id) ?? "unassigned";
                      const active = activeAssignmentOfStone(state, stone.id);
                      const ctx = active
                        ? assignmentContext(state, active)
                        : undefined;
                      const draft = amountDraft[stone.id] ?? "";
                      const draftNum = Number(draft);
                      const amountDirty =
                        draft !== "" &&
                        Number.isFinite(draftNum) &&
                        draftNum !== stone.insuredAmount;
                      return (
                        <tr key={stone.id}>
                          <td>
                            <strong>{stone.id}</strong>
                            <div className="muted">
                              {stone.kind}
                              {stone.note ? ` · ${stone.note}` : ""}
                            </div>
                          </td>
                          <td>
                            {stone.shape}
                            <span className="muted block">
                              {stone.weightCt}ct
                            </span>
                          </td>
                          <td>
                            <Badge tone={reviewTone(stone.review)}>
                              {REVIEW_LABEL[stone.review]}
                            </Badge>
                          </td>
                          <td>
                            <div className="amount-edit">
                              <input
                                type="number"
                                min={0}
                                step={100}
                                value={draft}
                                placeholder={String(stone.insuredAmount)}
                                onChange={(e) =>
                                  setAmountDraft((m) => ({
                                    ...m,
                                    [stone.id]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                className="btn-sm"
                                disabled={!amountDirty || !operator.trim()}
                                title={
                                  !operator.trim()
                                    ? "请先在顶部填写操作人"
                                    : undefined
                                }
                                onClick={() => {
                                  onChangeReview({
                                    stoneId: stone.id,
                                    insuredAmount: draftNum,
                                    operator: operator.trim(),
                                  });
                                  setAmountDraft((m) => {
                                    const next = { ...m };
                                    delete next[stone.id];
                                    return next;
                                  });
                                }}
                              >
                                改保额
                              </button>
                            </div>
                            {!amountDirty && (
                              <span className="muted">{yuan(stone.insuredAmount)}</span>
                            )}
                          </td>
                          <td>
                            {active && ctx ? (
                              <span>
                                <Badge tone={phaseTone(phase)}>
                                  {PHASE_LABEL[phase]}
                                </Badge>
                                <span className="muted block">
                                  {ctx.order?.id}/{ctx.slot?.label} ·{" "}
                                  {ctx.team?.name}
                                </span>
                              </span>
                            ) : (
                              <Badge tone={phaseTone(phase)}>
                                {PHASE_LABEL[phase]}
                              </Badge>
                            )}
                          </td>
                          <td>
                            <div className="review-actions">
                              {(
                                [
                                  ["pass", "判合格"],
                                  ["hold", "待确认"],
                                  ["reject", "判不合格"],
                                ] as [ReviewStatus, string][]
                              ).map(([value, label]) => (
                                <button
                                  key={value}
                                  className={`btn-sm ${
                                    stone.review === value
                                      ? "btn-sm--active"
                                      : ""
                                  } ${value === "reject" ? "btn-danger" : ""}`}
                                  disabled={
                                    stone.review === value || !operator.trim()
                                  }
                                  title={
                                    !operator.trim()
                                      ? "请先在顶部填写操作人"
                                      : undefined
                                  }
                                  onClick={() =>
                                    onChangeReview({
                                      stoneId: stone.id,
                                      review: value,
                                      operator: operator.trim(),
                                    })
                                  }
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            {phase === "assigned" && (
                              <small className="warn-text">
                                当前已占用 {ctx?.order?.id}；改判待确认 / 不合格将
                                退回批次 {stone.batchId} 并触发候补顺延
                              </small>
                            )}
                            {phase === "returned" && (
                              <small className="muted block">
                                退回时间{" "}
                                {active?.returnedAt
                                  ? fmtTime(active.returnedAt)
                                  : "—"}
                              </small>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {counts[statusFilter as StatusFilter] === 0 && (
          <EmptyRow>该状态下暂无裸石</EmptyRow>
        )}
      </Panel>
    </div>
  );
}
