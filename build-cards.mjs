// 由 Matt-Pocock-套件詳解.md 產生 TCG 卡冊的詳解資料。
// 用法：node build-cards.mjs      （改完 md 後重跑即可）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const MD = path.join(dir, "Matt-Pocock-套件詳解.md");
const HTML = path.join(dir, "matt-tcg-cards.html");

const KEY = {
  一句話: "one",
  解決什麼病: "disease",
  運作機制: "mech",
  產出: "output",
  使用時機: "when",
  別搞混: "confuse",
  後續接著: "next",
};
const LABEL_RE = /^\*\*(一句話|解決什麼病|運作機制|產出|使用時機|別搞混|後續接著)\*\*(.*)$/;

// ---------- 1. parse markdown ----------
const lines = fs.readFileSync(MD, "utf8").split(/\r?\n/);
const skills = new Map();
let cur = null;
let field = null;

for (const line of lines) {
  const h = line.match(/^## `([^`]+)`/);
  if (h) {
    cur = { name: h[1], fields: {} };
    skills.set(h[1], cur);
    field = null;
    continue;
  }
  if (!cur) continue;
  if (/^#\s/.test(line) || /^---\s*$/.test(line)) {
    field = null;
    continue;
  }
  const m = line.match(LABEL_RE);
  if (m) {
    const key = KEY[m[1]];
    let rest = m[2];
    let hint = "";
    const hm = rest.match(/^（([^）]*)）\s*[：:]/);
    if (hm) {
      hint = hm[1];
      rest = rest.slice(hm[0].length);
    } else {
      rest = rest.replace(/^\s*[：:]\s*/, "").replace(/^\s*——\s*/, "");
    }
    cur.fields[key] = { hint, lines: [rest] };
    field = cur.fields[key];
    continue;
  }
  if (field) field.lines.push(line);
}

// ---------- 2. markdown-lite -> html ----------
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

function render(src) {
  const ls = src.split(/\r?\n/);
  const tokens = [];
  let i = 0;

  while (i < ls.length) {
    const line = ls[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    const mUl = t.match(/^[-*]\s+(.*)$/);
    const mOl = t.match(/^(\d+)\.\s+(.*)$/);

    if (mUl || mOl) {
      let text = mUl ? mUl[1] : mOl[2];
      const num = mUl ? null : Number(mOl[1]);
      let j = i + 1;
      while (j < ls.length) {
        const lt = ls[j].trim();
        if (!lt) break;
        if (/^\s*(?:[-*]|\d+\.)\s+/.test(ls[j])) break;
        if (/^\s{2,}\S/.test(ls[j])) {
          text += " " + lt;
          j++;
          continue;
        }
        break;
      }
      tokens.push({ kind: num === null ? "ul" : "ol", num, text });
      i = j;
      continue;
    }

    const para = [t];
    let j = i + 1;
    while (j < ls.length) {
      const lt = ls[j].trim();
      if (!lt) break;
      if (/^\s*(?:[-*]|\d+\.)\s+/.test(ls[j])) break;
      para.push(lt);
      j++;
    }
    tokens.push({ kind: "p", text: para.join(" ") });
    i = j;
  }

  const out = [];
  let k = 0;
  while (k < tokens.length) {
    const tk = tokens[k];
    if (tk.kind === "p") {
      out.push(`<p>${inline(tk.text)}</p>`);
      k++;
      continue;
    }
    if (tk.kind === "ul") {
      const items = [];
      while (k < tokens.length && tokens[k].kind === "ul") items.push(tokens[k++].text);
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
      continue;
    }
    const start = tokens[k].num;
    const items = [];
    while (k < tokens.length && tokens[k].kind === "ol") items.push(tokens[k++].text);
    const attr = start !== 1 ? ` start="${start}"` : "";
    out.push(`<ol${attr}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
  }
  return out.join("\n");
}

// ---------- 3. build payload ----------
const payload = {};
for (const [name, s] of skills) {
  const o = {};
  for (const [label, key] of Object.entries(KEY)) {
    const f = s.fields[key];
    if (!f) continue;
    const html = render(f.lines.join("\n").trim());
    if (html) o[key] = html;
    if (f.hint) o[key + "Hint"] = f.hint;
  }
  payload[name] = o;
}

// ---------- 4. inject ----------
let html = fs.readFileSync(HTML, "utf8");
const block =
  "/*DETAILS_START*/\nconst DETAILS = " +
  JSON.stringify(payload) +
  ";\n/*DETAILS_END*/";

const before = html;
html = html.replace(/\/\*DETAILS_START\*\/[\s\S]*?\/\*DETAILS_END\*\//, () => block);
if (html === before) {
  console.error("✗ 找不到 /*DETAILS_START*/…/*DETAILS_END*/ 標記");
  process.exit(1);
}
fs.writeFileSync(HTML, html);

// ---------- 5. report ----------
const cardNames = [...html.matchAll(/\{id:"MT-\d+", name:"([^"]+)"/g)].map((m) => m[1]);
const missingInMd = cardNames.filter((n) => !payload[n]);
const noField = [...skills].filter(([, s]) => Object.keys(s.fields).length < 7);

console.log(`解析 skill：${skills.size}`);
console.log(`卡片：${cardNames.length}`);
console.log(`詳解缺漏：${missingInMd.length ? missingInMd.join(", ") : "無"}`);
if (noField.length) {
  console.log("七欄不完整：");
  for (const [n, s] of noField) {
    const lack = Object.entries(KEY)
      .filter(([, k]) => !s.fields[k])
      .map(([l]) => l);
    console.log(`  - ${n}：缺 ${lack.join("、")}`);
  }
}
const kb = (fs.statSync(HTML).size / 1024).toFixed(1);
console.log(`已寫入 ${path.basename(HTML)}（${kb} KB）`);
