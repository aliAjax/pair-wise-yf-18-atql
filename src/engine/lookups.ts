// 页面层的查询辅助：把常用的"按 id 取名称 / 取回执"集中起来。
import type { LedgerState, Order, Receipt, Team } from "../types";

export function buildLookups(state: LedgerState) {
  const orders = new Map<string, Order>(state.orders.map((o) => [o.id, o]));
  const teams = new Map<string, Team>(state.teams.map((t) => [t.id, t]));
  const stones = new Map(state.stones.map((s) => [s.id, s]));
  const receiptsByAssignment = new Map<string, Receipt>(
    state.receipts.map((r) => [r.assignmentId, r])
  );

  return {
    order(id: string) {
      return orders.get(id);
    },
    team(id: string) {
      return teams.get(id);
    },
    stone(id: string) {
      return stones.get(id);
    },
    slotLabel(orderId: string, slotId: string): string {
      const slot = orders.get(orderId)?.slots.find((s) => s.id === slotId);
      return slot ? slot.label : slotId;
    },
    receiptOf(assignmentId: string): Receipt | undefined {
      return receiptsByAssignment.get(assignmentId);
    },
  };
}
