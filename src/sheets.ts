const BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYjTwWrWGzl6iPrqmxp8rldOod7jhtWG8guYRo5RFOe1xXfo6DwxsIZ7mHJUP0EBq2xtGpo0zOEZOi/pub';

const KNOWN_SHEETS = [
  '2601-广告明细YP', '2601-审核记录YP',
  '2602-广告明细YP', '2602-审核记录YP',
  '2603-广告明细YP', '2603-审核记录YP', '2603-审查台帐YP',
  '2604-广告明细YP', '2604-审查台账YP',
  '2604-广告明细YPFH', '2604-审查台账YPFH',
  '关键词提醒yp', '关键词提醒ypfh', '项目资源YP-YPFH',
];

function getBrand(name: string): string | null {
  if (/YPFH|ypfh/i.test(name)) return '逸品孵化';
  if (/YP|yp/i.test(name)) return '逸品';
  return null;
}

function getModule(name: string): 'ads' | 'reviews' | 'keywords' | 'tasks' | 'ai' | null {
  if (/广告明细/.test(name)) return 'ads';
  if (/审核记录|审查台[账帐]/.test(name)) return 'reviews';
  if (/关键词/.test(name)) return 'keywords';
  if (/任务/.test(name)) return 'tasks';
  if (/AI成效|ai成效/i.test(name)) return 'ai';
  return null;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    result.push(cur.trim());
    return result;
  }

  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.filter(c => c !== '').length >= 2) {
      headerIdx = i; headers = cols; break;
    }
  }
  if (headerIdx < 0) return [];

  const validIdx = headers.reduce<number[]>((acc, h, i) => { if (h !== '') acc.push(i); return acc; }, []);
  const cleanHeaders = validIdx.map(i => headers[i]);

  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (!cols.filter(c => c !== '').length) continue;
    const obj: Record<string, string> = {};
    cleanHeaders.forEach((h, j) => { obj[h] = (cols[validIdx[j]] ?? '').trim(); });
    rows.push(obj);
  }
  return rows;
}

function mapAds(rows: Record<string, string>[], brand: string) {
  return rows.map(r => ({
    ad_no: r['广告编号'] ?? '',
    brand: brand || r['品牌'] || '',
    biz_name: r['商务花名'] ?? '',
    new_group: r['新广告对接群'] || r['广告对接群'] || '',
    old_group: r['老广告对接群'] ?? '',
    ad_type: r['广告类型'] ?? '',
    ad_mode: r['广告模式'] ?? '',
    amount: r['广告金额'] ?? '',
    pay_status: r['收款状态'] ?? '',
    pay_time: r['打款时间'] ?? '',
    expire_time: r['到期时间'] ?? '',
    recorder: r['记录责任人'] || r['记录人'] || '',
  })).filter(r => r.ad_no !== '');
}

function mapReviews(rows: Record<string, string>[], brand: string) {
  return rows.map(r => ({
    date: r['审查日期'] || r['日期'] || '',
    brand: brand || r['品牌'] || '',
    target: r['审查对象'] ?? '',
    reviewer: r['审查人'] || r['审查人员'] || '',
    ad_no: r['广告编号'] ?? '',
    scene: r['审查场景'] ?? '',
    method: r['审查方式'] ?? '',
    has_issue: r['发现问题'] ?? '',
    risk_level: r['风险等级'] ?? '',
    is_fixed: r['是否整改'] ?? '',
    is_closed: r['是否闭环'] ?? '',
  })).filter(r => r.date !== '' || r.ad_no !== '');
}

function mapKeywords(rows: Record<string, string>[], brand: string) {
  return rows.map(r => ({
    no: r['编号'] ?? '',
    brand: brand || r['品牌'] || '',
    source: r['来源群'] ?? '',
    sender: r['发送人'] ?? '',
    keyword: r['命中关键词'] || r['关键词'] || '',
    content: r['消息内容'] ?? '',
    log_time: r['登记时间'] ?? '',
    issue_desc: r['问题描述'] ?? '',
    status: r['处理状态'] ?? '',
    reviewer: r['审查人员'] || r['审查人'] || '',
  })).filter(r => r.keyword !== '' || r.content !== '');
}

function mapTasks(rows: Record<string, string>[]) {
  return rows.map(r => ({
    task_name: r['任务列表'] || r['任务名称'] || '',
    priority: r['优先级'] ?? '',
    reviewer: r['审查人员'] || r['负责人'] || '',
    status: r['状态'] ?? '',
    progress: r['当前进度'] ?? '',
    start_time: r['开始时间'] ?? '',
    end_time: r['结束时间'] ?? '',
    milestone: r['里程碑'] ?? '',
    remark: r['备注'] ?? '',
  })).filter(r => r.task_name !== '');
}

function mapAi(rows: Record<string, string>[]) {
  return rows.map(r => ({
    flow_no: r['工作流编号'] ?? '',
    flow_name: r['工作流名称'] ?? '',
    summary: r['一句话说明'] ?? '',
    reviewer: r['审查人员'] ?? '',
    input: r['输入'] ?? '',
    output: r['输出'] ?? '',
    steps: r['步骤摘要'] ?? '',
    tools: r['工具/Agent/模型'] || r['工具'] || '',
    trigger: r['触发方式'] ?? '',
    frequency: r['运行频率'] ?? '',
    save_time: r['预计节约工时'] ?? '',
    status: r['状态'] ?? '',
    remark: r['备注'] ?? '',
  })).filter(r => r.flow_name !== '');
}

async function fetchSheetList(): Promise<string[]> {
  try {
    const res = await fetch(BASE_URL + 'html', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YipinDashboard/1.0)' },
    });
    if (!res.ok) throw new Error('pubhtml failed');
    const text = await res.text();
    const names: string[] = [];
    const re = /sheet=([^&"'\s\)]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = decodeURIComponent(m[1]);
      if (!names.includes(name)) names.push(name);
    }
    if (names.length > 0) return names;
  } catch { /* fall through */ }

  const now = new Date();
  const generated: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const p = `${yy}${mm}`;
    for (const s of ['广告明细YP', '审查台账YP', '审核记录YP', '审查台帐YP', '广告明细YPFH', '审查台账YPFH'])
      generated.push(`${p}-${s}`);
  }
  const all = [...KNOWN_SHEETS];
  for (const s of generated) if (!all.includes(s)) all.push(s);
  return all;
}

export async function fetchAllData() {
  const acc = { ads: [] as ReturnType<typeof mapAds>, reviews: [] as ReturnType<typeof mapReviews>, keywords: [] as ReturnType<typeof mapKeywords>, tasks: [] as ReturnType<typeof mapTasks>, ai: [] as ReturnType<typeof mapAi> };
  let successCount = 0;

  const sheetNames = await fetchSheetList();

  await Promise.all(sheetNames.map(async (name) => {
    const brand = getBrand(name);
    const mod = getModule(name);
    if (!brand || !mod) return;
    try {
      const res = await fetch(`${BASE_URL}?output=csv&sheet=${encodeURIComponent(name)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YipinDashboard/1.0)' },
      });
      if (!res.ok) return;
      const text = await res.text();
      if (!text.trim()) return;
      const rows = parseCsv(text);
      if (!rows.length) return;
      if (mod === 'ads') acc.ads.push(...mapAds(rows, brand));
      if (mod === 'reviews') acc.reviews.push(...mapReviews(rows, brand));
      if (mod === 'keywords') acc.keywords.push(...mapKeywords(rows, brand));
      if (mod === 'tasks') acc.tasks.push(...mapTasks(rows));
      if (mod === 'ai') acc.ai.push(...mapAi(rows));
      successCount++;
    } catch { /* 单表失败不中断 */ }
  }));

  const updated_at = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(/\//g, '-');

  return { success: true, updated_at, sheet_count: successCount, ads: acc.ads, reviews: acc.reviews, keywords: acc.keywords, tasks: acc.tasks, ai_items: acc.ai };
}
