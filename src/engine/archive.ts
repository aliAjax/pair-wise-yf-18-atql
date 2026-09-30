// 存档层：只管持久化与"写入远端"的模拟传输，不含任何业务规则。
// 主账本与发件箱（outbox）分两个键保存：派工先在内存账本里占用，
// 写入确认前，待确认派工的快照同时放进发件箱，崩溃 / 重载后可对齐、可重试。

import type { Assignment, LedgerState, Receipt } from "../types";
import type { DispatchInput } from "./rules";

const LEDGER_KEY = "dispatch-ledger:v1";
const OUTBOX_KEY = "dispatch-outbox:v1";

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function saveLedger(state: LedgerState): void {
  writeJSON(LEDGER_KEY, state);
}

export function loadLedger(): LedgerState | null {
  return readJSON<LedgerState>(LEDGER_KEY);
}

/** 发件箱条目：待确认写入的完整重放信息。 */
export interface OutboxItem {
  idemKey: string;
  receiptId: string;
  assignmentId: string;
  operator: string;
  payload: DispatchInput;
  /** 快照用于"主账本缺失"时恢复占用，恢复仍走幂等检查。 */
  snapshot: { assignment: Assignment; receipt: Receipt };
  updatedAt: string;
}

export function loadOutbox(): OutboxItem[] {
  return readJSON<OutboxItem[]>(OUTBOX_KEY) ?? [];
}

export function saveOutbox(items: OutboxItem[]): void {
  writeJSON(OUTBOX_KEY, items);
}

export function clearArchive(): void {
  localStorage.removeItem(LEDGER_KEY);
  localStorage.removeItem(OUTBOX_KEY);
}

// ---------------------------------------------------------------------------
// 模拟"写入车间派工系统"的远端传输
// ---------------------------------------------------------------------------

export type FailureMode = "ok" | "flaky" | "offline";

export const FAILURE_MODE_LABEL: Record<FailureMode, string> = {
  ok: "链路正常",
  flaky: "首次必败（网络抖动）",
  offline: "终端离线",
};

export interface WriteAttempt {
  idemKey: string;
  /** 这是第几次尝试（1 = 首次写入，2 = 第一次重试）。 */
  attempts: number;
}

export interface Transport {
  setMode(mode: FailureMode): void;
  getMode(): FailureMode;
  write(attempt: WriteAttempt): Promise<{ ok: boolean; error?: string }>;
}

export function createTransport(initial: FailureMode = "ok"): Transport {
  let mode: FailureMode = initial;
  return {
    setMode(next) {
      mode = next;
    },
    getMode() {
      return mode;
    },
    async write({ attempts }) {
      // 模拟网络往返
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (mode === "offline") {
        return { ok: false, error: "终端离线，远端写入无响应" };
      }
      if (mode === "flaky" && attempts <= 1) {
        return { ok: false, error: "网络抖动，写入未确认" };
      }
      return { ok: true };
    },
  };
}
