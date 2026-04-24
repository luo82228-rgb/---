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
