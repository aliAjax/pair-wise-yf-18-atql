// 派工视图：每颗裸石先占用订单石位，再按班组工位容量入队 / 候补。
// 派工先建立占用与待确认回执，再走写入；重试在回执视图处理，绝不重复占用。
import { useMemo, useState } from "react";
import type { LedgerState } from "../types";
import {
  dispatchableStones,
  isSlotFree,
  stonePhase,
  teamQueued,
} from "../engine/rules";
import { PHASE_LABEL, REVIEW_LABEL } from "../types";
import { Badge, Field, Panel, yuan } from "./common";
import type { DispatchArgs } from "../engine/store";

export function DispatchView({
  state,
  operator,
  onDispatch,
}: {
  state: LedgerState;
  operator: string;
  onDispatch: (args: DispatchArgs) => void;
}) {
  const [stoneId, setStoneId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [teamId, setTeamId] = useState(state.teams[0]?.id ?? "");

  const dispatchable = useMemo(() => {
    return new Set(dispatchableStones(state).map((s) => s.id));
  }, [state]);

  const stone = state.stones.find((s) => s.id === stoneId);
  const order = state.orders.find((o) => o.id === orderId);
  const team = state.teams.find((t) => t.id === teamId);

  const slotOptions = useMemo(() => {
    if (!order) return [];
    return order.slots.map((slot) => {
      const free = isSlotFree(state, order.id, slot.id);
      const kindMatch = stone ? slot.requiredKind === stone.kind : true;
      return { slot, free, kindMatch, enabled: free && kindMatch };
    });
  }, [order, state, stone]);

  // 选了石头后自动带出"石种匹配且空闲"的第一个订单石位
  const effectiveSlotId = slotOptions.some((o) => o.slot.id === slotId)
    ? slotId
    : slotOptions.find((o) => o.enabled)?.slot.id ?? "";

  const queuedCount = team ? teamQueued(state, team.id).length : 0;
  const willQueue = team ? queuedCount < team.stationCapacity : false;

  const canSubmit =
    Boolean(stone) &&
    Boolean(order) &&
    Boolean(effectiveSlotId) &&
    Boolean(team) &&
    dispatchable.has(stoneId) &&
    operator.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onDispatch({
      stoneId,
      orderId: order!.id,
      slotId: effectiveSlotId,
      teamId: team!.id,
      operator: operator.trim(),
    });
    // 保留订单 / 班组，清空石头与石位，便于连续派工
    setStoneId("");
    setSlotId("");
  };

  return (
    <div className="dispatch-layout">
      <Panel
        title="当班派工"
        hint="先占用订单石位，再按班组工位容量放入当班队列；工位不足自动按候补顺序排队。"
      >
        <div className="form-grid">
          <Field label="① 选择裸石" hint="仅复核合格、当前未占用石位的石头可派">
            <select
              value={stoneId}
              onChange={(e) => {
                setStoneId(e.target.value);
                setSlotId("");
              }}
            >
              <option value="">请选择裸石…</option>
              {state.stones.map((s) => {
                const phase = stonePhase(state, s.id);
                const enabled = dispatchable.has(s.id);
                return (
                  <option key={s.id} value={s.id} disabled={!enabled}>
                    {s.id}（{s.kind}·{REVIEW_LABEL[s.review]}
                    {enabled ? "" : `·${PHASE_LABEL[phase]}`}）·批{s.batchId}
                  </option>
                );
              })}
            </select>
          </Field>

          <Field label="② 选择订单">
            <select
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                setSlotId("");
              }}
            >
              <option value="">请选择订单…</option>
              {state.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id} · {o.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="③ 占用石位" hint="已占用 / 石种不符的石位不可选">
            <select
              value={effectiveSlotId}
              onChange={(e) => setSlotId(e.target.value)}
              disabled={!order}
            >
              <option value="">请选择石位…</option>
              {slotOptions.map(({ slot, free, kindMatch, enabled }) => (
                <option
                  key={slot.id}
                  value={slot.id}
                  disabled={!enabled}
                >
                  {slot.label}（需{slot.requiredKind}）
                  {!free ? "·已占用" : !kindMatch ? "·石种不符" : "·空闲"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="④ 放入班组队列">
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {state.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（工位 {teamQueued(state, t.id).length}/{t.stationCapacity}）
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="dispatch-preview">
          {stone && effectiveSlotId && team ? (
            <div className="dispatch-flow">
              <span className="flow-chip">
                {stone.id}
                <small>保额 {yuan(stone.insuredAmount)}</small>
              </span>
              <span className="flow-arrow">→ 占用石位</span>
              <span className="flow-chip">
                {order?.id} ·{" "}
                {order?.slots.find((s) => s.id === effectiveSlotId)?.label}
              </span>
              <span className="flow-arrow">→</span>
              <span
                className={`flow-chip ${willQueue ? "" : "flow-chip--wait"}`}
              >
                {team.name} ·{" "}
                {willQueue
                  ? `进入当班队列（${queuedCount + 1}/${team.stationCapacity}）`
                  : `工位已满，候补 #${state.nextTicket}`}
              </span>
            </div>
          ) : (
            <p className="muted">
              依次选择裸石、订单石位与班组，这里会预览占用与入队结果。
            </p>
          )}
        </div>

        <div className="dispatch-actions">
          <button
            className="primary"
            onClick={submit}
            disabled={!canSubmit}
            title={
              operator.trim().length === 0 ? "请先在顶部填写操作人" : undefined
            }
          >
            占用石位并派工
          </button>
          <Badge tone="slate">写入失败保留待确认回执，重试不重复占用</Badge>
        </div>
      </Panel>
    </div>
  );
}
