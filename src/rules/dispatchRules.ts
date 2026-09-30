// 规则层：派工业务规则（纯函数，不依赖 React / 存档 / 页面）
// 规则、存档与页面分开维护 —— 本文件只表达“规则”

import type {
  LedgerAction,
  LedgerEntry,
  Order,
  Receipt,
  ReviewConclusion,
  Stone,
  StoneStatus,
  Team,
} from "./types";

export const STONE_STATUS_LABELS: Record<StoneStatus, string> = {
  in_batch: "在批次",
  position_held: "已占石位",
  in_queue: "当班队列",
  pending_confirm: "待确认",
  waitlisted: "候补中",
  returned: "已退回",
};

export const REVIEW_LABELS: Record<ReviewConclusion, string> = {
  qualified: "合格",
  pending: "待复核",
  unqualified: "不合格",
};

export const LEDGER_ACTION_LABELS: Record<LedgerAction, string> = {
  stone_added: "新增裸石",
  position_occupied: "占用石位",
  enqueued: "写入队列",
  waitlisted: "进入候补",
  write_failed: "写入失败",
  retry_succeeded: "重试成功",
  retry_failed: "重试失败",
  returned_to_batch: "退回批次",
  review_changed: "复核变更",
  insurance_changed: "保险变更",
  recalculated: "重算补位",
};

/** 占用订单石位的状态（退回批次 / 在批次不占石位） */
export const OCCUPYING_STATUSES: StoneStatus[] = [
  "position_held",
  "in_queue",
  "pending_confirm",
  "waitlisted",
];

/** 可写入当班队列的状态（已占用石位） */
export const HELD_STATUSES: StoneStatus[] = [
  "position_held",
  "in_queue",
  "pending_confirm",
  "waitlisted",
];

/**
 * 写入队列的业务门槛：
 * 复核结论合格 且 保险额度已核定（>0）才允许写入当班队列。
 * 不满足时写入失败，保留待确认回执。
 */
export function canWriteToQueue(stone: Stone): boolean {
  return stone.review === "qualified" && stone.insurance > 0;
}

/** 写入失败原因（用于回执） */
export function writeBlockedReason(stone: Stone): string {
  if (stone.review === "unqualified") return "复核结论不合格，禁止写入队列";
  if (stone.review === "pending") return "复核结论待确认，禁止写入队列";
  if (stone.insurance <= 0) return "保险额度未核定，禁止写入队列";
  return "写入队列被拒绝";
}

/** 订单已占用石位数 */
export function orderOccupiedCount(order: Order, stones: Stone[]): number {
  return stones.filter(
    (s) => s.orderId === order.id && OCCUPYING_STATUSES.includes(s.status)
  ).length;
}

/** 订单是否还有空余石位 */
export function orderHasFreePosition(order: Order, stones: Stone[]): boolean {
  return orderOccupiedCount(order, stones) < order.stonePositions;
}

/** 班组当班队列（按派工顺序） */
export function teamQueue(team: Team, stones: Stone[]): Stone[] {
  return stones
    .filter((s) => s.teamId === team.id && s.status === "in_queue")
    .sort((a, b) => a.seq - b.seq);
}

/** 班组候补队列（按候补顺序 = 派工顺序） */
export function teamWaitlist(team: Team, stones: Stone[]): Stone[] {
  return stones
    .filter((s) => s.teamId === team.id && s.status === "waitlisted")
    .sort((a, b) => a.seq - b.seq);
}

/** 班组当班队列是否已满 */
export function teamQueueFull(team: Team, stones: Stone[]): boolean {
  return teamQueue(team, stones).length >= team.workstationCapacity;
}

/**
 * 最早阻塞项：候补队列中最靠前、因工位容量不足而无法写入的石头。
 * 重算后仍放不下时，页面展示此石。
 */
export function earliestBlockingItem(team: Team, stones: Stone[]): Stone | null {
  return teamWaitlist(team, stones)[0] ?? null;
}

/** 汇总某订单下的石头（按状态） */
export function stonesOfOrder(order: Order, stones: Stone[]): Stone[] {
  return stones
    .filter((s) => s.orderId === order.id && HELD_STATUSES.includes(s.status))
    .sort((a, b) => a.seq - b.seq);
}

/** 生成账本条目（前后值、操作人、批次号、重试次数） */
export function makeLedgerEntry(input: {
  seq: number;
  timestamp: number;
  operator: string;
  batchNo: string;
  stoneId: string | null;
  orderId: string | null;
  teamId: string | null;
  action: LedgerAction;
  before: Partial<Stone> | null;
  after: Partial<Stone> | null;
  retries?: number;
  note?: string;
}): LedgerEntry {
  return {
    id: `led_${input.timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    seq: input.seq,
    timestamp: input.timestamp,
    operator: input.operator,
    batchNo: input.batchNo,
    stoneId: input.stoneId,
    orderId: input.orderId,
    teamId: input.teamId,
    action: input.action,
    before: input.before,
    after: input.after,
    retries: input.retries ?? 0,
    note: input.note ?? "",
  };
}

/** 生成待确认回执 */
export function makeReceipt(input: {
  stoneId: string;
  batchNo: string;
  orderId: string;
  teamId: string;
  retries: number;
  error: string;
  timestamp: number;
}): Receipt {
  return {
    id: `rcp_${input.timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    stoneId: input.stoneId,
    batchNo: input.batchNo,
    orderId: input.orderId,
    teamId: input.teamId,
    retries: input.retries,
    status: "pending",
    error: input.error,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}
