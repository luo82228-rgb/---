// 普通访问者（viewer）的「示例数据」载荷（2026-06-11 用户定的方案）：
// viewer 的 /api/all、/api/refresh 不抓取任何真实数据，直接返回这套写死的虚拟示例行——
// 字段结构与 sheets.ts 各 map* 输出完全一致，前端渲染逻辑零改动，泄露风险为零。
// 日期按当天（UTC+8 墙上时间）动态生成：保证「本月」等时间筛选任何时候都有数据，
// 今日关注的「今日到期 / 明日到期 / 已超期」三张表也各有一条示例（所以广告给 3 条，其余模块各 1 条）。
// 品牌用虚构名「示例品牌A / 示例品牌B」，不暴露真实品牌；前端品牌下拉选项跟随数据生成。

const HOUR8 = 8 * 3600e3;

/** 相对今天（UTC+8）偏移 offsetDays 天的日期串 YYYY-MM-DD */
function d(offsetDays: number): string {
  const t = new Date(Date.now() + HOUR8 + offsetDays * 864e5);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

export function buildDemoData() {
  const now = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(/\//g, '-');

  return {
    success: true,
    updated_at: now,
    sheet_count: 5,
    ads: [
      // 打款时间一律用今天（必落在「本月」内）；到期时间分别为 今天/明天/5天前，
      // 让今日关注三张表都有内容；超期那条备注含「沟通中」→ 演示中风险分段
      { ad_no: 'YP-001', brand: '示例品牌A', biz_name: '张示例', group: '示例广告对接群①', ad_type: '直播', ad_mode: 'CPT', amount: '50000', pay_status: '已收款', pay_time: d(0), expire_time: d(0), recorder: '示例记录人', remark: '示例备注：本条为虚拟演示数据' },
      { ad_no: 'YP-002', brand: '示例品牌B', biz_name: '李示例', group: '示例广告对接群②', ad_type: '棋牌', ad_mode: 'CPS', amount: '30000', pay_status: '未收款', pay_time: d(0), expire_time: d(1), recorder: '示例记录人', remark: '' },
      { ad_no: 'YP-003', brand: '示例品牌A', biz_name: '王示例', group: '示例广告对接群③', ad_type: '播放器', ad_mode: 'CPC', amount: '20000', pay_status: '已收款', pay_time: d(0), expire_time: d(-5), recorder: '示例记录人', remark: '沟通中，预计近期补量' },
    ],
    reviews: [
      // ad_no 对应上面 YP-001：品牌汇总「覆盖群」的编号反查可演示
      { date: d(0), brand: '示例品牌A', target: '张示例', reviewer: '示例审查员', ad_no: 'YP-001', scene: '群组', method: '抽查', has_issue: '有', issue_type: '示例问题类型', issue_desc: '示例问题描述：仅用于界面演示', risk_level: '中', is_fixed: '是', fix_time: d(0), is_rechecked: '是', is_closed: '是', ad_amount: '50000', summary: '示例汇总分析：本条为虚拟演示数据，无真实业务含义' },
    ],
    keywords: [
      { no: 'K-001', brand: '示例品牌B', source: '示例来源群②', sender: '示例用户', keyword: '示例关键词', content: '这是一条虚拟的示例消息内容，仅用于界面演示。', log_time: `${d(0)} 10:30`, ai_analysis: '示例 AI 分析：本条为演示数据，无真实含义。', status: '已完成', reviewer: '示例审查员', remark: '' },
    ],
    tasks: [
      { task_name: '示例任务：界面演示用虚拟条目', priority: 'P1', reviewer: '示例负责人', status: '进行中', progress: '50%', start_time: d(-7), end_time: d(7), milestone: '示例里程碑', remark: '演示数据' },
    ],
    ai_items: [
      { flow_no: 'AI-001', flow_name: '示例工作流', summary: '演示用虚拟条目，无真实含义', reviewer: '示例负责人', input: '示例输入', output: '示例输出', steps: '步骤一 → 步骤二 → 步骤三', tools: '示例工具', trigger: '手动', frequency: '每周', save_time: '2小时/周', status: '已上线', remark: '演示数据' },
    ],
  };
}
