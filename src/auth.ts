// 访问密码保护（三种身份 + 每次打开都要登录 + 看板内在线改密码）：
// - 三种身份各有独立密码，存 KV（AUTH_KV，key = pw:owner / pw:advanced / pw:viewer），
//   制作者可在看板「更多 → 设置」面板在线修改；KV 没有 pw:owner 时回退到 Secret DASH_PASSWORD
//   （防止 KV 误删后把自己锁在外面）。advanced / viewer 没设密码时该身份不可登录。
// - 令牌签名密钥是 Secret SIGNING_KEY（与密码解耦：改密码不会让已打开的看板断流；
//   想踢掉所有人就换 SIGNING_KEY）。SIGNING_KEY 缺失时回退 DASH_PASSWORD。
// - 登录成功发两样东西：① 60 秒「门票」(URL 参数 t) 只用于打开看板页一次，页面加载后立刻从
//   地址栏抹掉，所以刷新/重开必回登录页；② 12 小时会话 Cookie 只给 /api/* 用，保证开着的
//   看板每分钟的数据轮询不断。令牌格式 `${role}.${过期毫秒}.${HMAC签名}`。

export type Role = 'owner' | 'advanced' | 'viewer';

export interface AuthEnv {
  AUTH_KV: KVNamespace;
  SIGNING_KEY?: string;
  DASH_PASSWORD?: string;
}

const AUTH_COOKIE = 'yp_auth';
const SESSION_TTL = 12 * 3600; // 秒：API 会话时长，覆盖一个工作日内开着不动的看板
const TICKET_TTL = 60; // 秒：打开看板页的一次性门票

// 防暴力试密码：按访问者 IP 记连续失败次数（KV key = fail:<ip>，与 pw:* 密码键无关），
// 连错 MAX_FAILS 次锁定 LOCK_TTL；锁定期内无论输什么（包括正确密码）都拒绝。
// 登录成功清零。KV 跨节点同步约 60 秒，攻击者换节点可能多试几次，对人肉试错足够。
const MAX_FAILS = 5;
const LOCK_TTL = 2 * 3600; // 秒：锁定时长
const FAIL_WINDOW = 2 * 3600; // 秒：失败计数保留时长（每次输错重新计时）

interface FailRecord {
  n: number;
  until?: number; // 锁定截止毫秒，存在且未到期即拒绝登录
}

function failKeyOf(request: Request): string {
  return `fail:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
}

function lockMessage(until: number): string {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return `连续输错密码 ${MAX_FAILS} 次，已暂时禁止登录，请约 ${mins} 分钟后再试`;
}

async function registerFail(env: AuthEnv, key: string, prev: FailRecord | null, role: Role): Promise<Response> {
  const n = (prev?.n ?? 0) + 1;
  if (n >= MAX_FAILS) {
    const until = Date.now() + LOCK_TTL * 1000;
    await env.AUTH_KV.put(key, JSON.stringify({ n, until }), { expirationTtl: LOCK_TTL + 60 });
    return loginPage(lockMessage(until), 429, role);
  }
  await env.AUTH_KV.put(key, JSON.stringify({ n }), { expirationTtl: FAIL_WINDOW });
  return loginPage(`密码不对，再试一次（连续错 ${MAX_FAILS} 次将禁止登录 2 小时，还剩 ${MAX_FAILS - n} 次机会）`, 401, role);
}

const ROLE_LABEL: Record<Role, string> = { owner: '制作者', advanced: '高级访问者', viewer: '普通访问者' };

function signingKey(env: AuthEnv): string | undefined {
  return env.SIGNING_KEY || env.DASH_PASSWORD;
}

async function rolePassword(env: AuthEnv, role: Role): Promise<string | undefined> {
  const stored = await env.AUTH_KV.get(`pw:${role}`);
  if (stored) return stored;
  return role === 'owner' ? env.DASH_PASSWORD : undefined;
}

function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'advanced' || v === 'viewer';
}

export async function handleLogin(request: Request, env: AuthEnv): Promise<Response> {
  let role = '', input = '';
  try {
    const form = await request.formData();
    role = String(form.get('role') ?? '');
    input = String(form.get('password') ?? '');
  } catch {
    // 非表单提交，按空处理
  }
  if (!signingKey(env)) return loginPage('管理员尚未配置访问密码', 401);

  const failKey = failKeyOf(request);
  const failRec = await env.AUTH_KV.get<FailRecord>(failKey, 'json');
  if (failRec?.until && failRec.until > Date.now()) {
    return loginPage(lockMessage(failRec.until), 429, isRole(role) ? role : 'owner');
  }

  if (!isRole(role)) return loginPage('请先选择访问身份', 400);
  const expected = await rolePassword(env, role);
  if (!expected) return loginPage(`「${ROLE_LABEL[role]}」的密码还没设置，请先用其他身份进入`, 401, role);
  if (!input || input !== expected) return registerFail(env, failKey, failRec, role);
  if (failRec) await env.AUTH_KV.delete(failKey); // 登录成功，清空连续失败计数

  const ticket = await makeToken(env, role, 'ticket', TICKET_TTL);
  const session = await makeToken(env, role, 'session', SESSION_TTL);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/?t=${encodeURIComponent(ticket)}`,
      'Set-Cookie': `${AUTH_COOKIE}=${session}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

export function handleLogout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

/** 看板设置面板的改密码接口（仅制作者会话可调，且需重新输入当前制作者密码） */
export async function handleChangePassword(request: Request, env: AuthEnv, sessionRole: Role | null): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  if (sessionRole !== 'owner') return json(403, { success: false, error: '只有制作者可以修改密码' });

  let target: unknown, password = '', current = '';
  try {
    const body = (await request.json()) as Record<string, unknown>;
    target = body.role;
    password = String(body.password ?? '');
    current = String(body.current ?? '');
  } catch {
    return json(400, { success: false, error: '请求格式不对' });
  }
  if (!isRole(target)) return json(400, { success: false, error: '身份参数不对' });

  const ownerPw = await rolePassword(env, 'owner');
  if (!ownerPw || current !== ownerPw) return json(403, { success: false, error: '当前制作者密码不对' });

  password = password.trim();
  if (password.length < 4 || password.length > 64) return json(400, { success: false, error: '新密码需为 4~64 位（不含首尾空格）' });

  await env.AUTH_KV.put(`pw:${target}`, password);
  return json(200, { success: true, role: target, label: ROLE_LABEL[target] });
}

/** 校验看板页门票（URL 参数 t），通过则返回身份 */
export async function verifyTicket(env: AuthEnv, ticket: string | null): Promise<Role | null> {
  return verifyToken(env, ticket, 'ticket');
}

/** 校验 API 会话 Cookie，通过则返回身份 */
export async function verifySession(request: Request, env: AuthEnv): Promise<Role | null> {
  return verifyToken(env, getCookie(request, AUTH_COOKIE), 'session');
}

async function makeToken(env: AuthEnv, role: Role, kind: 'ticket' | 'session', ttlSec: number): Promise<string> {
  const exp = Date.now() + ttlSec * 1000;
  const sig = await sign(signingKey(env)!, `${kind}.${role}.${exp}`);
  return `${role}.${exp}.${sig}`;
}

async function verifyToken(env: AuthEnv, token: string | null, kind: 'ticket' | 'session'): Promise<Role | null> {
  const key = signingKey(env);
  if (!token || !key) return null;
  const [role, expStr, sig] = token.split('.');
  if (!role || !expStr || !sig || !isRole(role)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return sig === (await sign(key, `${kind}.${role}.${exp}`)) ? role : null;
}

async function sign(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

export function loginPage(error = '', status = 200, selectedRole: Role = 'owner'): Response {
  const card = (role: Role, name: string) =>
    `<label class="role"><input type="radio" name="role" value="${role}"${role === selectedRole ? ' checked' : ''}><div><b>${name}</b></div></label>`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>逸品业务看板 · 登录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#0b0e1a}
body::before{content:'';position:fixed;inset:0;background:#e9e2d0 url(/fuchun-tile.jpg) repeat-x center/auto 100%;opacity:.55;z-index:0}
body::after{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 50% 120%,rgba(11,14,26,.25),rgba(11,14,26,.85));z-index:1}
.card{position:relative;z-index:2;width:min(430px,92vw);padding:40px 34px 30px;border-radius:18px;background:rgba(16,19,32,.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 60px rgba(0,0,0,.5);text-align:center}
h1{font-size:22px;font-weight:700;background:linear-gradient(120deg,#7dd3fc,#a78bfa,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:6px}
.sub{color:rgba(226,232,240,.55);font-size:13px;margin-bottom:22px}
.roles{display:flex;gap:10px;margin-bottom:18px}
.role{flex:1;cursor:pointer}
.role input{display:none}
.role div{padding:12px 6px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);transition:all .15s}
.role b{display:block;font-size:14px;color:#e2e8f0}
.role input:checked+div{border-color:#7dd3fc;background:rgba(125,211,252,.12);box-shadow:0 0 0 2px rgba(125,211,252,.25),0 0 18px rgba(125,211,252,.18)}
.role input:checked+div b{color:#7dd3fc}
input[type=password]{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#e2e8f0;font-size:15px;outline:none;text-align:center;letter-spacing:2px}
input[type=password]:focus{border-color:#7dd3fc;box-shadow:0 0 0 3px rgba(125,211,252,.18)}
button{width:100%;margin-top:16px;padding:12px;border:none;border-radius:10px;font-size:15px;font-weight:600;color:#0b0e1a;background:linear-gradient(120deg,#7dd3fc,#a78bfa);cursor:pointer}
button:hover{filter:brightness(1.1)}
.err{color:#fda4af;font-size:13px;margin-top:14px;min-height:18px}
</style></head><body>
<form class="card" method="POST" action="/login">
<h1>逸品业务看板</h1><p class="sub">选择身份，输入对应的访问密码</p>
<div class="roles">
${card('owner', '制作者')}
${card('advanced', '高级访问者')}
${card('viewer', '普通访问者')}
</div>
<input type="password" name="password" placeholder="访问密码" autofocus autocomplete="current-password" required>
<button type="submit">进入看板</button>
<div class="err">${error}</div>
</form></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
