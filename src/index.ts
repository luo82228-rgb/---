import { fetchAllData } from './sheets';

interface Env {
  ASSETS: Fetcher;
}

const CACHE_KEY = 'https://cache.yipin-internal/api/data/v1';
const CACHE_TTL = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

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

    // 临时调试：测试能否抓取谷歌表格
    if (pathname === '/api/debug') {
      const testUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYjTwWrWGzl6iPrqmxp8rldOod7jhtWG8guYRo5RFOe1xXfo6DwxsIZ7mHJUP0EBq2xtGpo0zOEZOi/pub?output=csv&sheet=2604-%E5%B9%BF%E5%91%8A%E6%98%8E%E7%BB%86YP';
      try {
        const res = await fetch(testUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await res.text();
        return new Response(JSON.stringify({
          status: res.status,
          ok: res.ok,
          url: res.url,
          preview: text.slice(0, 500),
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

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
