import { fetchAllData } from './sheets';
import { handleLogin, handleLogout, loginPage, verifyTicket, verifySession, handleChangePassword, Role } from './auth';
import { buildViewerOverview, maskDataForAdvanced, OverviewInput } from './overview';
import { buildDemoData } from './demo';

interface Env {
  ASSETS: Fetcher;
  AUTH_KV: KVNamespace;
  SIGNING_KEY?: string;
  DASH_PASSWORD?: string;
}

const CACHE_KEY = 'https://cache.yipin-internal/api/data/v1';
const CACHE_TTL = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // 登录页背景图和登录流程本身不需要鉴权
    if (pathname === '/fuchun-tile.jpg') return env.ASSETS.fetch(request);
    if (pathname === '/login') {
      // GET 永远给登录页（不看 Cookie）——每次打开/刷新看板都必须重新输密码
      return request.method === 'POST' ? handleLogin(request, env) : loginPage();
    }
    if (pathname === '/logout') return handleLogout();

    // 看板页只认 60 秒一次性门票（登录跳转带来），页面加载后会抹掉地址栏里的门票，
    // 所以刷新/重开必然回到登录页
    if (pathname === '/' || pathname === '/index.html') {
      const role = await verifyTicket(env, url.searchParams.get('t'));
      if (!role) return Response.redirect(`${url.origin}/login`, 302);
      return serveDashboard(url.origin, env, role);
    }

    // 其余路径（/api/* 等）认 12 小时会话 Cookie，保证开着的看板数据轮询不断
    const sessionRole = await verifySession(request, env);
    if (!sessionRole) {
      if (pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ success: false, error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return Response.redirect(`${url.origin}/login`, 302);
    }

    // 设置面板：在线修改三种身份的密码（handleChangePassword 内部限制仅制作者）
    if (pathname === '/api/settings/password' && request.method === 'POST') {
      return handleChangePassword(request, env, sessionRole);
    }

    // 商务状态监测的人工扣分（2026-06-11）：存 KV `bizded:v1`（{记录键:扣分数} 的 JSON 映射，
    // 记录键由前端按 审查日期|品牌|广告编号|序号 拼出）；读取任何身份可调（非制作者得空映射），
    // 写入仅限制作者。月度归集、得分计算都在前端做，这里只是个带权限的小存储。
    if (pathname === '/api/bizded') {
      const json = (status: number, body: Record<string, unknown>) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      if (request.method === 'POST') {
        if (sessionRole !== 'owner') return json(403, { success: false, error: '只有制作者可以录入扣分' });
        let set: Record<string, unknown> = {};
        try {
          const body = (await request.json()) as Record<string, unknown>;
          set = (body.set as Record<string, unknown>) || {};
        } catch {
          return json(400, { success: false, error: '请求格式不对' });
        }
        const cur = ((await env.AUTH_KV.get('bizded:v1', 'json')) as Record<string, number> | null) || {};
        for (const [k, v] of Object.entries(set)) {
          const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
          if (n > 0) cur[k] = n;
          else delete cur[k]; // 0 / 空 = 撤销该条扣分
        }
        await env.AUTH_KV.put('bizded:v1', JSON.stringify(cur));
        return json(200, { success: true, deductions: cur });
      }
      if (sessionRole !== 'owner') return json(200, { success: true, deductions: {} });
      const cur = ((await env.AUTH_KV.get('bizded:v1', 'json')) as Record<string, number> | null) || {};
      return json(200, { success: true, deductions: cur });
    }

    if (pathname === '/api/all' || pathname === '/api/refresh') {
      // 普通访问者：不抓取任何真实数据，直接返回写死的示例载荷（2026-06-11 方案）；
      // 也不碰缓存——viewer 点「同步数据」不应清掉别人的全量缓存
      if (sessionRole === 'viewer') {
        return new Response(JSON.stringify(buildDemoData()), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const cache = caches.default;
      if (pathname === '/api/refresh') {
        await cache.delete(new Request(CACHE_KEY));
        return trimForRole(await buildAndCache(cache), sessionRole);
      }
      const cached = await cache.match(new Request(CACHE_KEY));
      const res = cached || (await buildAndCache(cache));
      return trimForRole(res, sessionRole);
    }

    if (pathname === '/api/debug') {
      // 能查任意原始 sheet，仅制作者可用
      if (sessionRole !== 'owner') {
        return new Response(JSON.stringify({ success: false, error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYjTwWrWGzl6iPrqmxp8rldOod7jhtWG8guYRo5RFOe1xXfo6DwxsIZ7mHJUP0EBq2xtGpo0zOEZOi/pub';
      const url = new URL(request.url);
      const sheet = url.searchParams.get('sheet') || '关键词提醒yp';
      try {
        const res = await fetch(`${BASE}?output=csv&sheet=${encodeURIComponent(sheet)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await res.text();
        const lines = text.trim().split(/\r?\n/);
        let headerIdx = -1, headers: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.filter(c => c !== '').length >= 2) { headerIdx = i; headers = cols; break; }
        }
        const dataLines = lines.slice(headerIdx + 1).filter(l => l.replace(/,/g, '').trim() !== '');
        return new Response(JSON.stringify({ sheet, status: res.status, headerIdx, headers: headers.filter(h => h !== ''), dataRows: dataLines.length, samples: dataLines.slice(0, 3) }, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { headers: { 'Content-Type': 'application/json' } }); }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// 数据级隔离（与前端 PAGE_DENY 矩阵对应）：
// - viewer：不会走到这里——路由层直接返回 buildDemoData() 的虚拟示例载荷，真实数据零下发；
// - advanced：明细全量下发但内容字段打码、骨架字段保留（maskDataForAdvanced），
//   金额类求和前端算不出，附上脱敏快照（viewer_overview 字段，本月口径）供总览取「收款金额」；
// - owner：全量不裁。缓存仍存全量，逐请求按身份裁剪
async function trimForRole(res: Response, role: Role): Promise<Response> {
  if (role !== 'advanced') return res;
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (Array.isArray(data.ads) && Array.isArray(data.reviews) && Array.isArray(data.keywords)) {
      data.viewer_overview = buildViewerOverview(data as unknown as OverviewInput);
      maskDataForAdvanced(data); // 必须在 buildViewerOverview 之后——快照要用原文算
    }
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'bad payload' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function serveDashboard(origin: string, env: Env, role: Role): Promise<Response> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/`));
  let html = await res.text();
  // 注入身份（window.YP_ROLE，前端按身份分权用），并立刻抹掉地址栏里的一次性门票
  html = html.replace(
    '</head>',
    `<script>window.YP_ROLE=${JSON.stringify(role)};history.replaceState(null,'',location.pathname)</script></head>`
  );
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function buildAndCache(cache: Cache): Promise<Response> {
  try {
    const data = await fetchAllData();
    const res = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });
    cache.put(new Request(CACHE_KEY), res.clone());
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
