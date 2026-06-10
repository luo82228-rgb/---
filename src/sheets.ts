const PUBHTML_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYjTwWrWGzl6iPrqmxp8rldOod7jhtWG8guYRo5RFOe1xXfo6DwxsIZ7mHJUP0EBq2xtGpo0zOEZOi/pubhtml';

const BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYjTwWrWGzl6iPrqmxp8rldOod7jhtWG8guYRo5RFOe1xXfo6DwxsIZ7mHJUP0EBq2xtGpo0zOEZOi/pub';

// 任务清单 / AI 成效都已迁出主表，各自独立电子表格（单 sheet，不分品牌）
const TASKS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_gRsLlqfNg3rRGGib01BWI7MznmfaVjFciBumP6MZP4OBdJcccuVYA9jkevLHcBU9HUPOhcsxTDC2/pub?output=csv';
const AI_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSZsfk4hM77psZWYfqPIx9VUwJdu7wAIJBjkac-Hs2_4ZlHXg29lnY9XX-h9taevnlwsehMb2C_ID-l/pub?output=csv';

const DEPRECATED = new Set(['项目资源YP-YPFH']);

function getBrand(name: string): string | null {
  if (/YPFH|ypfh/i.test(name)) return '逸品孵化';
  if (/YP|yp/i.test(name)) return '逸品';
  return null;
}

// 任务清单 / AI 成效已迁出主表（各自独立电子表格），不再从主表 sheet 名识别
function getModule(name: string): 'ads' | 'reviews' | 'keywords' | null {
  if (/广告明细/.test(name)) return 'ads';
  if (/审查台[账帐]/.test(name)) return 'reviews';
  if (/关键词/.test(name)) return 'keywords';
  return null;
}

async function fetchGidMap(): Promise<Array<{ gid: string; name: string }>> {
  try {
    const res = await fetch(PUBHTML_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YipinDashboard/1.0)' },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches = [...html.matchAll(/\{name: "([^"]+)", pageUrl: [^,]+, gid: "(\d+)"/g)];
    return matches.map(m => ({ name: m[1], gid: m[2] }));
  } catch {
    return [];
  }
}

// 去掉括号内的说明文字，如"发现问题（有、无）"→"发现问题"
function normHeader(h: string): string {
  return h.replace(/\s*[（(][^）)]*[）)]/g, '').trim();
}

// 完整 CSV 解析器：支持多行引号字段（RFC 4180）+ 双行表头合并
function parseCsv(text: string): Record<string, string>[] {
  // 逐字符解析，正确处理引号内的换行
  const parsed: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { field += '"'; i++; }
      else inQ = !inQ;
      continue;
    }
    if ((c === '\r' || c === '\n') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some(f => f !== '')) parsed.push(row);
      row = [];
      continue;
    }
    if (c === ',' && !inQ) { row.push(field.trim()); field = ''; continue; }
    field += c;
  }
  row.push(field.trim());
  if (row.some(f => f !== '')) parsed.push(row);

  if (!parsed.length) return [];

  // 找第一个有 ≥2 非空列的行作为主表头
  let hdrIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].filter(f => f !== '').length >= 2) {
      hdrIdx = i; headers = parsed[i].map(normHeader); break;
    }
  }
  if (hdrIdx < 0) return [];

  // 检测子表头：紧接的下一行如果在主表头的空白位填入了值，则合并
  let dataStart = hdrIdx + 1;
  if (dataStart < parsed.length) {
    const sub = parsed[dataStart].map(normHeader);
    const fillsGaps = sub.some((v, i) => v !== '' && (i >= headers.length || headers[i] === ''));
    if (fillsGaps) {
      headers = headers.map((h, i) => (sub[i] !== '' ? sub[i] : h));
      for (let i = headers.length; i < sub.length; i++) {
        if (sub[i] !== '') headers[i] = sub[i];
      }
      dataStart++;
    }
  }

  const validIdx = headers.reduce<number[]>((acc, h, i) => { if (h !== '') acc.push(i); return acc; }, []);
  const cleanHeaders = validIdx.map(i => headers[i]);

  const rows: Record<string, string>[] = [];
  for (let i = dataStart; i < parsed.length; i++) {
    const cols = parsed[i];
    if (!cols.some(f => f !== '')) continue;
    const obj: Record<string, string> = {};
    cleanHeaders.forEach((h, j) => { obj[h] = (cols[validIdx[j]] ?? '').trim(); });
    rows.push(obj);
  }
  return rows;
}

function mapAds(rows: Record<string, string>[], brand: string) {
  return rows.map(r => ({
    ad_no: r['广告编号'] ?? '',
    brand,
    biz_name: r['商务花名'] ?? '',
    group: r['广告对接群'] || r['新广告对接群'] || '',
    ad_type: r['广告类型'] ?? '',
    ad_mode: r['广告模式'] ?? '',
    amount: r['广告金额'] ?? '',
    pay_status: r['收款状态'] ?? '',
    pay_time: r['打款时间'] ?? '',
    expire_time: r['到期时间'] ?? '',
    recorder: r['记录责任人'] || r['记录人'] || '',
    remark: r['备注'] ?? '',
  })).filter(r => r.ad_no !== '');
}

function mapReviews(rows: Record<string, string>[], brand: string) {
  // 审查台账：双行表头合并后字段名已规范化（去掉括号说明）
  // 日期可能是合并单元格，需向下填充
  let lastDate = '';
  return rows.map(r => {
    const d = r['审查日期'] || '';
    if (d) lastDate = d;
    const date = d || lastDate;
    return {
      date,
      brand,
      target: r['商务'] || r['审查对象'] || '',
      reviewer: r['审查人'] || '',
      ad_no: r['广告编号'] || r['审查内容'] || '',
      scene: r['审查场景'] || '',
      method: r['审查方式'] || '',
      has_issue: r['发现问题'] || r['问题记录'] || '',
      issue_type: r['问题类型'] || '',
      issue_desc: r['问题描述'] || '',
      risk_level: r['风险等级'] || '',
      is_fixed: r['是否整改'] || r['整改跟踪'] || '',
      fix_time: r['整改时间'] || '',
      is_rechecked: r['是否复查'] || '',
      is_closed: r['是否闭环'] || '',
      ad_amount: r['广告金额'] || '',
      summary: r['汇总分析'] || '',
    };
  }).filter(r => r.date !== '' && r.ad_no !== '');
}

function mapKeywords(rows: Record<string, string>[], brand: string) {
  return rows.map(r => ({
    no: r['编号'] ?? '',
    brand,
    source: r['来源群'] ?? '',
    sender: r['发送人'] ?? '',
    keyword: r['命中关键词'] || r['关键词'] || '',
    content: r['消息内容'] ?? '',
    log_time: r['登记时间'] ?? '',
    ai_analysis: r['AI分析'] || r['问题描述'] || '',
    status: r['处理状态'] ?? '',
    reviewer: r['审查人员'] || r['审查人'] || '',
    remark: r['备注'] ?? '',
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

export async function fetchAllData() {
  const acc = {
    ads: [] as ReturnType<typeof mapAds>,
    reviews: [] as ReturnType<typeof mapReviews>,
    keywords: [] as ReturnType<typeof mapKeywords>,
    tasks: [] as ReturnType<typeof mapTasks>,
    ai: [] as ReturnType<typeof mapAi>,
  };
  let successCount = 0;

  const sheets = await fetchGidMap();

  // 任务清单 / AI 成效：各自独立电子表格，与主表 sheet 并行拉取
  const tasksPromise = (async () => {
    try {
      const res = await fetch(TASKS_CSV_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YipinDashboard/1.0)' },
      });
      if (!res.ok) return;
      const text = await res.text();
      if (!text.trim()) return;
      const rows = parseCsv(text);
      if (!rows.length) return;
      acc.tasks.push(...mapTasks(rows));
      successCount++;
    } catch { /* 任务表失败不影响其他数据 */ }
  })();

  const aiPromise = (async () => {
    try {
      const res = await fetch(AI_CSV_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YipinDashboard/1.0)' },
      });
      if (!res.ok) return;
      const text = await res.text();
      if (!text.trim()) return;
      const rows = parseCsv(text);
      if (!rows.length) return;
      acc.ai.push(...mapAi(rows));
      successCount++;
    } catch { /* AI 表失败不影响其他数据 */ }
  })();

  await Promise.all(sheets.map(async ({ gid, name }) => {
    if (DEPRECATED.has(name)) return;
    const brand = getBrand(name);
    const mod = getModule(name);
    if (!brand || !mod) return;
    try {
      const res = await fetch(`${BASE_URL}?output=csv&gid=${gid}`, {
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
      successCount++;
    } catch { /* 单表失败不中断 */ }
  }));

  await Promise.all([tasksPromise, aiPromise]);

  const updated_at = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(/\//g, '-');

  return { success: true, updated_at, sheet_count: successCount, ads: acc.ads, reviews: acc.reviews, keywords: acc.keywords, tasks: acc.tasks, ai_items: acc.ai };
}
