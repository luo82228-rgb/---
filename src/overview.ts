// 普通访问者的「业务总览」脱敏快照：服务端用全量数据算出默认视图（本月 + 全部品牌 + 分品牌行），
// 数值打码后才下发（保留约 20% 字符，其余用 * 代替）；原始明细数组对 viewer 全部置空（见 index.ts trimForRole）。
// 口径 1:1 复刻前端 renderOverview（本月 preset、isPaid、kwIsRisk/kwIsEmpty、覆盖群反查等），
// 时间统一按中国时区（UTC+8）的墙上时间比较，与用户浏览器里的口径一致。改前端总览口径时这里要同步改！

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
