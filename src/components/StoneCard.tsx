// 页面层：裸石卡片（派工 / 重试 / 变更复核与保险）

import { useState } from "react";
import type { Order, Receipt, ReviewConclusion, Stone, Team } from "../rules/types";
import { STONE_STATUS_LABELS } from "../rules/dispatchRules";

interface Props {
  stone: Stone;
  orders: Order[];
  teams: Team[];
  receipt?: Receipt | null;
  /** 候补位次（1 起） */
  waitlistPos?: number;
  onDispatch: (stoneId: string, orderId: string, teamId: string) => void;
  onRetry: (receiptId: string) => void;
  onChangeReview: (stoneId: string, review: ReviewConclusion) => void;
  onChangeInsurance: (stoneId: string, insurance: number) => void;
}

const STATUS_COLORS: Record<Stone["status"], string> = {
  in_batch: "#64748b",
  position_held: "#0f766e",
  in_queue: "#0369a1",
  pending_confirm: "#b45309",
  waitlisted: "#a16207",
  returned: "#be123c",
};

export default function StoneCard({
  stone,
  orders,
  teams,
  receipt,
  waitlistPos,
  onDispatch,
  onRetry,
  onChangeReview,
  onChangeInsurance,
}: Props) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [insuranceDraft, setInsuranceDraft] = useState<string>(String(stone.insurance || ""));

  const canDispatch = stone.status === "in_batch" || stone.status === "returned";
  const pending = stone.status === "pending_confirm" && receipt;

  return (
    <article className="stone-card" data-status={stone.status}>
      <header className="stone-head">
        <div>
          <strong>{stone.stoneNo}</strong>
          <span className="stone-batch">批次 {stone.batchNo}</span>
        </div>
        <span
          className="status-badge"
          style={{ background: STATUS_COLORS[stone.status] }}
        >
          {STONE_STATUS_LABELS[stone.status]}
        </span>
      </header>

      <p className="stone-spec">
        {stone.type} · {stone.shape} · {stone.carat}ct · {stone.size} · {stone.settingPosition}
      </p>
      <p className="stone-spec muted">
        净度 {stone.clarity} · 颜色 {stone.color} · 切工 {stone.cut}
      </p>
      {stone.defectNote && (
        <p className="stone-spec defect">缺陷备注：{stone.defectNote}</p>
      )}

      <div className="stone-meta">
        <label className="inline">
          <span>复核结论</span>
          <select
            value={stone.review}
            onChange={(e) => onChangeReview(stone.id, e.target.value as ReviewConclusion)}
          >
            <option value="qualified">合格</option>
            <option value="pending">待复核</option>
            <option value="unqualified">不合格</option>
          </select>
        </label>
        <label className="inline">
          <span>保险额度</span>
          <input
            type="number"
            min={0}
            value={insuranceDraft}
            placeholder="核定后写入"
            onChange={(e) => setInsuranceDraft(e.target.value)}
            onBlur={() => {
              const v = Number(insuranceDraft) || 0;
              if (v !== stone.insurance) onChangeInsurance(stone.id, v);
            }}
          />
        </label>
        <span className="retries">重试 {stone.retries} 次</span>
      </div>

      {canDispatch && (
        <div className="stone-actions">
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo} · {o.customer}（{o.stonePositions}位）
              </option>
            ))}
          </select>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（工位 {t.workstationCapacity}）
              </option>
            ))}
          </select>
          <button
            className="primary"
            onClick={() => onDispatch(stone.id, orderId, teamId)}
          >
            派工
          </button>
        </div>
      )}

      {pending && (
        <div className="receipt-box">
          <div>
            <strong>待确认回执</strong>
            <p>{receipt.error}</p>
            <p className="muted">
              订单 {orders.find((o) => o.id === receipt.orderId)?.orderNo} · 班组{" "}
              {teams.find((t) => t.id === receipt.teamId)?.name} · 已重试 {receipt.retries} 次
            </p>
          </div>
          <button className="primary" onClick={() => onRetry(receipt.id)}>
            重试（不重复占石位）
          </button>
        </div>
      )}

      {stone.status === "waitlisted" && (
        <p className="waitlist-note">
          候补第 {waitlistPos ?? "—"} 位 · 等待班组工位
        </p>
      )}
    </article>
  );
}
