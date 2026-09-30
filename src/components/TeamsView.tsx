// 班组视图：按工位容量显示当班队列，工位不足时候补排队，放不下显示最早阻塞项。
import { useMemo } from "react";
import type { AssignmentStatus, LedgerState } from "../types";
import {
  assignmentContext,
  globalEarliestBlocker,
  teamBoard,
} from "../engine/rules";
import { Badge, EmptyRow, Panel, fmtTime, yuan, type Tone } from "./common";

function statusTone(status: AssignmentStatus): Tone {
  return status === "queued" ? "teal" : status === "waitlisted" ? "amber" : "slate";
}
const STATUS_TEXT: Record<AssignmentStatus, string> = {
  queued: "当班队列",
  waitlisted: "候补",
  returned: "已退回",
};

export function TeamsView({ state }: { state: LedgerState }) {
  const blocker = useMemo(() => globalEarliestBlocker(state), [state]);

  return (
    <div className="stack">
      {blocker && (
        <div className="blocker-banner" role="alert">
          <div>
            <strong>最早阻塞项</strong>
            <p>
              {blocker.stone?.id}（{blocker.team.name}·候补#{blocker.ticket}）
              自 {fmtTime(blocker.since)} 起等待工位，占用订单{" "}
              {blocker.assignment.orderId}/
              {assignmentContext(state, blocker.assignment).slot?.label}
            </p>
          </div>
          <Badge tone="red">工位已满 · 候补排队</Badge>
        </div>
      )}

      <div className="team-grid">
        {state.teams.map((team) => {
          const board = teamBoard(state, team.id);
          const teamBlocker =
            blocker && blocker.team.id === team.id ? blocker : undefined;
          return (
            <Panel
              key={team.id}
              title={
                <span className="team-title">
                  {team.name}
                  {board.full && <Badge tone="red">工位满</Badge>}
                </span>
              }
              hint={`工位 ${board.queued.length}/${board.capacity} · 在班保额 ${yuan(
                board.insuredQueued
              )}`}
            >
              <div className="station-strip">
                {Array.from({ length: board.capacity }).map((_, i) => (
                  <span
                    key={i}
                    className={`station ${i < board.queued.length ? "station--used" : ""}`}
                    title={i < board.queued.length ? "已占用工位" : "空工位"}
                  />
                ))}
              </div>

              <h3 className="subhead">当班队列</h3>
              {board.queued.length === 0 ? (
                <EmptyRow>暂无当班派工，工位全空</EmptyRow>
              ) : (
                <ul className="queue">
                  {board.queued.map((a, i) => {
                    const ctx = assignmentContext(state, a);
                    return (
                      <li key={a.id} className="queue__item">
                        <span className="queue__pos">{i + 1}</span>
                        <div>
                          <strong>{ctx.stone?.id}</strong>
                          <p>
                            {ctx.order?.id} · {ctx.slot?.label} · {ctx.stone?.kind}
                          </p>
                        </div>
                        <Badge tone={statusTone(a.status)}>
                          {STATUS_TEXT[a.status]}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}

              <h3 className="subhead">候补顺序</h3>
              {board.waitlist.length === 0 ? (
                <EmptyRow>没有候补</EmptyRow>
              ) : (
                <ul className="queue">
                  {board.waitlist.map((a) => {
                    const ctx = assignmentContext(state, a);
                    const isFirst = a.id === board.waitlist[0].id;
                    return (
                      <li
                        key={a.id}
                        className={`queue__item ${isFirst ? "queue__item--block" : ""}`}
                      >
                        <span className="queue__pos queue__pos--wait">
                          #{a.ticket}
                        </span>
                        <div>
                          <strong>
                            {ctx.stone?.id}
                            {isFirst && <em className="block-tag">队首·阻塞</em>}
                          </strong>
                          <p>
                            {ctx.order?.id} · {ctx.slot?.label} ·{" "}
                            {fmtTime(a.createdAt)} 起等待
                          </p>
                        </div>
                        <Badge tone={statusTone(a.status)}>
                          {STATUS_TEXT[a.status]}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}

              {teamBlocker && (
                <p className="block-note">
                  仍放不下：最早阻塞为 {teamBlocker.stone?.id}（候补#
                  {teamBlocker.ticket}），需空出 1 个工位方可顺延入队。
                </p>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
