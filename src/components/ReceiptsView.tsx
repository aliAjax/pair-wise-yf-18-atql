// 回执视图：写入失败后保留待确认回执；重试只重放写入，绝不重新占用石位 / 工位。
import type { LedgerState, Receipt } from "../types";
import { RECEIPT_LABEL } from "../types";
import { assignmentContext } from "../engine/rules";
import { Badge, EmptyRow, Panel, fmtTimeSec, yuan, type Tone } from "./common";

function receiptTone(status: Receipt["status"]): Tone {
  if (status === "confirmed") return "green";
  if (status === "voided") return "slate";
  return "red";
}

export function ReceiptsView({
  state,
  inFlight,
  onRetry,
}: {
  state: LedgerState;
  inFlight: ReadonlySet<string>;
  onRetry: (receiptId: string) => void;
}) {
  const pending = state.receipts.filter((r) => r.status === "pending");
  const settled = state.receipts
    .filter((r) => r.status !== "pending")
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  return (
    <div className="stack">
      <Panel
        title="待确认回执"
        hint="写入未确认的派工；石位已占用且保留，重试仅重放写入，不会重复占用。"
        actions={<Badge tone="red">{pending.length} 条待确认</Badge>}
      >
        {pending.length === 0 ? (
          <EmptyRow>没有待确认回执，所有写入均已确认</EmptyRow>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>裸石 / 批次</th>
                  <th>占用位置</th>
                  <th>班组</th>
                  <th>尝试次数</th>
                  <th>最近错误</th>
                  <th>操作人 / 时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pending
                  .slice()
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                  .map((r) => {
                    const assignment = state.assignments.find(
                      (a) => a.id === r.assignmentId
                    );
                    const ctx = assignment
                      ? assignmentContext(state, assignment)
                      : undefined;
                    const busy = inFlight.has(r.idemKey);
                    return (
                      <tr key={r.id} className="row--pending">
                        <td>
                          <strong>{ctx?.stone?.id}</strong>
                          <span className="muted block">
                            批 {ctx?.stone?.batchId} · 保额{" "}
                            {ctx?.stone ? yuan(ctx.stone.insuredAmount) : "—"}
                          </span>
                        </td>
                        <td>
                          {ctx?.order?.id} · {ctx?.slot?.label}
                          <span className="muted block">
                            石位为既有占用
                          </span>
                        </td>
                        <td>{ctx?.team?.name}</td>
                        <td>
                          <Badge tone="amber">第 {r.attempts} 次尝试</Badge>
                        </td>
                        <td className="error-cell">{r.lastError || "等待写入确认…"}</td>
                        <td>
                          {r.operator}
                          <span className="muted block">
                            {fmtTimeSec(r.createdAt)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="primary btn-sm"
                            onClick={() => onRetry(r.id)}
                            disabled={busy}
                          >
                            {busy ? "写入中…" : "重试写入"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="近期已处理回执" hint="已确认 / 已作废，留痕备查。">
        {settled.length === 0 ? (
          <EmptyRow>暂无历史回执</EmptyRow>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>裸石</th>
                  <th>状态</th>
                  <th>尝试次数</th>
                  <th>操作人</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((r) => {
                  const assignment = state.assignments.find(
                    (a) => a.id === r.assignmentId
                  );
                  const ctx = assignment
                    ? assignmentContext(state, assignment)
                    : undefined;
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{ctx?.stone?.id}</strong>
                      </td>
                      <td>
                        <Badge tone={receiptTone(r.status)}>
                          {RECEIPT_LABEL[r.status]}
                        </Badge>
                      </td>
                      <td>共 {r.attempts} 次</td>
                      <td>{r.operator}</td>
                      <td>{fmtTimeSec(r.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
