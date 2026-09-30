// 订单视图：按订单查看石位占用（队列 / 候补 / 空闲）。
import type { LedgerState } from "../types";
import { orderSummary } from "../engine/rules";
import { Badge, EmptyRow, Panel, yuan } from "./common";

export function OrdersView({
  state,
  orderFilter,
}: {
  state: LedgerState;
  orderFilter: string;
}) {
  const orders = state.orders.filter(
    (o) => orderFilter === "all" || o.id === orderFilter
  );

  return (
    <div className="stack">
      {orders.map((order) => {
        const summary = orderSummary(state, order.id);
        return (
          <Panel
            key={order.id}
            title={
              <span>
                {order.id} · {order.name}
              </span>
            }
            hint={`共 ${summary.total} 个石位 · 已占 ${summary.occupied} · 空闲 ${summary.free}`}
            actions={
              <div className="mini-stats">
                <Badge tone="teal">当班 {summary.queued}</Badge>
                <Badge tone="amber">候补 {summary.waitlisted}</Badge>
              </div>
            }
          >
            <div className="slot-grid">
              {summary.rows.map(({ slot, assignment, stone }) => (
                <article
                  key={slot.id}
                  className={`slot-card ${
                    assignment
                      ? assignment.status === "waitlisted"
                        ? "slot-card--wait"
                        : "slot-card--filled"
                      : ""
                  }`}
                >
                  <header>
                    <strong>{slot.label}</strong>
                    <span className="slot-kind">需 {slot.requiredKind}</span>
                  </header>
                  {!assignment || !stone ? (
                    <EmptyRow>石位空闲 · 待派工</EmptyRow>
                  ) : (
                    <div className="slot-body">
                      <div className="slot-stone">
                        <strong>{stone.id}</strong>
                        <span>
                          {stone.shape} · {stone.weightCt}ct
                        </span>
                        <span className="muted">
                          保额 {yuan(stone.insuredAmount)} · 批 {stone.batchId}
                        </span>
                      </div>
                      <div className="slot-meta">
                        <Badge
                          tone={
                            assignment.status === "queued" ? "teal" : "amber"
                          }
                        >
                          {assignment.status === "queued"
                            ? "当班队列"
                            : `候补 #${assignment.ticket}`}
                        </Badge>
                        <span className="muted">
                          {state.teams.find((t) => t.id === assignment.teamId)
                            ?.name ?? assignment.teamId}
                        </span>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
