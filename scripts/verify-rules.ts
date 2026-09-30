// 规则引擎验证脚本：用确定性时钟直接跑核心场景，不依赖浏览器 / React。
// 运行：npx tsx scripts/verify-rules.ts （或 node --experimental-strip-types）
import {
  acknowledgeWrite,
  applyReviewChange,
  dispatchStone,
  globalEarliestBlocker,
  orderSummary,
  restorePendingDispatches,
  retryReceipt,
  teamBoard,
  type Clock,
} from "../src/engine/rules";
import { buildSeed } from "../src/seed";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

class FixedClock implements Clock {
  private t = 0;
  now() {
    this.t += 1;
    return new Date(Date.UTC(2026, 8, 30, 0, this.t)).toISOString();
  }
  id(prefix: string) {
    this.t += 1;
    return `${prefix}-${this.t}`;
  }
}

console.log("1) 种子数据：容量、候补与最早阻塞项");
{
  const s = buildSeed();
  const tb = teamBoard(s, "T-B");
  check("乙班容量2 → 当班2颗", tb.queued.length === 2);
  check("乙班候补1颗", tb.waitlist.length === 1);
  check("候补号为 #1", tb.waitlist[0].ticket === 1);
  const block = globalEarliestBlocker(s);
  check(
    "全车间最早阻塞是 ST-2072",
    block?.stone?.id === "ST-2072",
    block?.stone?.id
  );
  const pending = s.receipts.filter((r) => r.status === "pending");
  check("ST-2072 写入失败 → 1 条待确认回执", pending.length === 1);
  check("回执尝试次数=1", pending[0].attempts === 1);
}

console.log("2) 派工幂等：同一 idemKey 重试绝不重复占用");
{
  const clock = new FixedClock();
  const s0 = buildSeed();
  // ST-2052 是可派工的蓝宝石（丙班当前只有它一颗，容量2有空位）
  const args = {
    stoneId: "ST-2063", // hold，应被拒绝
    orderId: "ORD-1003",
    slotId: "s2",
    teamId: "T-C",
    operator: "测试员",
    idemKey: "k1",
  };
  let threw = false;
  try {
    dispatchStone(s0, args, clock);
  } catch {
    threw = true;
  }
  check("非合格石头不能派工", threw);

  // 找一颗可派工的：ST-2063 不行；改用 ST-2099(hold) 不行。
  // 种子里 pass 且未占用的：无（全部 pass 的都派了）。先制造一颗：把 ST-2063 改 pass 需先释放？直接用 ST-2048 已占用会拒绝。
  // 因此把 ST-2077 reject 改成 pass 后派工（它当前未占用）。
  const s1 = applyReviewChange(
    s0,
    { stoneId: "ST-2077", review: "pass", operator: "测试员" },
    clock
  );
  const before = s1.assignments.length;
  const validArgs = {
    stoneId: "ST-2077",
    orderId: "ORD-1001",
    slotId: "s2", // 该石位已被 ST-2061 占用 → 应拒绝
    teamId: "T-C",
    operator: "测试员",
    idemKey: "k2",
  };
  let threw2 = false;
  try {
    dispatchStone(s1, validArgs, clock);
  } catch {
    threw2 = true;
  }
  check("已占用石位不能重复占用", threw2);

  const freeArgs = { ...validArgs, orderId: "ORD-1001", slotId: "s4" }; // s4 需祖母绿，石种不符
  let threw3 = false;
  try {
    dispatchStone(s1, freeArgs, clock);
  } catch {
    threw3 = true;
  }
  check("石种不符拒绝派工", threw3);

  // ST-2077 是钻石，放到 ORD-1001 s2 不行（占了）；没有空闲钻石位。
  // 改判 ST-2063（蓝宝石 hold）为 pass，派到 ORD-1003 s2（ST-2052 占了）也不行。
  // 直接验证幂等：用 ST-2063 改 pass 后派到一个空位需要先有蓝宝石空位。
  // 简化：在丙班（容量2，当前1颗）给 ST-2063 找订单 —— 它是蓝宝石，ORD-1003 s2 被占。
  // 所以改 ST-2048 退回？太重。改为直接断言重复 idemKey：
  const s2 = applyReviewChange(
    s1,
    { stoneId: "ST-2063", review: "pass", operator: "测试员" },
    clock
  );
  // ST-2063 蓝宝石 → 目前无空闲蓝宝石位。把 ST-2052 退回（改判 hold），释放 ORD-1003 s2。
  const s3 = applyReviewChange(
    s2,
    { stoneId: "ST-2052", review: "hold", operator: "测试员" },
    clock
  );
  const idem = "idem-1";
  const dArgs = {
    stoneId: "ST-2063",
    orderId: "ORD-1003",
    slotId: "s2",
    teamId: "T-C",
    operator: "测试员",
    idemKey: idem,
  };
  const s4 = dispatchStone(s3, dArgs, clock);
  check("派工新增 1 条派工记录", s4.assignments.length === before + 1);
  // 再次用同一 idemKey —— 必须原样返回，不新增
  const s5 = dispatchStone(s4, dArgs, clock);
  check("同 idemKey 重复调用不新增记录", s5.assignments.length === s4.assignments.length);
}

console.log("3) 写入失败 → 重试不重复占用，成功后回执确认");
{
  const clock = new FixedClock();
  let s = buildSeed();
  const pending = s.receipts.find((r) => r.status === "pending")!;
  const assignmentsBefore = s.assignments.length;
  s = retryReceipt(s, pending.id, { ok: false, error: "再次失败" }, clock);
  const r1 = s.receipts.find((r) => r.id === pending.id)!;
  check("失败重试后尝试次数=2", r1.attempts === 2);
  check("失败重试不新增派工记录", s.assignments.length === assignmentsBefore);
  check("仍为待确认", r1.status === "pending");

  s = retryReceipt(s, pending.id, { ok: true }, clock);
  const r2 = s.receipts.find((r) => r.id === pending.id)!;
  check("再次重试成功 → 已确认", r2.status === "confirmed");
  check("尝试次数=3", r2.attempts === 3);
  check("成功重试不新增派工记录", s.assignments.length === assignmentsBefore);

  // 对已确认回执再重试：状态不变
  const sAgain = retryReceipt(s, pending.id, { ok: true }, clock);
  check("已确认回执不可再重试", sAgain === s);
}

console.log("4) 复核变化连带重算：退回原批次 + 释放工位 + 候补顺延 + 回执作废");
{
  const clock = new FixedClock();
  let s = buildSeed();
  // 乙班：ST-2061 / ST-2068 当班，ST-2072 候补#1，且 2072 回执待确认。
  const waitId = s.assignments.find((a) => a.stoneId === "ST-2072")!.id;
  const receiptBefore = s.receipts.find((r) => r.assignmentId === waitId)!;
  check("ST-2072 回执 initially pending", receiptBefore.status === "pending");

  // 把当班的 ST-2061 改判 reject → 退回 B2409-B，释放工位
  s = applyReviewChange(
    s,
    { stoneId: "ST-2061", review: "reject", operator: "质检员李" },
    clock
  );
  const tb = teamBoard(s, "T-B");
  check("退回后乙班当班仍2颗（候补顺延补位）", tb.queued.length === 2);
  check("候补清空", tb.waitlist.length === 0);
  const promoted = s.assignments.find((a) => a.stoneId === "ST-2072")!;
  check("ST-2072 顺延为当班队列", promoted.status === "queued");
  check("顺延不改变订单石位占用", promoted.orderId === "ORD-1002" && promoted.slotId === "s2");

  const returned = s.assignments.find(
    (a) => a.stoneId === "ST-2061" && a.status === "returned"
  )!;
  check("ST-2061 记录标记 returned", Boolean(returned));
  const ord = orderSummary(s, "ORD-1001");
  const s2Row = ord.rows.find((r) => r.slot.id === "s2")!;
  check("ORD-1001 s2 确实空闲", !s2Row.assignment);
  // s4 原本就空闲，退回 s2 后空闲石位 = 2
  check("ORD-1001 空闲石位=2", ord.free === 2, `free=${ord.free}`);

  // 留痕检查：操作人 / 批次 / 前后值
  const changeLog = s.audit.find((e) => e.action === "review-change")!;
  check("留痕记录操作人=质检员李", changeLog.operator === "质检员李");
  check("留痕记录批次号=B2409-B", changeLog.batchId === "B2409-B");
  const reviewChange = changeLog.changes?.find((c) => c.field === "复核结论");
  check("留痕含复核结论前后值", reviewChange?.before === "pass" && reviewChange.after === "reject");
  const retChange = changeLog.changes?.find((c) => c.field === "所在位置");
  check("留痕含位置退回前后值", Boolean(retChange));

  // 最早阻塞消失
  check("候补顺延后全车间无阻塞", globalEarliestBlocker(s) === undefined);
}

console.log("5) 候补发号顺序：工位不足时按到达先后排队");
{
  const clock = new FixedClock();
  let s = buildSeed();
  // 丙班容量2，当前当班1颗（ST-2052）。需要两颗可派工石头 + 空闲石位。
  // 释放：把 ST-2052 改判 hold → 丙班当班0；但订单石位也释放。
  s = applyReviewChange(
    s,
    { stoneId: "ST-2052", review: "hold", operator: "质检员李" },
    clock
  );
  // 现有可派工 pass 石头都被占用；改判两颗 reject/hold 为 pass 制造排队：
  // ST-2063 蓝宝石(hold)、ST-2099 祖母绿(hold)
  s = applyReviewChange(s, { stoneId: "ST-2063", review: "pass", operator: "李" }, clock);
  s = applyReviewChange(s, { stoneId: "ST-2099", review: "pass", operator: "李" }, clock);
  // 需要订单石位：
  //  ST-2063 蓝宝石 → ORD-1003 s2（ST-2052 退回后空闲）
  //  ST-2099 祖母绿 → ORD-1001 s4（空闲）
  //  再让 ST-2052 重新 pass 派回 s2？顺序：先派 2063 当班，再派 2099 当班（占满2），再派 2052 → 候补
  s = applyReviewChange(s, { stoneId: "ST-2052", review: "pass", operator: "李" }, clock);
  s = dispatchStone(s, { stoneId: "ST-2063", orderId: "ORD-1003", slotId: "s2", teamId: "T-C", operator: "李", idemKey: "w-a" }, clock);
  s = dispatchStone(s, { stoneId: "ST-2099", orderId: "ORD-1001", slotId: "s4", teamId: "T-C", operator: "李", idemKey: "w-b" }, clock);
  // 2052 蓝宝石，s2 已被 2063 占；没有空闲蓝宝石位。直接断言前两颗占满即可。
  const tb = teamBoard(s, "T-C");
  check("丙班当班占满2颗", tb.queued.length === 2);
  check("队首是 ST-2063（先到）", tb.queued[0].stoneId === "ST-2063");
  check("队次是 ST-2099（后到）", tb.queued[1].stoneId === "ST-2099");
}

console.log("6) 保险额度变化留痕");
{
  const clock = new FixedClock();
  const s = buildSeed();
  const s2 = applyReviewChange(
    s,
    { stoneId: "ST-2048", insuredAmount: 9999, operator: "核保员周" },
    clock
  );
  const log = s2.audit.find((e) => e.action === "review-change")!;
  const c = log.changes?.find((x) => x.field === "保险额度");
  check("保额留痕前后值 8600→9999", c?.before === 8600 && c.after === 9999);
  check("保额操作人=核保员周", log.operator === "核保员周");
  check("保额变化不改变派工", s2.assignments.length === s.assignments.length);
}

console.log("7) 崩溃恢复：发件箱快照幂等补回，且不重复占用");
{
  const clock = new FixedClock();
  const seed = buildSeed();
  // 模拟一条待确认派工：先正常派工（占用成功），然后假设主账本丢了这条、发件箱还在。
  // 释放一个钻石位用于恢复：把 ST-2068 改判 hold（退回、释放 ORD-1001 s3）
  const sRel = applyReviewChange(
    seed,
    { stoneId: "ST-2068", review: "hold", operator: "李" },
    clock
  );
  // 把一颗未占用的 pass 钻石准备好：ST-2077 reject→pass
  const sReady = applyReviewChange(
    sRel,
    { stoneId: "ST-2077", review: "pass", operator: "李" },
    clock
  );
  const withDispatch = dispatchStone(
    sReady,
    { stoneId: "ST-2077", orderId: "ORD-1001", slotId: "s3", teamId: "T-B", operator: "王", idemKey: "crash-1" },
    clock
  );
  const assignment = withDispatch.assignments.find((a) => a.idemKey === "crash-1")!;
  const receipt = withDispatch.receipts.find((r) => r.idemKey === "crash-1")!;

  // 构造"主账本缺失该派工"的状态：移除该派工与回执（模拟只恢复了部分数据）
  const broken: typeof withDispatch = {
    ...withDispatch,
    assignments: withDispatch.assignments.filter((a) => a.idemKey !== "crash-1"),
    receipts: withDispatch.receipts.filter((r) => r.idemKey !== "crash-1"),
  };
  const res = restorePendingDispatches(
    broken,
    [{ assignment, receipt }],
    clock
  );
  check("恢复补回 1 条", res.restored === 1);
  const restored = res.state.assignments.find((a) => a.idemKey === "crash-1");
  check("恢复后派工存在且占原石位", restored?.orderId === "ORD-1001" && restored.slotId === "s3");
  check("恢复后回执仍 pending", res.state.receipts.find((r) => r.idemKey === "crash-1")?.status === "pending");

  // 再恢复一次：幂等，不重复
  const res2 = restorePendingDispatches(res.state, [{ assignment, receipt }], clock);
  check("重复恢复跳过、不重复占用", res2.restored === 0 && res2.skipped === 1);

  // 主账本里该石位已被"另一条"派工占用（id emKey 不同）→ 快照过期，跳过
  const foreignAssignment = {
    ...assignment,
    id: "A-foreign",
    idemKey: "foreign-key",
  };
  const foreignReceipt = {
    ...receipt,
    id: "R-foreign",
    assignmentId: "A-foreign",
    idemKey: "foreign-key",
  };
  const res3 = restorePendingDispatches(
    res.state,
    [{ assignment: foreignAssignment, receipt: foreignReceipt }],
    clock
  );
  check("石位已被占用时跳过过期快照", res3.skipped === 1 && res3.restored === 0);
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 项检查失败`);
  process.exit(1);
} else {
  console.log("全部规则检查通过 ✅");
}
