// 领域模型：派工账本的全部状态与枚举都集中在此处声明，
// 规则引擎、存档与页面共同引用，避免各模块各自定义造成漂移。

/** 复核结论。只有 pass（合格）的石头才能占用订单石位进入当班队列。 */
export type ReviewStatus = "pass" | "hold" | "reject";

/** 石头在账本中的阶段：尚未派工 / 已派工 / 已退回原批次。 */
export type StonePhase = "unassigned" | "assigned" | "returned";

/** 派工记录状态：当班队列 / 候补排队 / 已退回。 */
export type AssignmentStatus = "queued" | "waitlisted" | "returned";

/** 待确认回执状态：写入未确认 / 已确认 / 已作废（派工在确认前被复核变化退回）。 */
export type ReceiptStatus = "pending" | "confirmed" | "voided";

/** 裸石（分拣批次入库的每一颗石头）。 */
export interface LooseStone {
  id: string;
  batchId: string;
  kind: string;
  shape: string;
  weightCt: number;
  /** 保险额度（元），与复核结论一样可能在派工后变化，需要留痕。 */
  insuredAmount: number;
  review: ReviewStatus;
  note?: string;
}

/** 订单的一个石位（某种用途 / 位置 + 需要的石种）。 */
export interface OrderSlot {
  id: string;
  label: string;
  requiredKind: string;
}

/** 镶嵌订单：由若干石位组成。 */
export interface Order {
  id: string;
  name: string;
  slots: OrderSlot[];
}

/** 班组：有工位容量（当班最多能放几颗）。 */
export interface Team {
  id: string;
  name: string;
  stationCapacity: number;
}

/**
 * 派工记录：一次"裸石占用订单石位"的账本事实。
 * 石头进入队列或候补都先占住石位；退回时状态置为 returned，石位随之释放，记录保留备查。
 */
export interface Assignment {
  id: string;
  stoneId: string;
  batchId: string;
  orderId: string;
  slotId: string;
  teamId: string;
  status: AssignmentStatus;
  /** 候补排队用的全局发号；同班组按到达先后（发号小的在前）排序。 */
  ticket: number;
  operator: string;
  /** 幂等键：同一次派工的反复重试复用同一条派工记录，绝不重复占用。 */
  idemKey: string;
  createdAt: string;
  returnedAt?: string;
}

/**
 * 待确认回执（写入失败后保留）。
 * 与派工记录一一对应，记录写入尝试次数；重试只确认回执，不会再占石位 / 工位。
 */
export interface Receipt {
  id: string;
  assignmentId: string;
  idemKey: string;
  status: ReceiptStatus;
  operator: string;
  /** 写入尝试次数：首次写入 = 1，每重试一次 +1。 */
  attempts: number;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

/** 一条变动留痕：前后值、操作人、批次号、重试次数都在这里。 */
export interface AuditEntry {
  id: string;
  at: string;
  operator: string;
  /** dispatch | confirm | retry | review-change | promote | return | restore | boot */
  action: string;
  summary: string;
  batchId?: string;
  stoneId?: string;
  orderId?: string;
  teamId?: string;
  /** 关联回执时带的重试次数。 */
  attempts?: number;
  changes?: FieldChange[];
}

/** 单个字段的前后值留痕。 */
export interface FieldChange {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/** 派工账本的完整状态。 */
export interface LedgerState {
  stones: LooseStone[];
  orders: Order[];
  teams: Team[];
  assignments: Assignment[];
  receipts: Receipt[];
  audit: AuditEntry[];
  /** 候补全局发号器。 */
  nextTicket: number;
  seededAt: string;
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pass: "合格",
  hold: "待客户确认",
  reject: "不合格",
};

export const STATUS_LABEL: Record<AssignmentStatus, string> = {
  queued: "当班队列",
  waitlisted: "候补排队",
  returned: "已退回批次",
};

export const PHASE_LABEL: Record<StonePhase, string> = {
  unassigned: "待派工",
  assigned: "已派工",
  returned: "已退回",
};

export const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  voided: "已作废",
};
