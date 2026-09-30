// 存档层：派工账本状态管理（React Hook + localStorage 持久化）
// 规则、存档与页面分开维护 —— 本文件负责“存档”，规则调用 rules/，页面调用本文件

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppState,
  LedgerEntry,
  Order,
  Receipt,
  ReviewConclusion,
  Stone,
  Team,
  WriteResult,
} from "../rules/types";
import {
  canWriteToQueue,
  makeLedgerEntry,
  makeReceipt,
  orderHasFreePosition,
  teamQueue,
  teamQueueFull,
  teamWaitlist,
  writeBlockedReason,
} from "../rules/dispatchRules";
import { buildSeedState } from "./seed";

const STORAGE_KEY = "hxyfront-62006-ledger-v1";
const OPERATOR_STORAGE_KEY = "hxyfront-62006-operator";

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.stones) && Array.isArray(parsed.ledger)) {
        return parsed;
      }
    }
  } catch {
    // 存档损坏时回退到演示数据
  }
  return buildSeedState();
}

function nowTs() {
  return Date.now();
}

/** 账本条目（带自增 seq） */
function pushLedger(
  state: AppState,
  input: Omit<Parameters<typeof makeLedgerEntry>[0], "seq" | "timestamp"> & {
    timestamp?: number;
  }
): { state: AppState; entry: LedgerEntry } {
  const timestamp = input.timestamp ?? nowTs();
  const entry = makeLedgerEntry({
    ...input,
    seq: state.ledgerSeq + 1,
    timestamp,
  });
  return {
    state: { ...state, ledger: [...state.ledger, entry], ledgerSeq: state.ledgerSeq + 1 },
    entry,
  };
}

/**
 * 尝试写入当班队列（写入失败 → 待确认回执；容量不足 → 候补）。
 * 纯函数：返回新状态、更新后的石头、回执与账本条目。
 */
function attemptWrite(
  state: AppState,
  stone: Stone,
  team: Team,
  operator: string,
  timestamp: number
): { state: AppState; stone: Stone; receipt: Receipt | null; entries: LedgerEntry[] } {
  const entries: LedgerEntry[] = [];
  let next = state;
  let updated: Stone = { ...stone, teamId: team.id, updatedAt: timestamp };

  const flush = (s: AppState, e: Parameters<typeof pushLedger>[1]) => {
    const r = pushLedger(s, e);
    next = r.state;
    entries.push(r.entry);
  };

  if (!canWriteToQueue(updated)) {
    // 写入失败 → 保留待确认回执（不重复占用石位）
    updated = { ...updated, status: "pending_confirm" };
    const receipt = makeReceipt({
      stoneId: updated.id,
      batchNo: updated.batchNo,
      orderId: updated.orderId!,
      teamId: team.id,
      retries: updated.retries,
      error: writeBlockedReason(updated),
      timestamp,
    });
    next = { ...next, receipts: [...next.receipts, receipt] };
    flush(next, {
      operator,
      batchNo: updated.batchNo,
      stoneId: updated.id,
      orderId: updated.orderId,
      teamId: team.id,
      action: "write_failed",
      before: { status: stone.status, review: stone.review, insurance: stone.insurance },
      after: { status: "pending_confirm", review: updated.review, insurance: updated.insurance },
      retries: updated.retries,
      note: `${receipt.error}，保留待确认回执`,
    });
    return { state: next, stone: updated, receipt, entries };
  }

  if (teamQueueFull(team, next.stones)) {
    // 工位容量不足 → 按候补顺序排队
    updated = { ...updated, status: "waitlisted" };
    flush(next, {
      operator,
      batchNo: updated.batchNo,
      stoneId: updated.id,
      orderId: updated.orderId,
      teamId: team.id,
      action: "waitlisted",
      before: { status: stone.status },
      after: { status: "waitlisted", teamId: team.id },
      retries: updated.retries,
      note: `${team.name}工位容量不足，按候补顺序排队`,
    });
    return { state: next, stone: updated, receipt: null, entries };
  }

  // 写入当班队列
  updated = { ...updated, status: "in_queue" };
  flush(next, {
    operator,
    batchNo: updated.batchNo,
    stoneId: updated.id,
    orderId: updated.orderId,
    teamId: team.id,
    action: "enqueued",
    before: { status: stone.status },
    after: { status: "in_queue", teamId: team.id },
    retries: updated.retries,
    note: `写入${team.name}当班队列`,
  });
  return { state: next, stone: updated, receipt: null, entries };
}

/** 重算补位：候补队列按顺序补入当班队列（返回新状态与条目） */
function rebalanceTeam(
  state: AppState,
  team: Team,
  operator: string,
  timestamp: number,
  entries: LedgerEntry[]
): AppState {
  let next = state;
  const queue = () => teamQueue(team, next.stones);
  const waitlist = () => teamWaitlist(team, next.stones);

  while (queue().length < team.workstationCapacity && waitlist().length > 0) {
    const head = waitlist()[0];
    if (!canWriteToQueue(head)) break; // 首位候补不合格，即为阻塞项
    const moved: Stone = { ...head, status: "in_queue", updatedAt: timestamp };
    next = {
      ...next,
      stones: next.stones.map((s) => (s.id === head.id ? moved : s)),
    };
    const r = pushLedger(next, {
      operator,
      batchNo: moved.batchNo,
      stoneId: moved.id,
      orderId: moved.orderId,
      teamId: team.id,
      action: "recalculated",
      before: { status: head.status, teamId: head.teamId },
      after: { status: "in_queue", teamId: team.id },
      retries: moved.retries,
      note: "重算补位：候补 → 当班队列",
    });
    next = r.state;
    entries.push(r.entry);
  }
  return next;
}

/** 重算所有班组（补位） */
function rebalanceAll(
  state: AppState,
  operator: string,
  timestamp: number,
  entries: LedgerEntry[]
): AppState {
  let next = state;
  for (const team of next.teams) {
    next = rebalanceTeam(next, team, operator, timestamp, entries);
  }
  return next;
}

/** 重算待确认回执：若石头已满足写入门槛，则尝试写入（不增加重试次数） */
function resolveReceipts(
  state: AppState,
  operator: string,
  timestamp: number,
  entries: LedgerEntry[]
): AppState {
  let next = state;
  for (const receipt of [...next.receipts]) {
    const stone = next.stones.find((s) => s.id === receipt.stoneId);
    const team = next.teams.find((t) => t.id === receipt.teamId);
    if (!stone || !team) continue;
    if (!canWriteToQueue(stone)) continue;
    // 已满足门槛 → 尝试写入（重试次数不变，属重算补位）
    const result = attemptWrite(next, stone, team, operator, timestamp);
    entries.push(...result.entries);
    next = result.state;
    next = {
      ...next,
      receipts: next.receipts.filter((r) => r.id !== receipt.id),
      stones: next.stones.map((s) => (s.id === stone.id ? result.stone : s)),
    };
    const r = pushLedger(next, {
      operator,
      batchNo: stone.batchNo,
      stoneId: stone.id,
      orderId: stone.orderId,
      teamId: team.id,
      action: "recalculated",
      before: { status: "pending_confirm" },
      after: { status: result.stone.status, teamId: team.id },
      retries: stone.retries,
      note: "复核/保险核定后重算，待确认回执已解决",
    });
    next = r.state;
    entries.push(r.entry);
  }
  return next;
}

export interface NewStoneInput {
  stoneNo: string;
  batchNo: string;
  type: string;
  shape: string;
  carat: number;
  size: string;
  clarity: string;
  color: string;
  cut: string;
  settingPosition: string;
  defectNote: string;
  review: ReviewConclusion;
  insurance: number;
}

export function useLedgerStore() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [operator, setOperator] = useState<string>(() => {
    try {
      return localStorage.getItem(OPERATOR_STORAGE_KEY) || "王师傅";
    } catch {
      return "王师傅";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 持久化失败时忽略
    }
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(OPERATOR_STORAGE_KEY, operator);
    } catch {
      // ignore
    }
  }, [operator]);

  /** 新增裸石 */
  const addStone = useCallback(
    (input: NewStoneInput) => {
      setState((prev) => {
        const timestamp = nowTs();
        const stone: Stone = {
          id: `st_${timestamp.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          stoneNo: input.stoneNo,
          batchNo: input.batchNo,
          type: input.type,
          shape: input.shape,
          carat: input.carat,
          size: input.size,
          clarity: input.clarity,
          color: input.color,
          cut: input.cut,
          settingPosition: input.settingPosition,
          defectNote: input.defectNote,
          review: input.review,
          insurance: input.insurance,
          status: "in_batch",
          orderId: null,
          teamId: null,
          seq: 0,
          retries: 0,
          operator,
          updatedAt: timestamp,
        };
        let next: AppState = { ...prev, stones: [...prev.stones, stone] };
        const r = pushLedger(next, {
          operator,
          batchNo: stone.batchNo,
          stoneId: stone.id,
          orderId: null,
          teamId: null,
          action: "stone_added",
          before: null,
          after: { stoneNo: stone.stoneNo, batchNo: stone.batchNo, status: "in_batch" },
          note: `新增裸石 ${stone.stoneNo}，批次 ${stone.batchNo}`,
        });
        next = r.state;
        return next;
      });
    },
    [operator]
  );

  /**
   * 派工：每颗裸石先占用订单石位，再按班组工位容量放入当班队列。
   * 写入失败 → 保留待确认回执。
   */
  const dispatchStone = useCallback(
    (stoneId: string, orderId: string, teamId: string): WriteResult => {
      let result: WriteResult = { ok: true, stone: null as unknown as Stone, receipt: null, reason: null };
      setState((prev) => {
        const timestamp = nowTs();
        const stone = prev.stones.find((s) => s.id === stoneId);
        const order = prev.orders.find((o) => o.id === orderId);
        const team = prev.teams.find((t) => t.id === teamId);
        if (!stone || !order || !team) {
          result = { ok: false, stone: stone ?? (null as unknown as Stone), receipt: null, reason: "未找到石头、订单或班组" };
          return prev;
        }

        let next = prev;
        const entries: LedgerEntry[] = [];
        let updated: Stone = { ...stone };

        // 1. 先占用订单石位（已占用则不重复占用）
        if (stone.status === "in_batch" || stone.status === "returned") {
          if (!orderHasFreePosition(order, next.stones)) {
            result = { ok: false, stone, receipt: null, reason: `订单 ${order.orderNo} 石位已满，无法占用` };
            return prev;
          }
          updated = {
            ...updated,
            status: "position_held",
            orderId: order.id,
            teamId: null,
            seq: next.seq + 1,
            operator,
            updatedAt: timestamp,
          };
          next = {
            ...next,
            stones: next.stones.map((s) => (s.id === stone.id ? updated : s)),
            seq: next.seq + 1,
          };
          const r = pushLedger(next, {
            operator,
            batchNo: updated.batchNo,
            stoneId: updated.id,
            orderId: order.id,
            teamId: null,
            action: "position_occupied",
            before: { status: stone.status, orderId: stone.orderId },
            after: { status: "position_held", orderId: order.id },
            note: `占用订单 ${order.orderNo} 石位`,
          });
          next = r.state;
          entries.push(r.entry);
        } else if (stone.orderId !== orderId) {
          result = { ok: false, stone, receipt: null, reason: `石头已占用订单 ${stone.orderId} 的石位，不能重复占用` };
          return prev;
        }

        // 2. 再按班组工位容量写入当班队列
        const write = attemptWrite(next, updated, team, operator, timestamp);
        entries.push(...write.entries);
        next = write.state;
        next = {
          ...next,
          stones: next.stones.map((s) => (s.id === updated.id ? write.stone : s)),
        };

        result = {
          ok: !write.receipt,
          stone: write.stone,
          receipt: write.receipt,
          reason: write.receipt ? write.receipt.error : null,
        };
        return next;
      });
      return result;
    },
    [operator]
  );

  /**
   * 重试待确认回执：不得重复占用石位，只重新写入队列。
   * 每次重试保留重试次数。
   */
  const retryReceipt = useCallback(
    (receiptId: string): WriteResult => {
      let result: WriteResult = { ok: true, stone: null as unknown as Stone, receipt: null, reason: null };
      setState((prev) => {
        const timestamp = nowTs();
        const receipt = prev.receipts.find((r) => r.id === receiptId);
        if (!receipt) {
          result = { ok: false, stone: null as unknown as Stone, receipt: null, reason: "回执不存在" };
          return prev;
        }
        const stone = prev.stones.find((s) => s.id === receipt.stoneId);
        const team = prev.teams.find((t) => t.id === receipt.teamId);
        if (!stone || !team) {
          result = { ok: false, stone: stone ?? (null as unknown as Stone), receipt: null, reason: "未找到石头或班组" };
          return prev;
        }

        const retries = receipt.retries + 1;
        const entries: LedgerEntry[] = [];
        let next = prev;

        // 石位已占用 —— 重试不得重复占用
        const held: Stone = { ...stone, retries, operator, updatedAt: timestamp };

        if (!canWriteToQueue(held)) {
          // 重试仍失败：保留回执，重试次数 +1
          const failedReceipt: Receipt = {
            ...receipt,
            retries,
            error: writeBlockedReason(held),
            updatedAt: timestamp,
          };
          next = {
            ...next,
            stones: next.stones.map((s) => (s.id === stone.id ? held : s)),
            receipts: next.receipts.map((r) => (r.id === receipt.id ? failedReceipt : r)),
          };
          const r = pushLedger(next, {
            operator,
            batchNo: stone.batchNo,
            stoneId: stone.id,
            orderId: stone.orderId,
            teamId: team.id,
            action: "retry_failed",
            before: { status: stone.status, review: stone.review, insurance: stone.insurance },
            after: { status: "pending_confirm", review: held.review, insurance: held.insurance },
            retries,
            note: `第 ${retries} 次重试仍失败（未重复占用石位）：${failedReceipt.error}`,
          });
          next = r.state;
          entries.push(r.entry);
          result = { ok: false, stone: held, receipt: failedReceipt, reason: failedReceipt.error };
          return next;
        }

        // 重试写入（不重复占用石位）
        const write = attemptWrite(next, held, team, operator, timestamp);
        entries.push(...write.entries);
        next = write.state;
        next = {
          ...next,
          stones: next.stones.map((s) => (s.id === stone.id ? write.stone : s)),
          receipts: next.receipts.filter((r) => r.id !== receipt.id),
        };
        const r = pushLedger(next, {
          operator,
          batchNo: stone.batchNo,
          stoneId: stone.id,
          orderId: stone.orderId,
          teamId: team.id,
          action: "retry_succeeded",
          before: { status: stone.status },
          after: { status: write.stone.status, teamId: team.id },
          retries,
          note: `第 ${retries} 次重试写入成功（未重复占用石位）`,
        });
        next = r.state;
        entries.push(r.entry);
        result = { ok: true, stone: write.stone, receipt: null, reason: null };
        return next;
      });
      return result;
    },
    [operator]
  );

  /**
   * 复核结论变更：连带重算相关订单。
   * 不合格 → 退回原批次；合格/待复核变化 → 重算补位、解决待确认回执。
   */
  const changeReview = useCallback(
    (stoneId: string, review: ReviewConclusion) => {
      setState((prev) => {
        const timestamp = nowTs();
        const stone = prev.stones.find((s) => s.id === stoneId);
        if (!stone) return prev;
        const entries: LedgerEntry[] = [];
        let next = prev;

        const changed: Stone = { ...stone, review, operator, updatedAt: timestamp };
        next = {
          ...next,
          stones: next.stones.map((s) => (s.id === stoneId ? changed : s)),
        };
        const r1 = pushLedger(next, {
          operator,
          batchNo: stone.batchNo,
          stoneId: stone.id,
          orderId: stone.orderId,
          teamId: stone.teamId,
          action: "review_changed",
          before: { review: stone.review },
          after: { review },
          retries: stone.retries,
          note: `复核结论 ${stone.review === "qualified" ? "合格" : stone.review === "pending" ? "待复核" : "不合格"} → ${review === "qualified" ? "合格" : review === "pending" ? "待复核" : "不合格"}`,
        });
        next = r1.state;
        entries.push(r1.entry);

        if (review === "unqualified") {
          // 不再合格 → 退回原批次，释放石位
          const returned: Stone = {
            ...changed,
            status: "returned",
            orderId: null,
            teamId: null,
            updatedAt: timestamp,
          };
          next = {
            ...next,
            stones: next.stones.map((s) => (s.id === stoneId ? returned : s)),
            // 关联的待确认回执一并撤销
            receipts: next.receipts.filter((r) => r.stoneId !== stoneId),
          };
          const r2 = pushLedger(next, {
            operator,
            batchNo: stone.batchNo,
            stoneId: stone.id,
            orderId: null,
            teamId: null,
            action: "returned_to_batch",
            before: { status: stone.status, teamId: stone.teamId, orderId: stone.orderId },
            after: { status: "returned", teamId: null, orderId: null },
            retries: stone.retries,
            note: `复核不合格，退回原批次 ${stone.batchNo}`,
          });
          next = r2.state;
          entries.push(r2.entry);
        }

        // 连带重算：解决待确认回执 + 候补补位
        next = resolveReceipts(next, operator, timestamp, entries);
        next = rebalanceAll(next, operator, timestamp, entries);
        return next;
      });
    },
    [operator]
  );

  /** 保险额度变更：记录前后值；若已满足写入门槛则重算解决待确认回执 */
  const changeInsurance = useCallback(
    (stoneId: string, insurance: number) => {
      setState((prev) => {
        const timestamp = nowTs();
        const stone = prev.stones.find((s) => s.id === stoneId);
        if (!stone) return prev;
        const entries: LedgerEntry[] = [];
        let next = prev;

        const changed: Stone = { ...stone, insurance, operator, updatedAt: timestamp };
        next = {
          ...next,
          stones: next.stones.map((s) => (s.id === stoneId ? changed : s)),
        };
        const r = pushLedger(next, {
          operator,
          batchNo: stone.batchNo,
          stoneId: stone.id,
          orderId: stone.orderId,
          teamId: stone.teamId,
          action: "insurance_changed",
          before: { insurance: stone.insurance },
          after: { insurance },
          retries: stone.retries,
          note: `保险额度 ${stone.insurance} → ${insurance}`,
        });
        next = r.state;
        entries.push(r.entry);

        next = resolveReceipts(next, operator, timestamp, entries);
        next = rebalanceAll(next, operator, timestamp, entries);
        return next;
      });
    },
    [operator]
  );

  /** 手动重算某订单相关班组（候补补位，显示最早阻塞项） */
  const recalcOrder = useCallback(
    (orderId: string) => {
      setState((prev) => {
        const timestamp = nowTs();
        const entries: LedgerEntry[] = [];
        let next = prev;
        next = resolveReceipts(next, operator, timestamp, entries);
        // 只重算与该订单石头相关的班组
        const teamIds = new Set(
          next.stones
            .filter((s) => s.orderId === orderId && s.teamId)
            .map((s) => s.teamId as string)
        );
        for (const team of next.teams) {
          if (teamIds.has(team.id)) {
            next = rebalanceTeam(next, team, operator, timestamp, entries);
          }
        }
        return next;
      });
    },
    [operator]
  );

  /** 重置为演示数据 */
  const reset = useCallback(() => {
    setState(buildSeedState());
  }, []);

  return {
    state,
    operator,
    setOperator,
    addStone,
    dispatchStone,
    retryReceipt,
    changeReview,
    changeInsurance,
    recalcOrder,
    reset,
  };
}

export type LedgerStore = ReturnType<typeof useLedgerStore>;

/** 选择器：某订单的石位占用情况 */
export function useOrderBoard(state: AppState, order: Order) {
  return useMemo(() => {
    const stones = state.stones
      .filter((s) => s.orderId === order.id && s.status !== "returned")
      .sort((a, b) => a.seq - b.seq);
    const occupied = stones.length;
    return { stones, occupied, total: order.stonePositions, free: order.stonePositions - occupied };
  }, [state, order]);
}

/** 选择器：某班组的当班队列与候补 */
export function useTeamBoard(state: AppState, team: Team) {
  return useMemo(() => {
    const queue = teamQueue(team, state.stones);
    const waitlist = teamWaitlist(team, state.stones);
    const blocking = waitlist[0] ?? null;
    return {
      queue,
      waitlist,
      blocking,
      capacity: team.workstationCapacity,
      queueFull: queue.length >= team.workstationCapacity,
    };
  }, [state, team]);
}
