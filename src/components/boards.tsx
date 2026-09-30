// 页面层：按订单 / 按班组 / 按状态 三视图

import type { Order, Receipt, Stone, Team } from "../rules/types";
import {
  STONE_STATUS_LABELS,
  earliestBlockingItem,
  orderOccupiedCount,
  teamQueue,
  teamWaitlist,
} from "../rules/dispatchRules";
import StoneCard from "./StoneCard";

interface BoardProps {
  stones: Stone[];
  orders: Order[];
  teams: Team[];
  receipts: Receipt[];
  onDispatch: (stoneId: string, orderId: string, teamId: string) => void;
  onRetry: (receiptId: string) => void;
  onChangeReview: (stoneId: string, review: Stone["review"]) => void;
  onChangeInsurance: (stoneId: string, insurance: number) => void;
}

function waitlistPosOf(stone: Stone, team: Team, stones: Stone[]): number {
  const wl = teamWaitlist(team, stones);
  return wl.findIndex((s) => s.id === stone.id) + 1;
}

/** 按订单查看：每个订单的石位占用与石头清单 */
export function OrderBoard(props: BoardProps) {
  const { stones, orders } = props;
  return (
    <div className="board">
      {orders.map((order) => {
        const orderStones = stones
          .filter((s) => s.orderId === order.id && s.status !== "returned")
          .sort((a, b) => a.seq - b.seq);
        const occupied = orderOccupiedCount(order, stones);
        return (
          <section key={order.id} className="board-group">
            <header className="board-head">
              <div>
                <h3>{order.orderNo}</h3>
                <p>{order.customer}</p>
              </div>
              <span className="position-meter">
                石位 {occupied}/{order.stonePositions}
              </span>
            </header>
            <div className="card-grid">
              {orderStones.length === 0 && <p className="empty">暂无占用石位的裸石</p>}
              {orderStones.map((s) => (
                <StoneCard
                  key={s.id}
                  stone={s}
                  orders={orders}
                  teams={props.teams}
                  receipt={props.receipts.find((r) => r.stoneId === s.id)}
                  waitlistPos={
                    s.status === "waitlisted" && s.teamId
                      ? waitlistPosOf(s, props.teams.find((t) => t.id === s.teamId)!, stones)
                      : undefined
                  }
                  onDispatch={props.onDispatch}
                  onRetry={props.onRetry}
                  onChangeReview={props.onChangeReview}
                  onChangeInsurance={props.onChangeInsurance}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 按班组查看：当班队列工位 + 候补队列 + 最早阻塞项 */
export function TeamBoard(props: BoardProps) {
  const { stones, teams } = props;
  return (
    <div className="board">
      {teams.map((team) => {
        const queue = teamQueue(team, stones);
        const waitlist = teamWaitlist(team, stones);
        const blocking = earliestBlockingItem(team, stones);
        return (
          <section key={team.id} className="board-group">
            <header className="board-head">
              <div>
                <h3>{team.name}</h3>
                <p>
                  工位 {queue.length}/{team.workstationCapacity}
                  {queue.length >= team.workstationCapacity && (
                    <span className="full-tag">已满</span>
                  )}
                </p>
              </div>
              {blocking && (
                <span className="blocking-tag">
                  最早阻塞：{blocking.stoneNo}（候补第 1 位）
                </span>
              )}
            </header>

            <div className="shift-rows">
              <div className="shift-row">
                <span className="row-label">当班队列</span>
                <div className="slots">
                  {Array.from({ length: team.workstationCapacity }).map((_, i) => {
                    const s = queue[i];
                    return (
                      <div key={i} className={`slot ${s ? "filled" : ""}`}>
                        {s ? (
                          <span title={`${s.stoneNo} · ${s.type}`}>
                            {s.stoneNo}
                          </span>
                        ) : (
                          <span className="slot-empty">空工位</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="shift-row">
                <span className="row-label">候补队列</span>
                <div className="slots waitlist-slots">
                  {waitlist.length === 0 && <span className="empty">暂无候补</span>}
                  {waitlist.map((s, i) => (
                    <div
                      key={s.id}
                      className={`slot wait ${s.id === blocking?.id ? "blocking" : ""}`}
                    >
                      <span>
                        {i + 1}. {s.stoneNo}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card-grid">
              {[...queue, ...waitlist].map((s) => (
                <StoneCard
                  key={s.id}
                  stone={s}
                  orders={props.orders}
                  teams={teams}
                  receipt={props.receipts.find((r) => r.stoneId === s.id)}
                  waitlistPos={
                    s.status === "waitlisted" ? waitlistPosOf(s, team, stones) : undefined
                  }
                  onDispatch={props.onDispatch}
                  onRetry={props.onRetry}
                  onChangeReview={props.onChangeReview}
                  onChangeInsurance={props.onChangeInsurance}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 按状态查看：在批次 / 已占石位 / 当班队列 / 待确认 / 候补 / 已退回 */
export function StatusBoard(props: BoardProps) {
  const { stones } = props;
  const groups: { status: Stone["status"]; title: string }[] = [
    { status: "in_batch", title: "在批次（裸石）" },
    { status: "position_held", title: "已占订单石位" },
    { status: "in_queue", title: "当班队列" },
    { status: "pending_confirm", title: "待确认回执" },
    { status: "waitlisted", title: "候补中" },
    { status: "returned", title: "已退回原批次" },
  ];
  return (
    <div className="board">
      {groups.map((g) => {
        const list = stones
          .filter((s) => s.status === g.status)
          .sort((a, b) => a.seq - b.seq);
        return (
          <section key={g.status} className="board-group">
            <header className="board-head">
              <h3>
                {g.title}
                <span className="count-pill">{list.length}</span>
              </h3>
            </header>
            <div className="card-grid">
              {list.length === 0 && <p className="empty">暂无</p>}
              {list.map((s) => (
                <StoneCard
                  key={s.id}
                  stone={s}
                  orders={props.orders}
                  teams={props.teams}
                  receipt={props.receipts.find((r) => r.stoneId === s.id)}
                  waitlistPos={
                    s.status === "waitlisted" && s.teamId
                      ? waitlistPosOf(s, props.teams.find((t) => t.id === s.teamId)!, stones)
                      : undefined
                  }
                  onDispatch={props.onDispatch}
                  onRetry={props.onRetry}
                  onChangeReview={props.onChangeReview}
                  onChangeInsurance={props.onChangeInsurance}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export { STONE_STATUS_LABELS };
