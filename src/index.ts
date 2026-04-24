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

    // 调试：逐步测试抓取 + 解析流程
    if (pathname === '/api/debug') {
      const BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYjTwWrWGzl6iPrqmxp8rldOod7jhtWG8guYRo5RFOe1xXfo6DwxsIZ7mHJUP0EBq2xtGpo0zOEZOi/pub';
      const sheetName = '2604-广告明细YP';
      const csvUrl = `${BASE}?output=csv&sheet=${encodeURIComponent(sheetName)}`;
      try {
        const res = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await res.text();
        const lines = text.trim().split(/\r?\n/);
        // 找表头行
        let headerIdx = -1, headers: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.filter(c => c !== '').length >= 2) { headerIdx = i; headers = cols; break; }
        }
        // 数据行数
        const dataRows = lines.slice(headerIdx + 1).filter(l => l.replace(/,/g,'').trim() !== '').length;
        return new Response(JSON.stringify({
          status: res.status,
          ok: res.ok,
          totalLines: lines.length,
          headerIdx,
          headers: headers.filter(h => h !== ''),
          dataRows,
          firstDataLine: lines.slice(headerIdx + 1).find(l => l.replace(/,/g,'').trim() !== ''),
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
