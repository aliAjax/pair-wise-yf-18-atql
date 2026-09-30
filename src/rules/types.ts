// 规则层：派工账本的领域类型定义
// 规则、存档与页面分开维护 —— 本文件只定义类型，不含逻辑

/** 裸石状态 */
export type StoneStatus =
  | "in_batch" // 在批次（裸石，未占用订单石位）
  | "position_held" // 已占用订单石位，等待写入当班队列
  | "in_queue" // 已放入当班队列
  | "pending_confirm" // 写入失败，待确认（保留回执）
  | "waitlisted" // 班组工位容量不足，候补排队中
  | "returned"; // 复核不合格，已退回原批次

/** 复核结论 */
export type ReviewConclusion = "qualified" | "pending" | "unqualified";

/** 裸石 */
export interface Stone {
  id: string;
  /** 宝石编号 */
  stoneNo: string;
  /** 批次号 */
  batchNo: string;
  /** 种类 */
  type: string;
  /** 形状 */
  shape: string;
  /** 克拉重量 */
  carat: number;
  /** 尺寸 */
  size: string;
  /** 净度 */
  clarity: string;
  /** 颜色 */
  color: string;
  /** 切工 */
  cut: string;
  /** 镶嵌位置 */
  settingPosition: string;
  /** 缺陷备注 */
  defectNote: string;
  /** 复核结论 */
  review: ReviewConclusion;
  /** 保险额度（0 表示未核定） */
  insurance: number;
  status: StoneStatus;
  /** 占用的订单 id */
  orderId: string | null;
  /** 写入的班组 id */
  teamId: string | null;
  /** 派工顺序（候补按此排序） */
  seq: number;
  /** 重试次数 */
  retries: number;
  /** 最近操作人 */
  operator: string;
  updatedAt: number;
}

/** 订单（石位） */
export interface Order {
  id: string;
  orderNo: string;
  customer: string;
  /** 订单石位总数 */
  stonePositions: number;
}

/** 班组（工位容量） */
export interface Team {
  id: string;
  name: string;
  /** 当班工位容量 */
  workstationCapacity: number;
}

/** 待确认回执：写入失败后保留，重试不得重复占用石位 */
export interface Receipt {
  id: string;
  stoneId: string;
  batchNo: string;
  orderId: string;
  teamId: string;
  /** 重试次数 */
  retries: number;
  status: "pending";
  /** 失败原因 */
  error: string;
  createdAt: number;
  updatedAt: number;
}

/** 账本动作 */
export type LedgerAction =
  | "stone_added" // 新增裸石
  | "position_occupied" // 占用订单石位
  | "enqueued" // 放入当班队列
  | "waitlisted" // 进入候补
  | "write_failed" // 写入失败（保留回执）
  | "retry_succeeded" // 重试写入成功
  | "retry_failed" // 重试仍失败
  | "returned_to_batch" // 退回原批次
  | "review_changed" // 复核结论变更
  | "insurance_changed" // 保险额度变更
  | "recalculated"; // 重算补位

/** 账本条目：每次变动保留前后值、操作人、批次号和重试次数 */
export interface LedgerEntry {
  id: string;
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
  retries: number;
  note: string;
}

/** 派工写入结果 */
export interface WriteResult {
  ok: boolean;
  /** 写入后的石头 */
  stone: Stone;
  /** 失败时保留的待确认回执 */
  receipt: Receipt | null;
  /** 失败/说明原因 */
  reason: string | null;
}

export interface AppState {
  stones: Stone[];
  orders: Order[];
  teams: Team[];
  receipts: Receipt[];
  ledger: LedgerEntry[];
  /** 全局派工顺序号 */
  seq: number;
  /** 账本顺序号 */
  ledgerSeq: number;
}
