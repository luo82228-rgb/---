import { fetchAllData } from './_sheets';

// 用内部虚拟 URL 作为缓存键（必须是 http/https）
const CACHE_KEY = 'https://cache.yipin-internal/api/data/v1';
const CACHE_TTL = 60; // 秒

export const onRequestGet: PagesFunction = async () => {
  const cache = caches.default;
  const cacheReq = new Request(CACHE_KEY);

  const cached = await cache.match(cacheReq);
  if (cached) {
    const res = new Response(cached.body, {
      status: cached.status,
      headers: new Headers(cached.headers),
    });
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  return buildAndCache(cache);
};

async function buildAndCache(cache: Cache): Promise<Response> {
  try {
    const data = await fetchAllData();
    const res = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'X-Cache': 'MISS',
      },
    });
    // 异步写缓存，不阻塞响应
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
