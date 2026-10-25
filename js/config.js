/* =============================================================
 * config.js — 抓斗门座式起重机 几何与运动参数（唯一数据源）
 * 单位：m / rad / s / t
 * 坐标：y 向上；大车沿 x 行走；轨道对称于 z = ±railSpan/2
 * 结构型式：象鼻梁 + 大拉杆 四连杆水平变幅，尾部杠杆平衡重
 *
 * 四连杆综合结果（臂架 30°~50°）：
 *   抓斗悬挂点 C 高度极差 0.053 m，幅度 22.15 ~ 31.89 m
 * ============================================================= */
window.CFG = {

  machine: {
    model: 'GQ10-30',
    ratedLoad: 10,          // 抓斗门机额定起重量 t（含抓斗自重与物料）
    railSpan: 10.0,
    wheelBase: 12.6,
    portalHeight: 10.5,
    slewBearingH: 0.85,
  },

  /* 上部回转部分（局部坐标原点 = 转台顶面，y 向上） */
  upper: {
    pivot: { x: 2.50, y: 12.50 },   // 臂架铰点 A

    /* 四连杆水平变幅：直臂 AB + 象鼻梁 BCD + 大拉杆 DE + 机架 EA */
    jibLength: 24.0,                // 臂架 AB
    head: {
      rc: 8.68,                     // |BC|  B → 抓斗滑轮 C
      rd: 2.77,                     // |BD|  B → 拉杆连接点 D
      beta: -139.2,                 // ∠CBD
    },
    tieRod: 25.88,                  // |DE|
    apex: { x: -3.62, y: 20.14 },   // E（人字架顶 / 拉杆铰点）

    alphaMin: 26,                   // 臂架仰角下限 deg（最大幅度）
    alphaMax: 50,                   // 臂架仰角上限 deg（最小幅度）

    /* 齿条变幅机构：扇形齿条半径 + 小齿轮，中心距须等于两者半径之和 */
    rack: {
      radius: 2.30,
      span: 44,
      pinionR: 0.42,
      pinionAt: { x: 0.20, y: 11.04 },   // 距 A 2.72 m，与齿条节圆相切
    },

    /* 平衡机构：转台后上方摆动杠杆 + 圆盘配重，连杆接臂架根部 */
    counterweight: {
      pivotX: -2.20, pivotY: 7.50,
      armLength: 3.60,
      radius: 1.62,
      width: 2.20,
      linkAt: 1.40,                 // 连杆接臂架位置（自 A 向根部）
    },
  },

  /* 起升系统 */
  hoist: {
    minHeight: 0.45,      // 抓斗底离轨面的最小高度（卸到卡车斗）
    maxHeight: 26.0,      // 抓斗底离轨面的最大高度
    ropeDiameter: 0.055,
  },

  /* 抓斗（双颚板） */
  grab: {
    height: 2.55,         // 闭合高度
    width: 2.35,          // 闭合宽度
    openWidth: 3.70,      // 张开宽度
    weight: 4.2,          // 自重 t
    payload: 5.6,         // 满斗物料重 t
  },

  travel: { min: -26, max: 26 },

  speed: {
    slew: 1.6,            // r/min
    luff: 0.55,           // deg/s
    hoist: 1.05,          // m/s
    travel: 1.15,         // m/s
    grab: 1.1,            // 抓斗开合全行程时间 s
  },

  sway: {
    damping: 0.062,
    maxAngle: 0.30,
  },

  /* 起重量—幅度特性（抓斗门机，含抓斗自重） */
  loadCurve: [
    [22.0, 16.0],
    [26.0, 13.0],
    [30.0, 11.0],
    [32.0, 10.0],
  ],

  /* 场景：散货船与自卸卡车 */
  scene: {
    ship: {
      x: 0, z: 30.5, length: 92, width: 18.5,
      deckY: 4.2,            // 甲板面高度
      holdY: 2.55,           // 舱内沙面高度（接近满载）
      holdHalfW: 7.0,        // 舱口半宽（散货船舱口接近船宽）
      holdX0: -30, holdX1: 30,
      capacity: 14,          // 舱容（满斗数），抓完约剩空舱
    },
    truck: {
      x: 23.0, z: 0.8,       // 车厢中心（世界坐标）
      bedY: 1.84,            // 车厢底板高度
      bedL: 9.2, bedW: 2.62,
      capacity: 3,           // 装满所需抓斗数
    },
  },

  colors: {
    steel: 0xf0a63c,
    steelDeep: 0xd8892a,
    steelCool: 0x8d99a8,
    deck: 0xe7eaee,
    house: 0xf3f5f7,
    dark: 0x3c4653,
    rope: 0x2b3038,
    grab: 0xd8752c,
    sand: 0xc9ab74,
    concrete: 0xb3bcc7,
    hull: 0x27333f,
  },
};
