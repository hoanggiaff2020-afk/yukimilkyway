// Bảng Ủy Thác - API chạy trên Netlify Functions, dữ liệu lưu bằng Netlify Blobs.
// Mọi kiểm tra quyền (Chủ / Admin / Thành viên) nằm ở đây, không nằm ở giao diện.
import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

// Kho dữ liệu: ưu tiên đọc/ghi "strong"; nếu môi trường không hỗ trợ thì tự lùi về chế độ thường.
// Nếu Netlify không tự cấu hình Blobs, đặt biến môi trường BLOBS_SITE_ID và BLOBS_TOKEN (xem README).
let strong = true, curStore = null;
const mkStore = () => getStore({
  name: "bang-uy-thac",
  ...(process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN ? { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN } : {}),
  ...(strong ? { consistency: "strong" } : {})
});
const run = async fn => {
  try { return await fn(curStore || (curStore = mkStore())); }
  catch (e) {
    if (strong && /consistency|uncached/i.test(String(e && e.message))) { strong = false; curStore = mkStore(); return fn(curStore); }
    throw e;
  }
};
const store = { get: (...a) => run(s => s.get(...a)), set: (...a) => run(s => s.set(...a)), setJSON: (...a) => run(s => s.setJSON(...a)), delete: (...a) => run(s => s.delete(...a)), list: (...a) => run(s => s.list(...a)) };
const WK = ["TRANS", "REDRAW", "TYPE"], PAL = ["#b9473f", "#6f8796", "#c28b6b", "#8aa07a", "#b88aa8", "#9b8f6a", "#7a86b0"];
const uid = () => crypto.randomBytes(5).toString("hex");
let touched = false, SECRET = process.env.SESSION_SECRET || null;

// ---- lưu trữ: mỗi bản ghi là một blob "bảng/id"
const key = (t, id) => `${t}/${id}`;
const get = async (t, id) => { const v = await store.get(key(t, id), { type: "json" }); return v ? { id: String(id), ...v } : null; };
async function keys(t, prefix = "") { const r = await store.list({ prefix: `${t}/${prefix}` }); return r.blobs.map(b => b.key).sort(); }
async function all(t, { prefix = "", last = 0 } = {}) {
  let ks = await keys(t, prefix); if (last) ks = ks.slice(-last);
  const out = await Promise.all(ks.map(async k => { const v = await store.get(k, { type: "json" }); return v ? { id: k.slice(t.length + 1), ...v } : null; }));
  return out.filter(Boolean);
}
const put = async (t, o) => { const { id, ...d } = o; await store.setJSON(key(t, id), d); touched = true; };
const del = async (t, id) => { await store.delete(key(t, id)); touched = true; };
const log = async x => {
  await put("logs", { id: `${Date.now()}-${uid()}`, x, ts: Date.now() });
  if (Math.random() < 0.05) { const ks = await keys("logs"); if (ks.length > 600) await Promise.all(ks.slice(0, ks.length - 500).map(k => store.delete(k))); }
};
const notify = async (ids, x, rid, except) => {
  for (const i of [...new Set(ids)]) if (i && i !== except && await get("users", i)) await put("notifs", { id: `${i}/${Date.now()}-${uid()}`, to: i, x, rid: rid || null, read: false, ts: Date.now() });
};
const staffIds = async () => (await all("users")).filter(u => u.role !== "MEMBER" && u.on).map(u => u.id);
const memIds = async () => (await all("users")).filter(u => u.role === "MEMBER" && u.on).map(u => u.id);
const pub = u => ({ id: u.id, name: u.name, username: u.username, role: u.role, color: u.color, avatar: u.avatar || null, on: u.on });
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const url = v => /^https?:\/\/\S+$/i.test(String(v || "").trim()) ? String(v).trim().slice(0, 500) : "";
const imgOk = (v, n) => typeof v === "string" && /^data:image\/(jpeg|png|webp|gif);base64,/.test(v) && v.length <= n ? v : null;
const unameOk = u => /^[a-z0-9_.-]{3,30}$/.test(u);

// ---- phiên đăng nhập (cookie ký HMAC)
async function secret() {
  if (SECRET) return SECRET;
  let s = await store.get("secret"); if (!s) { s = crypto.randomBytes(32).toString("hex"); await store.set("secret", s); }
  return (SECRET = s);
}
const sign = async s => crypto.createHmac("sha256", await secret()).update(s).digest("hex");
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookie = (v, age) => `bq=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const J = (status, obj, ck) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(ck ? { "Set-Cookie": ck } : {}) } });
const bad = (m, c = 400) => J(c, { error: m });
const login_ok = async uid_ => { const exp = Date.now() + 30 * 864e5; return cookie(`${uid_}.${exp}.${await sign(uid_ + "." + exp)}`, 30 * 86400); };
async function rateLimited(ip, add) {
  const k = "rl/" + String(ip).replace(/[^0-9a-f:.]/gi, "_"), now = Date.now();
  const r = ((await store.get(k, { type: "json" })) || { t: [] }).t.filter(t => now - t < 6e5);
  if (add) { r.push(now); await store.setJSON(k, { t: r }); }
  return r.length >= 10;
}

// ---- router nhỏ
const routes = [];
const route = (m, p, ...h) => routes.push([m, new RegExp("^/api" + p.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$"), h]);
const auth = c => c.u ? undefined : bad("Bạn chưa đăng nhập", 401);
const stf = c => c.u && c.u.role !== "MEMBER" ? undefined : bad("Bạn không có quyền", 403);
const canManage = (me, t) => t && t.role !== "OWNER" && (me.role === "OWNER" || t.role === "MEMBER");

route("GET", "/state", async c => {
  if (!c.u) return J(200, { anon: 1, setup: (await keys("users")).length === 0 });
  const rev = Number(await store.get("rev")) || 0;
  if (Number(c.query.get("since")) === rev && rev) return J(200, { same: 1 });
  const staff = c.u.role !== "MEMBER";
  const [users, reqs, notes, notifs, logs] = await Promise.all([all("users"), all("reqs"), all("notes"), all("notifs", { prefix: c.u.id + "/", last: 60 }), staff ? all("logs", { last: 150 }) : []]);
  return J(200, { rev, me: pub(c.u), users: users.map(pub), reqs, notes, notifs: notifs.sort((a, b) => b.ts - a.ts), logs: logs.sort((a, b) => b.ts - a.ts) });
});
route("POST", "/setup", async c => {
  if ((await keys("users")).length) return bad("Đã thiết lập rồi", 403);
  const b = c.body, name = str(b.name, 40), username = str(b.username, 30).toLowerCase(), pw = String(b.password || "");
  if (!name || !unameOk(username) || pw.length < 6) return bad("Tên đăng nhập 3-30 ký tự (a-z, 0-9, _ . -), mật khẩu từ 6 ký tự");
  const u = { id: uid(), name, username, hash: bcrypt.hashSync(pw, 10), role: "OWNER", color: PAL[0], on: true, ts: Date.now() };
  await put("users", u); await log(`${name} khởi tạo bảng ủy thác.`); return J(200, { ok: 1 }, await login_ok(u.id));
});
route("POST", "/login", async c => {
  if (await rateLimited(c.ip, false)) return bad("Thử quá nhiều lần, vui lòng đợi 10 phút", 429);
  const un = str(c.body.username, 30).toLowerCase(), u = (await all("users")).find(x => x.username === un);
  if (!u || !bcrypt.compareSync(String(c.body.password || ""), u.hash)) { await rateLimited(c.ip, true); return bad("Sai tài khoản hoặc mật khẩu", 401); }
  if (!u.on) return bad("Tài khoản đã bị khóa", 403);
  return J(200, { ok: 1 }, await login_ok(u.id));
});
route("POST", "/logout", async () => J(200, { ok: 1 }, cookie("", 0)));
route("PUT", "/me", auth, async c => {
  const u = c.u, b = c.body;
  if (b.name !== undefined) { const n = str(b.name, 40); if (!n) return bad("Tên không được trống"); u.name = n; }
  if (b.avatar !== undefined) u.avatar = imgOk(b.avatar, 80000);
  if (b.newPassword) {
    if (String(b.newPassword).length < 6) return bad("Mật khẩu từ 6 ký tự");
    if (!bcrypt.compareSync(String(b.oldPassword || ""), u.hash)) return bad("Mật khẩu hiện tại chưa đúng");
    u.hash = bcrypt.hashSync(String(b.newPassword), 10);
  }
  await put("users", u); return J(200, { ok: 1 });
});

// ---- ủy thác
function cleanReq(b, old) {
  const wanted = Array.isArray(b.works) ? b.works : [];
  return { title: str(b.title, 200), chap: str(b.chap, 100), desc: str(b.desc, 5000), dl: str(b.dl, 30), folder: str(b.folder, 200), folderUrl: url(b.folderUrl), doc: url(b.doc), works: WK.filter(k => wanted.includes(k) || (old && old["t" + k])), img: imgOk(b.img, 400000) };
}
const reqErr = d => !d.title || isNaN(new Date(d.dl)) ? bad("Cần tiêu đề và deadline hợp lệ") : !d.works.length ? bad("Chọn ít nhất 1 công việc") : null;
route("POST", "/reqs", auth, stf, async c => {
  const d = cleanReq(c.body), e = reqErr(d); if (e) return e;
  d.id = uid(); d.no = Math.max(0, ...(await all("reqs")).map(r => r.no || 0)) + 1; d.h = Math.floor(Math.random() * 360); d.ts = Date.now();
  await put("reqs", d); await log(`${c.u.name} tạo ${d.chap || d.title}.`); await notify(await memIds(), `Ủy thác mới: ${d.title}`, d.id, c.u.id); return J(200, { ok: 1, id: d.id });
});
route("PUT", "/reqs/:id", auth, stf, async c => {
  const r = await get("reqs", c.params.id); if (!r) return bad("Không tìm thấy", 404);
  const d = cleanReq(c.body, r), e = reqErr(d); if (e) return e;
  WK.forEach(k => { if (!d.works.includes(k)) r["t" + k] = null; });
  await put("reqs", { ...r, ...d }); await log(`${c.u.name} sửa ${d.chap || d.title}.`); return J(200, { ok: 1 });
});
route("DELETE", "/reqs/:id", auth, stf, async c => {
  const r = await get("reqs", c.params.id); if (!r) return bad("Không tìm thấy", 404);
  for (const n of (await all("notes")).filter(n => n.rid === r.id)) await del("notes", n.id);
  await del("reqs", r.id); await log(`${c.u.name} xóa ${r.chap || r.title}.`); return J(200, { ok: 1 });
});
route("POST", "/seed", auth, stf, async c => {
  let n = Math.max(0, ...(await all("reqs")).map(r => r.no || 0));
  for (const [title, chap, h, d] of [["Hoa Rơi Cuối Hạ", "Chapter 25", 30, 3], ["Kiếm Sĩ Vô Danh", "Chapter 26", 190, 6], ["Tiệm Trà Sau Mưa", "Chapter 27", 160, 9]])
    await put("reqs", { id: uid(), no: ++n, title, chap, desc: "Ủy thác mẫu, bạn có thể sửa hoặc xóa.", dl: new Date(Date.now() + d * 864e5).toISOString().slice(0, 10) + "T23:59", folder: "Manga Project - " + chap, folderUrl: "", doc: "", works: [...WK], img: null, h, ts: Date.now() });
  return J(200, { ok: 1 });
});
async function withTask(c, fn) {
  const r = await get("reqs", c.params.id), k = c.params.k;
  if (!r) return bad("Không tìm thấy", 404);
  if (!WK.includes(k) || !(r.works || []).includes(k)) return bad("Công việc không tồn tại");
  return fn(r, k, r["t" + k] || null);
}
route("POST", "/reqs/:id/:k/claim", auth, c => withTask(c, async (r, k, t) => {
  if (c.u.role !== "MEMBER") return bad("Chỉ thành viên mới nhận việc", 403);
  if (t) return bad("Phần này đã có người nhận", 409);
  r["t" + k] = { u: c.u.id, p: 0, at: Date.now() }; await put("reqs", r);
  await log(`${c.u.name} nhận ${k} của ${r.chap}.`); await notify(await staffIds(), `${r.chap} — ${c.u.name} đã nhận ${k}`, r.id, c.u.id); return J(200, { ok: 1 });
}));
route("POST", "/reqs/:id/:k/progress", auth, c => withTask(c, async (r, k, t) => {
  if (!t) return bad("Chưa có người nhận");
  if (t.u !== c.u.id && c.u.role === "MEMBER") return bad("Đây không phải việc của bạn", 403);
  const p = Math.max(0, Math.min(100, Math.round(Number(c.body.p)))); if (isNaN(p)) return bad("Tiến độ không hợp lệ");
  t.p = p; if (p >= 100) t.done = Date.now(); else delete t.done; r["t" + k] = t; await put("reqs", r);
  const who = await get("users", t.u); await log(`${c.u.name} cập nhật ${k} ${r.chap} → ${p}%.`);
  await notify(await staffIds(), `${r.chap} — ${who ? who.name : "?"} ${p >= 100 ? "đã hoàn thành" : "cập nhật"} ${k} ${p}%`, r.id, c.u.id); return J(200, { ok: 1 });
}));
route("POST", "/reqs/:id/:k/drop", auth, c => withTask(c, async (r, k, t) => {
  if (!t) return bad("Chưa có người nhận");
  if (t.u !== c.u.id && c.u.role === "MEMBER") return bad("Đây không phải việc của bạn", 403);
  r["t" + k] = null; await put("reqs", r); await log(`${c.u.name} ${t.u === c.u.id ? "trả lại" : "gỡ người nhận"} ${k} của ${r.chap}.`);
  if (t.u !== c.u.id) await notify([t.u], `${r.chap} — ${k} đã được gỡ khỏi bạn`, r.id); else await notify(await staffIds(), `${r.chap} — ${c.u.name} trả lại ${k}`, r.id, c.u.id);
  return J(200, { ok: 1 });
}));
route("POST", "/reqs/:id/notes", auth, async c => {
  const r = await get("reqs", c.params.id); if (!r) return bad("Không tìm thấy", 404);
  const x = str(c.body.x, 2000), k = c.body.k === "GENERAL" || (r.works || []).includes(c.body.k) ? c.body.k : "GENERAL";
  if (!x) return bad("Note trống");
  await put("notes", { id: uid(), rid: r.id, k, u: c.u.id, x, ts: Date.now() });
  await notify([...(await staffIds()), ...(r.works || []).map(w => r["t" + w] && r["t" + w].u)], `${r.chap} — ${c.u.name} đã thêm note`, r.id, c.u.id); return J(200, { ok: 1 });
});
route("POST", "/notifs/read", auth, async c => {
  for (const n of (await all("notifs", { prefix: c.u.id + "/" })).filter(n => !n.read)) await put("notifs", { ...n, read: true });
  return J(200, { ok: 1 });
});

// ---- thành viên
route("POST", "/users", auth, stf, async c => {
  const b = c.body, name = str(b.name, 40), username = str(b.username, 30).toLowerCase(), pw = String(b.password || ""), role = b.role === "ADMIN" ? "ADMIN" : "MEMBER";
  if (role === "ADMIN" && c.u.role !== "OWNER") return bad("Chỉ Chủ mới tạo được Admin", 403);
  if (!name || !unameOk(username) || pw.length < 6) return bad("Tên đăng nhập 3-30 ký tự (a-z, 0-9, _ . -), mật khẩu từ 6 ký tự");
  const us = await all("users"); if (us.some(u => u.username === username)) return bad("Tên đăng nhập đã tồn tại", 409);
  await put("users", { id: uid(), name, username, hash: bcrypt.hashSync(pw, 10), role, color: PAL[us.length % PAL.length], avatar: imgOk(b.avatar, 80000), on: true, ts: Date.now() });
  await log(`${c.u.name} tạo tài khoản ${name}.`); return J(200, { ok: 1 });
});
route("PUT", "/users/:id", auth, stf, async c => {
  const t = await get("users", c.params.id); if (!canManage(c.u, t)) return bad("Bạn không có quyền sửa tài khoản này", 403);
  const b = c.body;
  if (b.name !== undefined) { const n = str(b.name, 40); if (!n) return bad("Tên không được trống"); t.name = n; }
  if (b.username !== undefined) { const un = str(b.username, 30).toLowerCase(); if (!unameOk(un)) return bad("Tên đăng nhập không hợp lệ"); if ((await all("users")).some(u => u.username === un && u.id !== t.id)) return bad("Tên đăng nhập đã tồn tại", 409); t.username = un; }
  if (b.role !== undefined) { if (b.role === "ADMIN" && c.u.role !== "OWNER") return bad("Chỉ Chủ mới đặt được Admin", 403); t.role = b.role === "ADMIN" ? "ADMIN" : "MEMBER"; }
  if (b.avatar !== undefined) t.avatar = imgOk(b.avatar, 80000);
  if (b.password) { if (String(b.password).length < 6) return bad("Mật khẩu từ 6 ký tự"); t.hash = bcrypt.hashSync(String(b.password), 10); }
  await put("users", t); await log(`${c.u.name} sửa tài khoản ${t.name}.`); return J(200, { ok: 1 });
});
route("POST", "/users/:id/lock", auth, stf, async c => {
  const t = await get("users", c.params.id); if (!canManage(c.u, t) || t.id === c.u.id) return bad("Bạn không có quyền", 403);
  t.on = !t.on; await put("users", t); await log(`${c.u.name} ${t.on ? "mở khóa" : "khóa"} tài khoản ${t.name}.`); return J(200, { ok: 1 });
});
route("DELETE", "/users/:id", auth, stf, async c => {
  const t = await get("users", c.params.id); if (!canManage(c.u, t) || t.id === c.u.id) return bad("Bạn không có quyền", 403);
  for (const r of await all("reqs")) { let ch = false; WK.forEach(k => { const x = r["t" + k]; if (x && x.u === t.id && x.p < 100) { r["t" + k] = null; ch = true; } }); if (ch) await put("reqs", r); }
  for (const k of await keys("notifs", t.id + "/")) await store.delete(k);
  await del("users", t.id); await log(`${c.u.name} xóa tài khoản ${t.name}.`); return J(200, { ok: 1 });
});

export default async (req, context) => {
  touched = false;
  try {
    const u = new URL(req.url), path = u.pathname;
    if (req.method !== "GET" && !(req.headers.get("content-type") || "").includes("application/json")) return bad("Yêu cầu không hợp lệ", 415);
    let user = null;
    const ck = (req.headers.get("cookie") || "").split(/;\s*/).find(x => x.startsWith("bq="));
    if (ck) { const [id, exp, sig] = ck.slice(3).split("."); if (sig && Number(exp) > Date.now() && safeEq(sig, await sign(id + "." + exp))) { const x = await get("users", id); if (x && x.on) user = x; } }
    let body = {}; if (req.method !== "GET") { try { body = await req.json(); } catch { body = {}; } }
    for (const [m, re, hs] of routes) {
      if (m !== req.method) continue;
      const mt = path.match(re); if (!mt) continue;
      const c = { u: user, body, params: mt.groups || {}, query: u.searchParams, ip: context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown" };
      for (const h of hs) { const r = await h(c); if (r) { if (touched) await store.set("rev", String(Date.now())); return r; } }
    }
    return bad("Không tìm thấy", 404);
  } catch (e) {
    console.error(e); return bad("Lỗi máy chủ: " + String((e && (e.name + " - " + e.message)) || e).slice(0, 300), 500);
  }
};
