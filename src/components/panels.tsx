// 页面层：待确认回执、最早阻塞项、账本、新增裸石表单

import { useState } from "react";
import type { LedgerEntry, Order, Receipt, Stone, Team } from "../rules/types";
import {
  LEDGER_ACTION_LABELS,
  REVIEW_LABELS,
  STONE_STATUS_LABELS,
  earliestBlockingItem,
} from "../rules/dispatchRules";
import type { NewStoneInput } from "../ledger/ledgerStore";

/** 待确认回执：写入失败后保留，重试不重复占用石位 */
export function ReceiptPanel({
  receipts,
  stones,
  orders,
  teams,
  onRetry,
}: {
  receipts: Receipt[];
  stones: Stone[];
  orders: Order[];
  teams: Team[];
  onRetry: (receiptId: string) => void;
}) {
  if (receipts.length === 0) {
    return (
      <section className="panel">
        <div className="heading">
          <div>
            <p>写入回执</p>
            <h2>待确认回执</h2>
          </div>
        </div>
        <p className="empty">暂无待确认回执</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>写入回执</p>
          <h2>待确认回执（{receipts.length}）</h2>
        </div>
      </div>
      <div className="receipt-list">
        {receipts.map((r) => {
          const stone = stones.find((s) => s.id === r.stoneId);
          return (
            <article key={r.id} className="receipt-row">
              <div>
                <strong>{stone?.stoneNo ?? r.stoneId}</strong>
                <p>{r.error}</p>
                <p className="muted">
                  批次 {r.batchNo} · 订单 {orders.find((o) => o.id === r.orderId)?.orderNo} · 班组{" "}
                  {teams.find((t) => t.id === r.teamId)?.name} · 已重试 {r.retries} 次
                </p>
              </div>
              <button className="primary" onClick={() => onRetry(r.id)}>
                重试（不重复占石位）
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** 最早阻塞项：重算后候补队列仍放不下的第一块石头 */
export function BlockingAlert({ stones, teams }: { stones: Stone[]; teams: Team[] }) {
  const blocking = teams
    .map((t) => ({ team: t, stone: earliestBlockingItem(t, stones) }))
    .filter((x): x is { team: Team; stone: Stone } => x.stone !== null);

  if (blocking.length === 0) return null;

  return (
    <section className="panel blocking-panel">
      <div className="heading">
        <div>
          <p>容量预警</p>
          <h2>最早阻塞项</h2>
        </div>
      </div>
      <div className="blocking-list">
        {blocking.map(({ team, stone }) => (
          <article key={team.id} className="blocking-row">
            <strong>{team.name}</strong>
            <span>
              工位 {team.workstationCapacity} 已满，候补第 1 位{" "}
              <b>{stone.stoneNo}</b>（{stone.batchNo}）仍无法放入 · 请调整班组工位或订单石位
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function describePartial(p: Partial<Stone> | null): string {
  if (!p) return "—";
  const parts: string[] = [];
  if (p.stoneNo) parts.push(`编号 ${p.stoneNo}`);
  if (p.batchNo) parts.push(`批次 ${p.batchNo}`);
  if (p.status) parts.push(`状态 ${STONE_STATUS_LABELS[p.status]}`);
  if (p.review) parts.push(`复核 ${REVIEW_LABELS[p.review]}`);
  if (p.insurance !== undefined) parts.push(`保险 ${p.insurance}`);
  if (p.orderId !== undefined) parts.push(`订单 ${p.orderId ? p.orderId.slice(-6) : "无"}`);
  if (p.teamId !== undefined) parts.push(`班组 ${p.teamId ? p.teamId.slice(-6) : "无"}`);
  return parts.length ? parts.join(" · ") : "—";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 账本：每次变动保留前后值、操作人、批次号和重试次数 */
export function LedgerPanel({ entries }: { entries: LedgerEntry[] }) {
  const sorted = [...entries].sort((a, b) => b.seq - a.seq);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>存档</p>
          <h2>派工账本（{entries.length}）</h2>
        </div>
      </div>
      <div className="ledger-list">
        {sorted.map((e) => (
          <article key={e.id} className="ledger-row">
            <span className="ledger-seq">#{e.seq}</span>
            <div className="ledger-body">
              <div className="ledger-head">
                <span className="ledger-action">{LEDGER_ACTION_LABELS[e.action]}</span>
                <span className="ledger-operator">{e.operator}</span>
                <span className="ledger-batch">批次 {e.batchNo}</span>
                <span className="ledger-retries">重试 {e.retries} 次</span>
                <span className="ledger-time">{formatTime(e.timestamp)}</span>
              </div>
              <p className="ledger-change">
                <span className="before">{describePartial(e.before)}</span>
                <span className="arrow">→</span>
                <span className="after">{describePartial(e.after)}</span>
              </p>
              {e.note && <p className="ledger-note">{e.note}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const EMPTY_FORM: NewStoneInput = {
  stoneNo: "",
  batchNo: "",
  type: "",
  shape: "",
  carat: 0,
  size: "",
  clarity: "",
  color: "",
  cut: "",
  settingPosition: "",
  defectNote: "",
  review: "pending",
  insurance: 0,
};

/** 新增裸石表单 */
export function StoneForm({ onAdd }: { onAdd: (input: NewStoneInput) => void }) {
  const [form, setForm] = useState<NewStoneInput>(EMPTY_FORM);
  const set = <K extends keyof NewStoneInput>(key: K, value: NewStoneInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (!form.stoneNo.trim() || !form.batchNo.trim()) return;
    onAdd({ ...form, carat: Number(form.carat) || 0, insurance: Number(form.insurance) || 0 });
    setForm(EMPTY_FORM);
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>裸石入库</p>
          <h2>新增裸石</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>宝石编号</span>
          <input value={form.stoneNo} placeholder="如 ST-2121" onChange={(e) => set("stoneNo", e.target.value)} />
        </label>
        <label>
          <span>批次号</span>
          <input value={form.batchNo} placeholder="如 B2026-0905" onChange={(e) => set("batchNo", e.target.value)} />
        </label>
        <label>
          <span>种类</span>
          <input value={form.type} placeholder="如 蓝宝石" onChange={(e) => set("type", e.target.value)} />
        </label>
        <label>
          <span>形状</span>
          <input value={form.shape} placeholder="如 椭圆6x4mm" onChange={(e) => set("shape", e.target.value)} />
        </label>
        <label>
          <span>克拉重量</span>
          <input type="number" min={0} step={0.01} value={form.carat || ""} onChange={(e) => set("carat", Number(e.target.value))} />
        </label>
        <label>
          <span>尺寸</span>
          <input value={form.size} placeholder="如 6x4mm" onChange={(e) => set("size", e.target.value)} />
        </label>
        <label>
          <span>净度</span>
          <input value={form.clarity} placeholder="如 VS" onChange={(e) => set("clarity", e.target.value)} />
        </label>
        <label>
          <span>颜色</span>
          <input value={form.color} placeholder="如 矢车菊蓝" onChange={(e) => set("color", e.target.value)} />
        </label>
        <label>
          <span>切工</span>
          <input value={form.cut} placeholder="如 椭圆刻面" onChange={(e) => set("cut", e.target.value)} />
        </label>
        <label>
          <span>镶嵌位置</span>
          <input value={form.settingPosition} placeholder="如 主石位" onChange={(e) => set("settingPosition", e.target.value)} />
        </label>
        <label>
          <span>缺陷备注</span>
          <input value={form.defectNote} placeholder="如 内含物明显" onChange={(e) => set("defectNote", e.target.value)} />
        </label>
        <label>
          <span>复核结论</span>
          <select value={form.review} onChange={(e) => set("review", e.target.value as NewStoneInput["review"])}>
            <option value="qualified">合格</option>
            <option value="pending">待复核</option>
            <option value="unqualified">不合格</option>
          </select>
        </label>
        <label>
          <span>保险额度</span>
          <input type="number" min={0} value={form.insurance || ""} placeholder="0 表示未核定" onChange={(e) => set("insurance", Number(e.target.value))} />
        </label>
      </div>
      <button className="primary form-submit" onClick={submit}>
        入库裸石
      </button>
    </section>
  );
}
