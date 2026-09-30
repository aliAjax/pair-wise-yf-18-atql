// 派工账本页面：负责筛选、导航与触发动作；规则在 engine/rules.ts，存档在 engine/archive.ts。
import { useMemo, useState } from "react";
import "./styles.css";
import { useLedger } from "./engine/store";
import { createTransport } from "./engine/archive";
import {
  FAILURE_MODE_LABEL,
  type FailureMode,
} from "./engine/archive";
import {
  activeAssignments,
  globalEarliestBlocker,
  pendingReceipts,
} from "./engine/rules";
import { TeamsView } from "./components/TeamsView";
import { OrdersView } from "./components/OrdersView";
import { DispatchView } from "./components/DispatchView";
import { ReceiptsView } from "./components/ReceiptsView";
import { StonesView } from "./components/StonesView";
import { AuditView, type AuditFilter } from "./components/AuditView";
import { Badge } from "./components/common";
import type { StonePhase } from "./types";

type Tab = "dispatch" | "teams" | "orders" | "stones" | "receipts" | "audit";
type StoneStatusFilter = "all" | StonePhase;

const TABS: { id: Tab; label: string }[] = [
  { id: "dispatch", label: "派工" },
  { id: "teams", label: "班组队列" },
  { id: "orders", label: "订单石位" },
  { id: "stones", label: "裸石台账" },
  { id: "receipts", label: "待确认回执" },
  { id: "audit", label: "变动留痕" },
];

// 全局只创建一个传输实例，跨渲染复用。
const transport = createTransport("flaky");

function App() {
  const { state, inFlight, error, api } = useLedger(transport);

  const [tab, setTab] = useState<Tab>("dispatch");
  const [operator, setOperator] = useState("王玫（排石员）");
  const [orderFilter, setOrderFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [failureMode, setFailureMode] = useState<FailureMode>("flaky");
  const [stoneStatus, setStoneStatus] = useState<StoneStatusFilter>("all");
  const [auditStatus, setAuditStatus] = useState<AuditFilter>("all");

  const pendingCount = pendingReceipts(state).length;
  const active = activeAssignments(state);
  const blocker = globalEarliestBlocker(state);
  const queuedCount = active.filter((a) => a.status === "queued").length;
  const waitlistCount = active.filter((a) => a.status === "waitlisted").length;

  const metrics = useMemo(
    () => [
      { label: "当班队列", value: queuedCount, tone: "teal" as const },
      { label: "候补排队", value: waitlistCount, tone: "amber" as const },
      { label: "待确认回执", value: pendingCount, tone: "red" as const },
      {
        label: "最早阻塞",
        value: blocker ? `#${blocker.ticket}` : "无",
        tone: blocker ? ("red" as const) : ("green" as const),
      },
    ],
    [queuedCount, waitlistCount, pendingCount, blocker]
  );

  const changeMode = (mode: FailureMode) => {
    setFailureMode(mode);
    api.setFailureMode(mode);
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <h1>镶嵌派工账本</h1>
          <p>
            先占订单石位，再按班组工位容量入队 · 复核变动连带重算 ·
            写入失败保留回执、重试不重复占用
          </p>
        </div>
        <div className="topbar__controls">
          <label className="operator-box">
            <span>操作人</span>
            <input
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="填写操作人姓名"
            />
          </label>
          <label className="operator-box">
            <span>写入链路</span>
            <select
              value={failureMode}
              onChange={(e) => changeMode(e.target.value as FailureMode)}
            >
              {(Object.keys(FAILURE_MODE_LABEL) as FailureMode[]).map((m) => (
                <option key={m} value={m}>
                  {FAILURE_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-sm" onClick={api.reset}>
            重置演示数据
          </button>
        </div>
      </header>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>
              <Badge tone={m.tone}>{m.value}</Badge>
            </strong>
          </article>
        ))}
      </section>

      {error && (
        <div className="error-banner" role="alert">
          {error.message}
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => {
          const badge =
            t.id === "receipts" && pendingCount > 0 ? pendingCount : undefined;
          return (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {badge !== undefined && <span className="tab__dot">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="global-filter">
        <label className="operator-box">
          <span>按订单</span>
          <select
            value={orderFilter}
            onChange={(e) => setOrderFilter(e.target.value)}
          >
            <option value="all">全部订单</option>
            {state.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="operator-box">
          <span>按班组</span>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="all">全部班组</option>
            {state.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="operator-box operator-box--grow">
          <span>搜索（石头 / 批次 / 操作人）</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="如 ST-2048 / B2409-B / 王玫"
          />
        </label>
      </div>

      <section className="content">
        {tab === "dispatch" && (
          <DispatchView
            state={state}
            operator={operator}
            onDispatch={api.dispatch}
          />
        )}
        {tab === "teams" && (
          <TeamsView state={filterByTeam(state, teamFilter)} />
        )}
        {tab === "orders" && (
          <OrdersView state={state} orderFilter={orderFilter} />
        )}
        {tab === "stones" && (
          <StonesView
            state={state}
            operator={operator}
            statusFilter={stoneStatus}
            onStatusChange={setStoneStatus}
            onChangeReview={api.changeReview}
          />
        )}
        {tab === "receipts" && (
          <ReceiptsView
            state={state}
            inFlight={inFlight}
            onRetry={api.retry}
          />
        )}
        {tab === "audit" && (
          <AuditView
            audit={state.audit}
            orderFilter={orderFilter}
            teamFilter={teamFilter}
            keyword={keyword}
            statusFilter={auditStatus}
            onStatusChange={setAuditStatus}
          />
        )}
      </section>

      <footer className="footnote">
        规则（engine/rules.ts）、存档（engine/archive.ts + localStorage
        发件箱）、页面（components/*）分开维护。派工占用与写入确认解耦，
        任何重试都以幂等键复用既有派工记录。
      </footer>
    </main>
  );
}

/** 班组视图的班组筛选：只保留被选中的班组，派生看板自动重算。 */
function filterByTeam(
  state: ReturnType<typeof useLedger>["state"],
  teamId: string
) {
  if (teamId === "all") return state;
  return { ...state, teams: state.teams.filter((t) => t.id === teamId) };
}

export default App;
