// 「业务总览」脱敏快照：服务端用全量数据算出默认视图（本月 + 全部品牌 + 分品牌行），数值打码后下发。
// 现在只服务高级访问者——总览「收款金额」类数值从这里取（明细金额已打码，前端求不出和）；
// 普通访问者已改为路由层直接返回虚拟示例数据（src/demo.ts），不再使用这份快照（2026-06-11）。
// 口径 1:1 复刻前端 renderOverview（本月 preset、isPaid、kwIsRisk/kwIsEmpty、覆盖群反查等），
// 时间统一按中国时区（UTC+8）的墙上时间比较，与用户浏览器里的口径一致。改前端总览口径时这里要同步改！
//
// 本文件还包含高级访问者的整库打码 maskDataForAdvanced（见文件末尾）。

interface AdRow { ad_no: string; brand: string; group: string; amount: string; pay_status: string; pay_time: string; expire_time: string }
interface ReviewRow { date: string; brand: string; ad_no: string; has_issue: string }
interface KwRow { brand: string; source: string; log_time: string; status: string }

export interface OverviewInput { ads: AdRow[]; reviews: ReviewRow[]; keywords: KwRow[] }

export interface ViewerOverview {
  range_label: string;
  stats: { label: string; value: string; cls: string }[];
  brands: { brand: string; ads: string; amount: string; review_cnt: string; rvs: string; kws: string; cover: string; issues: string }[];
}

const HOUR8 = 8 * 3600e3;

/** 打码：保留约 20% 字符（至少 1 位，单字符全遮），其余替换为 * */
function mask(v: number | string): string {
  const s = typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
  if (!s) return s;
  if (s.length === 1) return '*';
  const vis = Math.max(1, Math.floor(s.length * 0.2));
  return s.slice(0, vis) + '*'.repeat(s.length - vis);
}

/** 解析日期串为"中国墙上时间"的毫秒值（用 Date.UTC 承载，仅用于互相比较） */
function parseDateCN(s: string): number | null {
  if (!s) return null;
  const str = String(s).trim();
  const tm = str.match(/[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  const hh = tm ? +tm[1] : 0, mi = tm ? +tm[2] : 0, ss = tm && tm[3] ? +tm[3] : 0;
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/) || str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mi, ss);
  return null;
}

const isPaid = (a: AdRow) => { const s = a.pay_status || ''; return s.includes('已收款') || s.includes('已下架'); };
const num = (s: string) => parseFloat(String(s || '').replace(/,/g, '')) || 0;
const kwIsPending = (k: KwRow) => k.status === '处理中' || k.status === '其他';
const kwIsRisk = (k: KwRow) => k.status === '已完成' || kwIsPending(k);
const kwIsEmpty = (k: KwRow) => !k.status || String(k.status).trim() === '';

export function buildViewerOverview(data: OverviewInput): ViewerOverview {
  const nowCN = new Date(Date.now() + HOUR8);
  const Y = nowCN.getUTCFullYear(), M = nowCN.getUTCMonth(), D = nowCN.getUTCDate();
  const monthS = Date.UTC(Y, M, 1), monthE = Date.UTC(Y, M + 1, 0, 23, 59, 59);
  const todayV = Y * 10000 + M * 100 + D;
  const inMonth = (dateStr: string) => { const t = parseDateCN(dateStr); return t !== null && t >= monthS && t <= monthE; };
  const dayV = (dateStr: string) => { const t = parseDateCN(dateStr); if (t === null) return null; const d = new Date(t); return d.getUTCFullYear() * 10000 + d.getUTCMonth() * 100 + d.getUTCDate(); };

  const adsWithGroup = data.ads.filter(a => a.group && inMonth(a.pay_time));
  const total = adsWithGroup.filter(isPaid).reduce((s, a) => s + num(a.amount), 0);
  const rvs = data.reviews.filter(r => inMonth(r.date));
  const kws = data.keywords.filter(k => inMonth(k.log_time));
  const expiredAds = data.ads.filter(a => a.group && !(a.pay_status || '').includes('已下架') && dayV(a.expire_time) === todayV).length;
  const issues = rvs.filter(r => r.has_issue === '有').length + kws.filter(kwIsRisk).length;
  const kwPend = kws.filter(kwIsEmpty).length;

  const stats = [
    { label: '收款广告数', value: mask(adsWithGroup.length), cls: '' },
    { label: '收款金额', value: mask(total), cls: '' },
    { label: '广告到期', value: mask(expiredAds), cls: expiredAds > 0 ? 'warn' : '' },
    { label: '检查总量', value: mask(rvs.length + kws.length), cls: '' },
    { label: '审查台账', value: mask(rvs.length), cls: '' },
    { label: '关键词', value: mask(kws.length), cls: '' },
    { label: '发现问题', value: mask(issues), cls: issues > 0 ? 'warn' : 'ok' },
    { label: '关键词待处理', value: mask(kwPend), cls: kwPend > 0 ? 'warn' : '' },
  ];

  const allBrandAds = data.ads.filter(a => a.group);
  const brandSet = [...new Set(allBrandAds.map(a => a.brand))].filter(Boolean).sort();
  const brands = brandSet.map(brand => {
    const brGrp = adsWithGroup.filter(a => a.brand === brand);
    const amt = brGrp.filter(isPaid).reduce((s, a) => s + num(a.amount), 0);
    const brv = rvs.filter(r => r.brand === brand), brk = kws.filter(k => k.brand === brand);
    const iss = brv.filter(r => r.has_issue === '有').length + brk.filter(kwIsRisk).length;
    const adByNo = new Map(allBrandAds.filter(a => a.brand === brand).map(a => [a.ad_no, a]));
    const coverSet = new Set<string>();
    for (const r of brv) { const a = adByNo.get(r.ad_no); if (a && a.group) coverSet.add(a.group); }
    for (const k of brk) { if (k.source) coverSet.add(k.source); }
    return {
      brand,
      ads: mask(brGrp.length),
      amount: mask(amt),
      review_cnt: mask(brv.length + brk.length),
      rvs: mask(brv.length),
      kws: mask(brk.length),
      cover: mask(coverSet.size),
      issues: iss > 0 ? `${mask(iss)}个` : '无',
    };
  });

  return { range_label: '本月', stats, brands };
}

// ── 高级访问者整库打码（2026-06-11）──
// 原则：内容字段 80% 打码，骨架字段（日期/时间、品牌、各类状态/类型/方式）保留明文，
// 保证前端的时间/品牌筛选、关键词三卡、审查三卡、今日关注到期判断、徽标渲染照常工作。
// 编号/群名这类要做反查与去重的字段用「防碰撞」打码（确定性 + 不同原文必得不同掩码），
// 其余内容字段普通确定性打码即可（撞了无所谓，还能避免防碰撞的星号尾巴越长越长）。

type Row = Record<string, unknown>;

// 打码强度（2026-06-11 用户定）：品牌、金额、备注、广告类型 → 全量打码（整串 *）；
// 其余内容字段 → 80% 打码（保留约 20% 明文头）。
// unique*：参与筛选/编号反查/下钻分组/去重的连接键，要走防碰撞打码保证不同原文掩码不同。
const ADV_MASK_FIELDS: Record<string, { unique: string[]; fullUnique: string[]; full: string[]; plain: string[] }> = {
  ads:      { unique: ['ad_no', 'group'], fullUnique: ['brand'], full: ['amount', 'remark', 'ad_type'], plain: ['biz_name', 'recorder'] },
  reviews:  { unique: ['ad_no'],          fullUnique: ['brand'], full: ['ad_amount', 'summary'],        plain: ['target', 'reviewer', 'issue_desc'] },
  keywords: { unique: ['no', 'source'],   fullUnique: ['brand'], full: ['remark'],                      plain: ['sender', 'keyword', 'content', 'ai_analysis', 'reviewer'] },
  tasks:    { unique: [],                 fullUnique: [],        full: ['remark'],                      plain: ['task_name', 'reviewer', 'progress', 'milestone'] },
  ai_items: { unique: ['flow_no'],        fullUnique: [],        full: ['remark'],                      plain: ['flow_name', 'summary', 'reviewer', 'input', 'output', 'steps', 'tools', 'save_time'] },
};

/** 文本打码：同 mask 的 80% 风格，但明文头最多 6 字符、星号最多 24 个（几百字的消息/备注不泄露长前缀、也不撑爆单元格） */
function maskText(s: string): string {
  if (s.length === 1) return '*';
  const vis = Math.min(Math.max(1, Math.floor(s.length * 0.2)), 6);
  return s.slice(0, vis) + '*'.repeat(Math.min(s.length - vis, 24));
}

/** 全量打码：整串替换为 *（星号最多 24 个） */
function maskFull(s: string): string {
  return '*'.repeat(Math.min(s.length, 24));
}

/** 就地打码整个 /api/all 载荷（仅高级访问者）。须在 buildViewerOverview 之后调用——快照要用原文算。 */
export function maskDataForAdvanced(data: Record<string, unknown>): void {
  // 防碰撞打码：同一原文 → 同一掩码（品牌筛选、编号反查、群去重语义不变）；
  // 不同原文若掩码撞车（如连续编号 YP-001/YP-002 都变 Y*****、同长品牌名全星后相同），尾部补 * 区分
  const memo = new Map<string, string>();
  const taken = new Set<string>();
  const maskUnique = (s: string, base: (v: string) => string): string => {
    const hit = memo.get(s);
    if (hit !== undefined) return hit;
    let out = base(s);
    while (taken.has(out)) out += '*';
    memo.set(s, out);
    taken.add(out);
    return out;
  };

  // 今日关注「已超期」的风险分级按备注原文判定（口径同前端 overdueRiskIdx：
  // 空=高0，补量中/补时中/沟通中=中1，其余有备注=低2），打码前先算好随行下发
  if (Array.isArray(data.ads)) {
    for (const r of data.ads as Row[]) {
      const s = String(r.remark || '').trim();
      r.od_risk = !s ? 0 : /补量中|补时中|沟通中/.test(s) ? 1 : 2;
    }
  }

  for (const [key, fields] of Object.entries(ADV_MASK_FIELDS)) {
    const rows = data[key];
    if (!Array.isArray(rows)) continue;
    for (const r of rows as Row[]) {
      for (const f of fields.unique) if (r[f]) r[f] = maskUnique(String(r[f]), maskText);
      for (const f of fields.fullUnique) if (r[f]) r[f] = maskUnique(String(r[f]), maskFull);
      for (const f of fields.full) if (r[f]) r[f] = maskFull(String(r[f]));
      for (const f of fields.plain) if (r[f]) r[f] = maskText(String(r[f]));
    }
  }

  // 脱敏快照同步处理：品牌名要和明细行同掩码（前端按 brand 匹配快照取金额），
  // 金额类数值改全量打码（不然 advanced 还能从快照看到 20% 明文头）
  const vo = data.viewer_overview as ViewerOverview | undefined;
  if (vo) {
    for (const st of vo.stats) if (st.label === '收款金额') st.value = maskFull(st.value);
    for (const b of vo.brands) {
      b.amount = maskFull(b.amount);
      b.brand = maskUnique(b.brand, maskFull);
    }
  }
}
