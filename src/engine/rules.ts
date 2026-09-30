// 规则引擎：派工账本的全部业务规则集中在此，纯函数、不碰 localStorage 也不碰 React。
// 页面只负责触发与展示，存档只负责持久化，规则改动只维护这一个文件。

import type {
  Assignment,
  AssignmentStatus,
  AuditEntry,
  LedgerState,
  LooseStone,
  Order,
  Receipt,
  ReviewStatus,
  StonePhase,
  Team,
} from "../types";
import { STATUS_LABEL } from "../types";

/** 时钟可注入，保证规则确定性、便于测试。 */
export interface Clock {
  now(): string;
  id(prefix: string): string;
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString(),
  id: (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
};

const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

function audit(
  state: LedgerState,
  clock: Clock,
  entry: Omit<AuditEntry, "id" | "at"> & { at?: string }
): AuditEntry {
  const full: AuditEntry = {
    id: clock.id("L"),
    at: entry.at ?? clock.now(),
    operator: entry.operator,
    action: entry.action,
    summary: entry.summary,
    batchId: entry.batchId,
    stoneId: entry.stoneId,
    orderId: entry.orderId,
    teamId: entry.teamId,
    attempts: entry.attempts,
    changes: entry.changes,
  };
  state.audit.unshift(full);
  return full;
}

// ---------------------------------------------------------------------------
// 查询（派生数据）：所有"当前看板"都从这里算，白板不再单独维护、不会失真
// ---------------------------------------------------------------------------

export function activeAssignments(state: LedgerState): Assignment[] {
  return state.assignments.filter((a) => a.status !== "returned");
}

export function activeAssignmentOfStone(
  state: LedgerState,
  stoneId: string
): Assignment | undefined {
  return activeAssignments(state).find((a) => a.stoneId === stoneId);
}

export function slotActiveAssignment(
  state: LedgerState,
  orderId: string,
  slotId: string
): Assignment | undefined {
  return activeAssignments(state).find(
    (a) => a.orderId === orderId && a.slotId === slotId
  );
}

export function isSlotFree(
  state: LedgerState,
  orderId: string,
  slotId: string
): boolean {
  return !slotActiveAssignment(state, orderId, slotId);
}

export function teamQueued(state: LedgerState, teamId: string): Assignment[] {
  return activeAssignments(state).filter(
    (a) => a.teamId === teamId && a.status === "queued"
  );
}

/** 同班组候补按全局发号（到达先后）排序。 */
export function teamWaitlist(
  state: LedgerState,
  teamId: string
): Assignment[] {
  return activeAssignments(state)
    .filter((a) => a.teamId === teamId && a.status === "waitlisted")
    .sort((a, b) => a.ticket - b.ticket);
}

export function pendingReceipts(state: LedgerState): Receipt[] {
  return state.receipts
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function stonePhase(state: LedgerState, stoneId: string): StonePhase {
  const mine = state.assignments.filter((a) => a.stoneId === stoneId);
  if (mine.some((a) => a.status !== "returned")) return "assigned";
  if (mine.some((a) => a.status === "returned")) return "returned";
  return "unassigned";
}

/** 合格且当前未占用石位的石头才能派工（退回后重新合格的也在此列）。 */
export function dispatchableStones(state: LedgerState): LooseStone[] {
  return state.stones.filter((s) => {
    if (s.review !== "pass") return false;
    return stonePhase(state, s.id) !== "assigned";
  });
}

export function freeSlotCount(state: LedgerState, order: Order): number {
  return order.slots.filter((slot) =>
    isSlotFree(state, order.id, slot.id)
  ).length;
}

export interface SlotRow {
  slot: Order["slots"][number];
  assignment?: Assignment;
  stone?: LooseStone;
}

export interface OrderSummary {
  order: Order;
  rows: SlotRow[];
  total: number;
  occupied: number;
  free: number;
  queued: number;
  waitlisted: number;
}

export function orderSummary(state: LedgerState, orderId: string): OrderSummary {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new Error(`订单不存在：${orderId}`);
  const rows: SlotRow[] = order.slots.map((slot) => {
    const assignment = slotActiveAssignment(state, order.id, slot.id);
    const stone = assignment
      ? state.stones.find((s) => s.id === assignment.stoneId)
      : undefined;
    return { slot, assignment, stone };
  });
  const active = activeAssignments(state).filter((a) => a.orderId === orderId);
  return {
    order,
    rows,
    total: order.slots.length,
    occupied: active.length,
    free: freeSlotCount(state, order),
    queued: active.filter((a) => a.status === "queued").length,
    waitlisted: active.filter((a) => a.status === "waitlisted").length,
  };
}

export interface TeamBoard {
  team: Team;
  queued: Assignment[];
  waitlist: Assignment[];
  capacity: number;
  full: boolean;
  insuredQueued: number;
}

export function teamBoard(state: LedgerState, teamId: string): TeamBoard {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`班组不存在：${teamId}`);
  const queued = teamQueued(state, teamId);
  const waitlist = teamWaitlist(state, teamId);
  const insuredQueued = queued.reduce((sum, a) => {
    const stone = state.stones.find((s) => s.id === a.stoneId);
    return sum + (stone?.insuredAmount ?? 0);
  }, 0);
  return {
    team,
    queued,
    waitlist,
    capacity: team.stationCapacity,
    full: queued.length >= team.stationCapacity,
    insuredQueued,
  };
}

export interface Blocker {
  team: Team;
  assignment: Assignment;
  stone?: LooseStone;
  /** 候补发号，即"排队位置"。 */
  ticket: number;
  since: string;
}

/** 班组工位放不下时，候补队首就是该班组的最早阻塞项。 */
export function earliestBlocker(
  state: LedgerState,
  teamId: string
): Blocker | undefined {
  const board = teamBoard(state, teamId);
  if (!board.full || board.waitlist.length === 0) return undefined;
  const assignment = board.waitlist[0];
  return {
    team: board.team,
    assignment,
    stone: state.stones.find((s) => s.id === assignment.stoneId),
    ticket: assignment.ticket,
    since: assignment.createdAt,
  };
}

/** 全车间最早阻塞项：所有班组候补队首中发号最早者。 */
export function globalEarliestBlocker(state: LedgerState): Blocker | undefined {
  const blockers = state.teams
    .map((t) => earliestBlocker(state, t.id))
    .filter((b): b is Blocker => Boolean(b));
  if (blockers.length === 0) return undefined;
  return blockers.reduce((min, b) => (b.ticket < min.ticket ? b : min));
}

// ---------------------------------------------------------------------------
// 派工：先占订单石位，再按班组工位容量入队 / 候补；全程幂等
// ---------------------------------------------------------------------------

export interface DispatchInput {
  stoneId: string;
  orderId: string;
  slotId: string;
  teamId: string;
  operator: string;
  /** 幂等键，由调用方为"同一次派工意图"稳定生成。 */
  idemKey: string;
}

export function findAssignmentByIdemKey(
  state: LedgerState,
  idemKey: string
): Assignment | undefined {
  return state.assignments.find((a) => a.idemKey === idemKey);
}

export function findReceiptByIdemKey(
  state: LedgerState,
  idemKey: string
): Receipt | undefined {
  return state.receipts.find((r) => r.idemKey === idemKey);
}

/**
 * 执行派工占用。
 * 注意：本函数只负责账本占用与"待确认"回执的建立，写入是否成功由存档层回报，
 * 再经 acknowledgeWrite 确认 —— 失败时占用与回执都保留，重试走 retryReceipt。
 */
export function dispatchStone(
  state0: LedgerState,
  input: DispatchInput,
  clock: Clock = defaultClock
): LedgerState {
  // 幂等：同一派工意图绝不二次占用。
  if (findAssignmentByIdemKey(state0, input.idemKey)) return state0;

  const state = clone(state0);
  const stone = state.stones.find((s) => s.id === input.stoneId);
  if (!stone) throw new Error(`裸石不存在：${input.stoneId}`);
  const order = state.orders.find((o) => o.id === input.orderId);
  if (!order) throw new Error(`订单不存在：${input.orderId}`);
  const slot = order.slots.find((sl) => sl.id === input.slotId);
  if (!slot) throw new Error(`订单 ${order.id} 没有石位 ${input.slotId}`);
  const team = state.teams.find((t) => t.id === input.teamId);
  if (!team) throw new Error(`班组不存在：${input.teamId}`);

  if (stone.review !== "pass") {
    throw new Error("该裸石复核结论不是合格，不能占用订单石位");
  }
  if (stonePhase(state, stone.id) === "assigned") {
    throw new Error("该裸石已占用石位，不能重复派工");
  }
  if (slot.requiredKind !== stone.kind) {
    throw new Error(`石种不符：${slot.label}要求${slot.requiredKind}，当前是${stone.kind}`);
  }
  if (!isSlotFree(state, order.id, slot.id)) {
    throw new Error("订单石位已被占用");
  }

  const queuedBefore = teamQueued(state, team.id).length;
  const willQueue = queuedBefore < team.stationCapacity;
  const status: AssignmentStatus = willQueue ? "queued" : "waitlisted";
  const now = clock.now();
  const ticket = willQueue ? 0 : state.nextTicket++;

  const assignment: Assignment = {
    id: clock.id("A"),
    stoneId: stone.id,
    batchId: stone.batchId,
    orderId: order.id,
    slotId: slot.id,
    teamId: team.id,
    status,
    ticket,
    operator: input.operator,
    idemKey: input.idemKey,
    createdAt: now,
  };
  state.assignments.push(assignment);

  const receipt: Receipt = {
    id: clock.id("R"),
    assignmentId: assignment.id,
    idemKey: input.idemKey,
    status: "pending",
    operator: input.operator,
    attempts: 1,
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };
  state.receipts.push(receipt);

  const queuedAfter = teamQueued(state, team.id).length;
  audit(state, clock, {
    operator: input.operator,
    action: "dispatch",
    summary: willQueue
      ? `${stone.id} 占用 ${order.id}/${slot.label}，进入${team.name}当班队列`
      : `${stone.id} 占用 ${order.id}/${slot.label}，${team.name}工位已满，按候补顺序排队（#${ticket}）`,
    batchId: stone.batchId,
    stoneId: stone.id,
    orderId: order.id,
    teamId: team.id,
    attempts: 1,
    changes: [
      { field: "裸石阶段", before: "待派工", after: STATUS_LABEL[status] },
      { field: `${order.id}/${slot.label}`, before: "空闲", after: stone.id },
      { field: `${team.name}工位占用`, before: queuedBefore, after: queuedAfter },
    ],
  });

  return state;
}

// ---------------------------------------------------------------------------
// 写入确认 / 失败回执 / 重试（重试只动回执，不再碰石位与工位）
// ---------------------------------------------------------------------------

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/** 存档层写入后回报结果。失败时保留待确认回执，占用不回滚、不丢失。 */
export function acknowledgeWrite(
  state0: LedgerState,
  idemKey: string,
  result: WriteResult,
  clock: Clock = defaultClock
): LedgerState {
  const state = clone(state0);
  const receipt = state.receipts.find((r) => r.idemKey === idemKey);
  if (!receipt) return state0;
  const assignment = state.assignments.find(
    (a) => a.id === receipt.assignmentId
  );
  receipt.updatedAt = clock.now();

  if (result.ok) {
    receipt.status = "confirmed";
    receipt.lastError = "";
    audit(state, clock, {
      operator: receipt.operator,
      action: "confirm",
      summary: `${assignment?.stoneId ?? ""} 派工写入确认成功（第 ${receipt.attempts} 次尝试）`,
      batchId: assignment?.batchId,
      stoneId: assignment?.stoneId,
      orderId: assignment?.orderId,
      teamId: assignment?.teamId,
      attempts: receipt.attempts,
    });
  } else {
    receipt.lastError = result.error ?? "未知写入错误";
    audit(state, clock, {
      operator: receipt.operator,
      action: "write-failed",
      summary: `${assignment?.stoneId ?? ""} 写入失败，保留待确认回执：${receipt.lastError}`,
      batchId: assignment?.batchId,
      stoneId: assignment?.stoneId,
      orderId: assignment?.orderId,
      teamId: assignment?.teamId,
      attempts: receipt.attempts,
      changes: [
        { field: "回执状态", before: "写入中", after: "待确认" },
        { field: "写入尝试次数", before: 1, after: 1 },
      ],
    });
  }
  return state;
}

/**
 * 重试待确认回执。无论结果如何都不会重新占用：派工记录是既成事实，
 * 这里只递增尝试次数并回报本次写入是否成功。
 */
export function retryReceipt(
  state0: LedgerState,
  receiptId: string,
  result: WriteResult,
  clock: Clock = defaultClock
): LedgerState {
  const state = clone(state0);
  const receipt = state.receipts.find((r) => r.id === receiptId);
  if (!receipt || receipt.status !== "pending") return state0;
  const assignment = state.assignments.find(
    (a) => a.id === receipt.assignmentId
  );

  const before = receipt.attempts;
  receipt.attempts += 1;
  receipt.updatedAt = clock.now();

  if (result.ok) {
    receipt.status = "confirmed";
    receipt.lastError = "";
    audit(state, clock, {
      operator: receipt.operator,
      action: "retry",
      summary: `${assignment?.stoneId ?? ""} 第 ${receipt.attempts} 次尝试写入成功；石位与工位为既有占用，未重复占用`,
      batchId: assignment?.batchId,
      stoneId: assignment?.stoneId,
      orderId: assignment?.orderId,
      teamId: assignment?.teamId,
      attempts: receipt.attempts,
      changes: [
        { field: "写入尝试次数", before, after: receipt.attempts },
        { field: "回执状态", before: "待确认", after: "已确认" },
      ],
    });
  } else {
    receipt.lastError = result.error ?? "未知写入错误";
    audit(state, clock, {
      operator: receipt.operator,
      action: "retry",
      summary: `${assignment?.stoneId ?? ""} 第 ${receipt.attempts} 次尝试仍失败，继续保留待确认回执`,
      batchId: assignment?.batchId,
      stoneId: assignment?.stoneId,
      orderId: assignment?.orderId,
      teamId: assignment?.teamId,
      attempts: receipt.attempts,
      changes: [
        { field: "写入尝试次数", before, after: receipt.attempts },
        { field: "最近错误", before: "", after: receipt.lastError },
      ],
    });
  }
  return state;
}

// ---------------------------------------------------------------------------
// 复核结论 / 保险额度变化：留痕、退回不再合格的石头、连带重算订单、候补顺延
// ---------------------------------------------------------------------------

export interface ReviewChangeInput {
  stoneId: string;
  review?: ReviewStatus;
  insuredAmount?: number;
  operator: string;
}

/** 工位空出后，各班组候补按发号顺序顺延入队；返回本次顺延的派工。 */
function sweepWaitlists(
  state: LedgerState,
  clock: Clock
): Assignment[] {
  const promoted: Assignment[] = [];
  for (const team of state.teams) {
    // 一次只可能空出一个工位，但循环写法在容量规则变化时依然成立。
    while (teamQueued(state, team.id).length < team.stationCapacity) {
      const next = teamWaitlist(state, team.id)[0];
      if (!next) break;
      const before = teamQueued(state, team.id).length;
      next.status = "queued";
      promoted.push(next);
      const after = teamQueued(state, team.id).length;
      const stone = state.stones.find((s) => s.id === next.stoneId);
      audit(state, clock, {
        operator: "系统重算",
        action: "promote",
        summary: `${stone?.id ?? next.stoneId} 候补#${next.ticket} 顺延进入${team.name}当班队列（占用${next.orderId}石位不变）`,
        batchId: next.batchId,
        stoneId: next.stoneId,
        orderId: next.orderId,
        teamId: team.id,
        changes: [
          { field: "派工状态", before: STATUS_LABEL.waitlisted, after: STATUS_LABEL.queued },
          { field: `${team.name}工位占用`, before, after },
        ],
      });
    }
  }
  return promoted;
}

export function applyReviewChange(
  state0: LedgerState,
  input: ReviewChangeInput,
  clock: Clock = defaultClock
): LedgerState {
  const state = clone(state0);
  const stone = state.stones.find((s) => s.id === input.stoneId);
  if (!stone) throw new Error(`裸石不存在：${input.stoneId}`);

  const changes: AuditEntry["changes"] = [];
  if (input.review && input.review !== stone.review) {
    changes.push({
      field: "复核结论",
      before: stone.review,
      after: input.review,
    });
  }
  if (
    typeof input.insuredAmount === "number" &&
    input.insuredAmount !== stone.insuredAmount
  ) {
    changes.push({
      field: "保险额度",
      before: stone.insuredAmount,
      after: input.insuredAmount,
    });
  }
  if (changes.length === 0) return state0;

  const active = activeAssignmentOfStone(state, stone.id);
  let affectedOrderId: string | undefined;
  let affectedTeamId: string | undefined;
  let freeBefore: number | undefined;
  let freeAfter: number | undefined;

  const becomesUnqualified =
    input.review !== undefined && input.review !== "pass" && active;

  if (active && becomesUnqualified) {
    const order = state.orders.find((o) => o.id === active.orderId)!;
    freeBefore = freeSlotCount(state, order);
    affectedOrderId = active.orderId;
    affectedTeamId = active.teamId;
    const beforeStatus = STATUS_LABEL[active.status];
    active.status = "returned";
    active.returnedAt = clock.now();
    changes.push({
      field: "派工状态",
      before: beforeStatus,
      after: STATUS_LABEL.returned,
    });
    changes.push({
      field: "所在位置",
      before: `${active.orderId}/${active.slotId}`,
      after: `原批次 ${stone.batchId}`,
    });
    freeAfter = freeSlotCount(state, order);

    // 派工在写入确认前就被退回：回执作废，不再可重试，也绝不重复占用。
    const pending = state.receipts.find(
      (r) => r.assignmentId === active.id && r.status === "pending"
    );
    if (pending) {
      pending.status = "voided";
      pending.updatedAt = clock.now();
      pending.lastError = "派工在确认前因复核变化退回，回执作废";
      changes.push({
        field: "回执状态",
        before: "待确认",
        after: "已作废",
      });
    }
  }

  // 应用新值
  if (input.review) stone.review = input.review;
  if (typeof input.insuredAmount === "number")
    stone.insuredAmount = input.insuredAmount;

  const parts: string[] = [];
  const reviewChange = changes.find((c) => c.field === "复核结论");
  if (reviewChange) parts.push(`复核结论 ${reviewChange.before}→${reviewChange.after}`);
  const amountChange = changes.find((c) => c.field === "保险额度");
  if (amountChange) parts.push(`保险额度 ¥${amountChange.before}→¥${amountChange.after}`);
  let summary = `${stone.id} ${parts.join("，")}`;
  if (becomesUnqualified) {
    summary += `；不再合格，退回原批次 ${stone.batchId} 并释放工位`;
  }

  audit(state, clock, {
    operator: input.operator,
    action: "review-change",
    summary,
    batchId: stone.batchId,
    stoneId: stone.id,
    orderId: active?.orderId,
    teamId: active?.teamId,
    changes,
  });

  // 连带重算：释放工位后候补顺延，再重算相关订单的石位占用。
  let promotions: Assignment[] = [];
  if (becomesUnqualified) {
    promotions = sweepWaitlists(state, clock);
  }

  const affectedOrderIds = Array.from(
    new Set(
      [affectedOrderId, ...promotions.map((p) => p.orderId)].filter(
        (v): v is string => Boolean(v)
      )
    )
  );
  if (affectedOrderIds.length > 0) {
    audit(state, clock, {
      operator: input.operator,
      action: "recalc",
      summary:
        affectedOrderIds.length > 0
          ? `连带重算相关订单：${affectedOrderIds.join("、")}（石位占用已重算${
              promotions.length > 0 ? `，候补顺延 ${promotions.length} 颗` : "，无候补可顺延"
            }）`
          : "连带重算相关订单",
      orderId: affectedOrderIds[0],
      changes:
        freeBefore !== undefined && freeAfter !== undefined
          ? [
              {
                field: `${affectedOrderId} 空闲石位数`,
                before: freeBefore,
                after: freeAfter,
              },
            ]
          : undefined,
    });
  }

  if (input.review === "pass" && !active) {
    const phase = stonePhase(state, stone.id);
    audit(state, clock, {
      operator: input.operator,
      action: "recalc",
      summary:
        phase === "returned"
          ? `${stone.id} 重新合格，已回到批次 ${stone.batchId}，可重新派工（不自动占用石位）`
          : `${stone.id} 合格，可派工`,
      batchId: stone.batchId,
      stoneId: stone.id,
    });
  }

  return state;
}

// ---------------------------------------------------------------------------
// 崩溃恢复：页面重载后用发件箱（outbox）里的待确认回执对齐账本
// ---------------------------------------------------------------------------

export interface PendingDispatchSnapshot {
  assignment: Assignment;
  receipt: Receipt;
}

/**
 * 把存档层发件箱中、账本里缺失的待确认派工幂等地补回去。
 * 若石位已被占用（说明主账本其实已写入、只是发件箱未清理），则跳过该过期快照。
 */
export function restorePendingDispatches(
  state0: LedgerState,
  snapshots: PendingDispatchSnapshot[],
  clock: Clock = defaultClock
): { state: LedgerState; restored: number; skipped: number } {
  let state = state0;
  let restored = 0;
  let skipped = 0;

  for (const snapshot of snapshots) {
    const { assignment, receipt } = snapshot;
    if (receipt.status === "voided") {
      skipped += 1;
      continue;
    }
    const already = findAssignmentByIdemKey(state, assignment.idemKey);
    if (already) {
      skipped += 1;
      continue;
    }
    const stone = state.stones.find((s) => s.id === assignment.stoneId);
    if (!stone || stonePhase(state, stone.id) === "assigned") {
      skipped += 1;
      continue;
    }
    if (!isSlotFree(state, assignment.orderId, assignment.slotId)) {
      skipped += 1;
      continue;
    }

    state = clone(state);
    if (assignment.status === "waitlisted") {
      state.nextTicket = Math.max(state.nextTicket, assignment.ticket + 1);
    }
    state.assignments.push(clone(assignment));
    state.receipts.push({
      ...clone(receipt),
      status: "pending",
      lastError: receipt.lastError || "页面重载，待确认回执已恢复",
      updatedAt: clock.now(),
    });
    audit(state, clock, {
      operator: receipt.operator,
      action: "restore",
      summary: `页面重载：恢复 ${assignment.stoneId} 的待确认派工（${assignment.orderId}/${assignment.slotId}），沿用既有石位占用，未重复占用`,
      batchId: assignment.batchId,
      stoneId: assignment.stoneId,
      orderId: assignment.orderId,
      teamId: assignment.teamId,
      attempts: receipt.attempts,
      changes: [
        { field: "派工记录", before: "主账本缺失", after: "已恢复" },
        { field: "回执状态", before: "未知", after: "待确认" },
      ],
    });
    restored += 1;
  }

  return { state, restored, skipped };
}

/** 用于页面展示：拿到某条派工对应的石头 / 订单 / 班组。 */
export function assignmentContext(state: LedgerState, assignment: Assignment) {
  return {
    stone: state.stones.find((s) => s.id === assignment.stoneId),
    order: state.orders.find((o) => o.id === assignment.orderId),
    team: state.teams.find((t) => t.id === assignment.teamId),
    slot: state.orders
      .find((o) => o.id === assignment.orderId)
      ?.slots.find((sl) => sl.id === assignment.slotId),
  };
}
