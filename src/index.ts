import { fetchAllData } from './sheets';
import { handleLogin, handleLogout, loginPage, verifyTicket, verifySession, handleChangePassword, Role } from './auth';

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

    if (pathname === '/api/all') {
      const cache = caches.default;
      const cached = await cache.match(new Request(CACHE_KEY));
      if (cached) return cached;
      return buildAndCache(cache);
    }

    if (pathname === '/api/refresh') {
      const cache = caches.default;
      await cache.delete(new Request(CACHE_KEY));
      return buildAndCache(cache);
    }

    if (pathname === '/api/debug') {
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
