// 页面层：派工账本（按订单 / 班组 / 状态查看）
// 规则、存档与页面分开维护 —— 本文件只负责页面组合

import { useMemo, useState } from "react";
import "./styles.css";
import { useLedgerStore } from "./ledger/ledgerStore";
import { OrderBoard, StatusBoard, TeamBoard } from "./components/boards";
import { BlockingAlert, LedgerPanel, ReceiptPanel, StoneForm } from "./components/panels";
import { STONE_STATUS_LABELS } from "./rules/dispatchRules";

type View = "order" | "team" | "status";

const VIEW_TABS: { key: View; label: string }[] = [
  { key: "order", label: "按订单" },
  { key: "team", label: "按班组" },
  { key: "status", label: "按状态" },
];

export default function App() {
  const store = useLedgerStore();
  const { state, operator, setOperator } = store;
  const [view, setView] = useState<View>("order");
  const [flash, setFlash] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const total = state.stones.length;
    const inQueue = state.stones.filter((s) => s.status === "in_queue").length;
    const pending = state.receipts.length;
    const waitlist = state.stones.filter((s) => s.status === "waitlisted").length;
    const returned = state.stones.filter((s) => s.status === "returned").length;
    const carat = state.stones.reduce((sum, s) => sum + (s.status === "in_queue" ? s.carat : 0), 0);
    return { total, inQueue, pending, waitlist, returned, carat: carat.toFixed(2) };
  }, [state]);

  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 3200);
  };

  const handleDispatch = (stoneId: string, orderId: string, teamId: string) => {
    const r = store.dispatchStone(stoneId, orderId, teamId);
    if (!r.ok && r.receipt) {
      flashMsg(`写入失败：${r.receipt.error}（已保留待确认回执，重试不重复占石位）`);
    } else if (!r.ok) {
      flashMsg(`派工失败：${r.reason}`);
    } else if (r.receipt) {
      flashMsg(`已占用订单石位，写入失败：${r.receipt.error}（待确认回执已保留）`);
    } else if (r.stone.status === "waitlisted") {
      flashMsg(`班组工位容量不足，已按候补顺序排队`);
    }
  };

  const handleRetry = (receiptId: string) => {
    const r = store.retryReceipt(receiptId);
    if (r.ok) {
      flashMsg(`第 ${r.stone.retries} 次重试成功，未重复占用石位`);
    } else {
      flashMsg(`重试仍失败：${r.reason}（回执已保留）`);
    }
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62006 · 源提示词8 · Port 62006</p>
        <h1>派工账本</h1>
        <span>
          镶嵌车间每天按班组派石：每颗裸石先占用订单石位，再按班组工位容量放入当班队列；
          写入失败保留待确认回执，重试不重复占用石位。复核结论或保险额度变更后连带重算相关订单，
          不再合格的石头退回原批次，工位不足按候补顺序排队，仍放不下显示最早阻塞项。
          每次变动保留前后值、操作人、批次号和重试次数。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>裸石总数</small>
          <strong>{metrics.total}</strong>
        </article>
        <article>
          <small>当班队列</small>
          <strong>{metrics.inQueue}</strong>
        </article>
        <article>
          <small>待确认回执</small>
          <strong>{metrics.pending}</strong>
        </article>
        <article>
          <small>候补 / 已退回</small>
          <strong>
            {metrics.waitlist} / {metrics.returned}
          </strong>
        </article>
      </section>

      <section className="toolbar panel">
        <div className="view-tabs">
          {VIEW_TABS.map((t) => (
            <button
              key={t.key}
              className={view === t.key ? "active" : ""}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="inline operator">
            <span>操作人</span>
            <input value={operator} onChange={(e) => setOperator(e.target.value)} />
          </label>
          <button onClick={store.reset}>重置演示数据</button>
        </div>
      </section>

      {flash && <div className="flash">{flash}</div>}

      <section className="workspace">
        <aside className="panel form-aside">
          <StoneForm onAdd={store.addStone} />
        </aside>

        <section className="board-area">
          <BlockingAlert stones={state.stones} teams={state.teams} />
          <ReceiptPanel
            receipts={state.receipts}
            stones={state.stones}
            orders={state.orders}
            teams={state.teams}
            onRetry={handleRetry}
          />
          <section className="panel">
            <div className="heading">
              <div>
                <p>{VIEW_TABS.find((t) => t.key === view)?.label}查看</p>
                <h2>
                  {view === "order" && "订单石位"}
                  {view === "team" && "班组工位"}
                  {view === "status" && "石头状态"}
                </h2>
              </div>
            </div>
            {view === "order" && (
              <OrderBoard
                stones={state.stones}
                orders={state.orders}
                teams={state.teams}
                receipts={state.receipts}
                onDispatch={handleDispatch}
                onRetry={handleRetry}
                onChangeReview={store.changeReview}
                onChangeInsurance={store.changeInsurance}
              />
            )}
            {view === "team" && (
              <TeamBoard
                stones={state.stones}
                orders={state.orders}
                teams={state.teams}
                receipts={state.receipts}
                onDispatch={handleDispatch}
                onRetry={handleRetry}
                onChangeReview={store.changeReview}
                onChangeInsurance={store.changeInsurance}
              />
            )}
            {view === "status" && (
              <StatusBoard
                stones={state.stones}
                orders={state.orders}
                teams={state.teams}
                receipts={state.receipts}
                onDispatch={handleDispatch}
                onRetry={handleRetry}
                onChangeReview={store.changeReview}
                onChangeInsurance={store.changeInsurance}
              />
            )}
          </section>
        </section>
      </section>

      <LedgerPanel entries={state.ledger} />
    </main>
  );
}

export { STONE_STATUS_LABELS };
