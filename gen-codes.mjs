// 激活码生成器：node gen-codes.mjs [数量] [盐]
// 盐必须和 index.html 里的 CODE_SALT 一致
// 用法：node gen-codes.mjs 50 crush2026 > codes.txt
const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const n = parseInt(process.argv[2] || "20", 10);
const SALT = process.argv[3] || "crush2026";

function hash(s){
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  let out = "";
  for (let i = 0; i < 4; i++){ out += ABC[h % 32]; h = Math.floor(h / 32); }
  return out;
}
const rand4 = () => Array.from({length:4}, () => ABC[Math.floor(Math.random()*32)]).join("");

const seen = new Set();
while (seen.size < n){
  const body = rand4();
  const code = `HT-${body}-${hash(body + SALT)}`;
  seen.add(code);
}
console.log([...seen].join("\n"));
