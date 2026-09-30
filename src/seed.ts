// 初始数据：演示车间的裸石批次、订单石位、班组容量。
// 通过规则引擎派工来生成，保证队列 / 候补 / 回执与容量规则始终一致。

import type { Clock } from "./engine/rules";
import { acknowledgeWrite, dispatchStone } from "./engine/rules";
import type { LedgerState, Order, Team, LooseStone } from "./types";

/** 确定性时钟：种子数据时间与 ID 稳定，不会每次刷新都变。 */
class SeedClock implements Clock {
  private seq = 0;
  private base = Date.parse("2026-09-30T08:00:00+08:00");
  now(): string {
    return new Date(this.base + this.seq * 60_000).toISOString();
  }
  id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-SEED-${this.seq}`;
  }
}

const teams: Team[] = [
  { id: "T-A", name: "甲班·主镶组", stationCapacity: 3 },
  { id: "T-B", name: "乙班·微镶组", stationCapacity: 2 },
  { id: "T-C", name: "丙班·蜡镶组", stationCapacity: 2 },
];

const orders: Order[] = [
  {
    id: "ORD-1001",
    name: "星河吊坠",
    slots: [
      { id: "s1", label: "主石位", requiredKind: "蓝宝石" },
      { id: "s2", label: "围石A组", requiredKind: "钻石" },
      { id: "s3", label: "围石B组", requiredKind: "钻石" },
      { id: "s4", label: "配石位", requiredKind: "祖母绿" },
    ],
  },
  {
    id: "ORD-1002",
    name: "红丝绒戒指",
    slots: [
      { id: "s1", label: "主石位", requiredKind: "红宝石" },
      { id: "s2", label: "围石", requiredKind: "钻石" },
    ],
  },
  {
    id: "ORD-1003",
    name: "翠影胸针",
    slots: [
      { id: "s1", label: "主石位", requiredKind: "祖母绿" },
      { id: "s2", label: "配石位", requiredKind: "蓝宝石" },
    ],
  },
];

const stones: LooseStone[] = [
  // B2409-A 蓝宝石批
  { id: "ST-2048", batchId: "B2409-A", kind: "蓝宝石", shape: "椭圆 6×4mm", weightCt: 1.2, insuredAmount: 8600, review: "pass" },
  { id: "ST-2052", batchId: "B2409-A", kind: "蓝宝石", shape: "圆形 3mm", weightCt: 0.18, insuredAmount: 1200, review: "pass" },
  { id: "ST-2063", batchId: "B2409-A", kind: "蓝宝石", shape: "梨形 6×4mm", weightCt: 0.95, insuredAmount: 5400, review: "hold", note: "色带偏重，待客户确认" },
  // B2409-B 钻石批
  { id: "ST-2061", batchId: "B2409-B", kind: "钻石", shape: "圆形 0.08ct", weightCt: 0.08, insuredAmount: 2600, review: "pass" },
  { id: "ST-2068", batchId: "B2409-B", kind: "钻石", shape: "圆形 0.07ct", weightCt: 0.07, insuredAmount: 2200, review: "pass" },
  { id: "ST-2072", batchId: "B2409-B", kind: "钻石", shape: "圆形 0.09ct", weightCt: 0.09, insuredAmount: 3100, review: "pass" },
  { id: "ST-2077", batchId: "B2409-B", kind: "钻石", shape: "圆形 0.06ct", weightCt: 0.06, insuredAmount: 1900, review: "reject", note: "腰棱崩口" },
  // B2409-C 彩宝批
  { id: "ST-2099", batchId: "B2409-C", kind: "祖母绿", shape: "祖母绿切 6×4mm", weightCt: 0.62, insuredAmount: 15000, review: "hold", note: "内含物明显，需客户确认" },
  { id: "ST-2104", batchId: "B2409-C", kind: "祖母绿", shape: "祖母绿切 5×3mm", weightCt: 0.41, insuredAmount: 9800, review: "pass" },
  { id: "ST-2110", batchId: "B2409-C", kind: "红宝石", shape: "椭圆 5×4mm", weightCt: 1.05, insuredAmount: 22000, review: "pass" },
  { id: "ST-2115", batchId: "B2409-C", kind: "红宝石", shape: "圆形 4mm", weightCt: 0.8, insuredAmount: 16000, review: "reject", note: "台面裂隙" },
];

export function buildSeed(): LedgerState {
  const clock = new SeedClock();
  let state: LedgerState = {
    stones,
    orders,
    teams,
    assignments: [],
    receipts: [],
    audit: [],
    // 候补号从 #1 开始，更直观
    nextTicket: 1,
    seededAt: clock.now(),
  };

  const dispatch = (
    stoneId: string,
    orderId: string,
    slotId: string,
    teamId: string,
    write: { ok: boolean; error?: string } = { ok: true }
  ) => {
    const idemKey = `seed:${stoneId}:${orderId}:${slotId}`;
    state = dispatchStone(
      state,
      { stoneId, orderId, slotId, teamId, operator: "王玫（排石员）", idemKey },
      clock
    );
    state = acknowledgeWrite(state, idemKey, write, clock);
  };

  // 甲班容量 3：三颗正好占满当班
  dispatch("ST-2048", "ORD-1001", "s1", "T-A");
  dispatch("ST-2104", "ORD-1003", "s1", "T-A");
  dispatch("ST-2110", "ORD-1002", "s1", "T-A");
  // 乙班容量 2：两颗当班，第三颗写入时工位已满 → 候补 #1（最早阻塞项）
  dispatch("ST-2061", "ORD-1001", "s2", "T-B");
  dispatch("ST-2068", "ORD-1001", "s3", "T-B");
  dispatch("ST-2072", "ORD-1002", "s2", "T-B", {
    ok: false,
    error: "工位终端离线，写入未确认",
  });
  // 丙班容量 2：一颗当班
  dispatch("ST-2052", "ORD-1003", "s2", "T-C");

  return state;
}
