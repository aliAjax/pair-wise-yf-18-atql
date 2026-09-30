// 应用状态层：把规则引擎、存档与模拟传输粘合起来。
// 规则仍全部在 engine/rules.ts，这里只负责"调规则 → 落盘 → 走传输 → 回填结果"。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LedgerState, ReviewStatus } from "../types";
import {
  acknowledgeWrite,
  applyReviewChange,
  defaultClock,
  restorePendingDispatches,
  dispatchStone,
  retryReceipt,
  type DispatchInput,
} from "./rules";
import { buildSeed } from "../seed";
import {
  clearArchive,
  createTransport,
  loadLedger,
  loadOutbox,
  saveLedger,
  saveOutbox,
  type FailureMode,
  type OutboxItem,
  type Transport,
} from "./archive";

export interface DispatchArgs {
  stoneId: string;
  orderId: string;
  slotId: string;
  teamId: string;
  operator: string;
}

export interface ReviewChangeArgs {
  stoneId: string;
  review?: ReviewStatus;
  insuredAmount?: number;
  operator: string;
}

export interface ApiError {
  message: string;
}

/**
 * @param transport 可注入；页面默认创建一个，故障模式可切换。
 */
export function useLedger(transport: Transport = createTransport("ok")) {
  const [state, setState] = useState<LedgerState>(() => buildSeed());
  const [hydrated, setHydrated] = useState(false);
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);
  // 同步的最新状态：异步写入返回前可能又发生过其他派工 / 重算，
  // 所有变更都必须基于它计算，避免用渲染期快照覆盖新状态。
  const liveRef = useRef<LedgerState>(state);
  const outboxRef = useRef<OutboxItem[]>([]);
  const inFlightRef = useRef<Set<string>>(new Set());

  const commit = useCallback((next: LedgerState) => {
    liveRef.current = next;
    setState(next);
    saveLedger(next);
  }, []);

  const syncOutbox = useCallback((next: LedgerState) => {
    const byKey = new Map(
      next.receipts
        .filter((r) => r.status === "pending")
        .map((r) => [r.idemKey, r])
    );
    // 发件箱只保留仍待确认的条目；确认 / 作废都随之移除（事实已留在主账本与审计里）。
    outboxRef.current = outboxRef.current.filter((item) => byKey.has(item.idemKey));
    saveOutbox(outboxRef.current);
  }, []);

  // 启动：读主账本；再用发件箱对齐可能丢失的待确认派工。
  useEffect(() => {
    const persisted = loadLedger();
    const outbox = loadOutbox();
    outboxRef.current = outbox;
    let next = persisted ?? buildSeed();
    if (outbox.length > 0) {
      const result = restorePendingDispatches(next, outbox.map((o) => o.snapshot));
      next = result.state;
    }
    commit(next);
    setHydrated(true);
  }, [commit]);

  const trackFlight = useCallback((key: string, active: boolean) => {
    const set = inFlightRef.current;
    if (active) set.add(key);
    else set.delete(key);
    setInFlight(new Set(set));
  }, []);

  /** 真正"写入车间派工系统"的一步：派工占用与传输解耦，失败不回滚占用。 */
  const runWrite = useCallback(
    async (
      idemKey: string,
      attempts: number,
      apply: (result: { ok: boolean; error?: string }) => LedgerState
    ) => {
      if (inFlightRef.current.has(idemKey)) return;
      trackFlight(idemKey, true);
      try {
        const result = await transport.write({ idemKey, attempts });
        const next = apply(result);
        commit(next);
        syncOutbox(next);
      } finally {
        trackFlight(idemKey, false);
      }
    },
    [commit, syncOutbox, trackFlight, transport]
  );

  const dispatch = useCallback(
    (args: DispatchArgs) => {
      setError(null);
      const idemKey = `d:${args.stoneId}:${args.orderId}:${args.slotId}:${Date.now()}`;
      let next: LedgerState;
      try {
        // 先占用：规则引擎同步建立派工记录 + attempts=1 的待确认回执。
        next = dispatchStone(liveRef.current, { ...args, idemKey });
      } catch (e) {
        setError({ message: e instanceof Error ? e.message : String(e) });
        return;
      }
      const assignment = next.assignments.find((a) => a.idemKey === idemKey)!;
      const receipt = next.receipts.find((r) => r.idemKey === idemKey)!;
      // 写入确认前进入发件箱：重载后仍可对齐、重试。
      const input: DispatchInput = { ...args, idemKey };
      outboxRef.current = [
        ...outboxRef.current,
        {
          idemKey,
          receiptId: receipt.id,
          assignmentId: assignment.id,
          operator: args.operator,
          payload: input,
          snapshot: { assignment, receipt },
          updatedAt: receipt.updatedAt,
        },
      ];
      saveOutbox(outboxRef.current);
      commit(next);

      void runWrite(idemKey, 1, (result) =>
        acknowledgeWrite(liveRef.current, idemKey, result, defaultClock)
      );
    },
    [commit, runWrite]
  );

  const retry = useCallback(
    (receiptId: string) => {
      setError(null);
      const receipt = liveRef.current.receipts.find((r) => r.id === receiptId);
      if (!receipt || receipt.status !== "pending") return;
      const attempts = receipt.attempts + 1;
      void runWrite(receipt.idemKey, attempts, (result) =>
        retryReceipt(liveRef.current, receiptId, result, defaultClock)
      );
    },
    [runWrite]
  );

  const changeReview = useCallback(
    (args: ReviewChangeArgs) => {
      setError(null);
      try {
        const next = applyReviewChange(liveRef.current, args, defaultClock);
        commit(next);
        syncOutbox(next);
      } catch (e) {
        setError({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    [commit, syncOutbox]
  );

  const setFailureMode = useCallback(
    (mode: FailureMode) => transport.setMode(mode),
    [transport]
  );

  const reset = useCallback(() => {
    clearArchive();
    outboxRef.current = [];
    inFlightRef.current.clear();
    setInFlight(new Set());
    setError(null);
    commit(buildSeed());
  }, [commit]);

  const api = useMemo(
    () => ({ dispatch, retry, changeReview, reset, setFailureMode }),
    [dispatch, retry, changeReview, reset, setFailureMode]
  );

  return { state, hydrated, inFlight, error, api, transport };
}
