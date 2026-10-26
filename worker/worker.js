// Cloudflare Worker：聊天测试页的 AI 分析代理
// 页面 POST { chat, local_score } → 返回 { text }
//
// 两种后端模式（自动选择）：
//   1) 中转站 / OpenAI 兼容接口：wrangler secret put RELAY_KEY，
//      wrangler.toml 里配 RELAY_URL / RELAY_MODEL
//   2) Cloudflare Workers AI（默认兜底）：wrangler.toml 的 [ai] binding，免费

const CF_MODEL = "@cf/qwen/qwen1.5-14b-chat-awq";
// Workers AI 中文备选："@cf/qwen/qwen1.5-7b-chat-awq"（更快更省额度）

const MAX_CHAT_LEN = 6000;
const MAX_BODY = 64 * 1024;
const PER_IP_LIMIT = 10;      // 单 IP 每天上限（宽松防刷，按 isolate 内存计，不精确但免费）
const hits = new Map();       // { ip: { day, n } }

const SYSTEM_PROMPT = `你是一个感情分析助手，帮用户判断"对方是不是喜欢自己"。
输入是一段聊天记录（"对方"=被分析的人，"自己"=用户）和一个本地规则算出的分数。

输出要求：
- 中文，一段连贯的话，120-180 字，不要列表、不要标题
- 像闺蜜/兄弟说真心话：直接、有温度、不灌鸡汤
- 引用 1-2 个聊天里的具体细节作为依据
- 指出对方态度里最真实的信号（好感/敷衍/养鱼都说实话）
- 结尾给一句可执行的小建议
- 娱乐向解读，不做绝对断言`;

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

// 模式 1：中转站 / OpenAI 兼容接口
async function callRelay(env, messages) {
  const r = await fetch(env.RELAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.RELAY_KEY,
    },
    body: JSON.stringify({
      model: env.RELAY_MODEL || "gpt-4o-mini",
      messages,
      max_tokens: 400,
      temperature: 0.7,
    }),
  });
  if (!r.ok) throw new Error("relay " + r.status);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || "").trim();
}

// 模式 2：Cloudflare Workers AI
async function callWorkersAI(env, messages) {
  const res = await env.AI.run(CF_MODEL, {
    messages,
    max_tokens: 400,
    temperature: 0.7,
  });
  return (res.response || "").trim();
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*", // 上线后改成你的 pages.dev 域名更安全
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ text: "chat-test-ai worker ok" }, 200, cors);

    // 宽松限流
    const ip = request.headers.get("cf-connecting-ip") || "anon";
    const today = new Date().toISOString().slice(0, 10);
    const rec = hits.get(ip);
    if (rec && rec.day === today && rec.n >= PER_IP_LIMIT) {
      return json({ text: "今天 AI 解读次数用完啦，明天再来，或先看本地分析结果~" }, 200, cors);
    }
    hits.set(ip, { day: today, n: (rec && rec.day === today ? rec.n : 0) + 1 });

    const len = +(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json({ error: "body too large" }, 413, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "bad json" }, 400, cors); }

    const chat = String(body.chat || "").slice(0, MAX_CHAT_LEN);
    if (chat.length < 20) return json({ error: "chat too short" }, 400, cors);

    const score = Number.isFinite(+body.local_score) ? Math.round(+body.local_score) : null;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `本地规则评分：${score ?? "未知"}/100\n\n聊天记录：\n${chat}` },
    ];

    let text = "";
    try {
      text = env.RELAY_URL && env.RELAY_KEY
        ? await callRelay(env, messages)
        : await callWorkersAI(env, messages);
    } catch (e) { /* 落到底下的兜底文案 */ }

    return json({ text: text || "AI 这次没说出个所以然，先看本地分析结果吧。" }, 200, cors);
  },
};
