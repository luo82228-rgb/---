import { fetchAllData } from './_sheets';

const CACHE_KEY = 'https://cache.yipin-internal/api/data/v1';
const CACHE_TTL = 60;

// 支持 GET 和 POST（前端按钮用 GET，未来也可 POST）
export const onRequest: PagesFunction = async () => {
  const cache = caches.default;

  // 强制清除旧缓存
  await cache.delete(new Request(CACHE_KEY));

  try {
    const data = await fetchAllData();
    const res = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });
    // 写入新缓存
    cache.put(new Request(CACHE_KEY), res.clone());
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
};
