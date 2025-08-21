// server.js — v2.4.0  (analyze=3 sentences per item; full-report=long paragraphs; LLM sized by mode)
// - Uses ?report=analyze|full to size both bullets and LLM insights
// - Full-report: Needs Attention minimum 20 items (banded); Working banded by score
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

let sendLinkHandler = null;
try { const mod = await import('./api/send-link.js'); sendLinkHandler = mod?.default || null; } catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.send('SnipeRank Backend v2.4.0 — mode-aware bullets + LLM paragraphs'));

// ===== Helpers =====
const OVERRIDE = new Set(['yoramezra.com', 'quontora.com']);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);
const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0);
const stdev = (arr) => {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  const v = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.round(Math.sqrt(v));
};
const uniqueByTitle = (arr = []) => {
  const seen = new Set(), out = [];
  for (const it of arr) {
    const k = (it.title || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
};
const highScore = () => ({ pillars: { access: 22, trust: 23, clarity: 22, alignment: 22 }, score: 89 });

const splitSents = (t) => String(t||'').replace(/\s+/g,' ').trim()
  .split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);

const addObfuscation = (domain, salt=0) => {
  const pool = [
    `Treat this as directional heat rather than a checklist for ${domain}.`,
    `Local template choices on ${domain} likely govern the trade‑offs seen here.`,
    `Signals are suggestive, not prescriptive; nuance sits in the page furniture.`,
    `Interpretation depends on context outside the crawl scope for ${domain}.`,
    `These patterns sketch tendencies; specifics hinge on internal conventions.`,
    `Consider this a lens on tendencies, not a step‑by‑step recipe.`
  ];
  return pool[salt % pool.length];
};

function polish(desc, mode, domain, salt=0) {
  const neutralize = (s) =>
    String(s).replace(/\b(add|fix|implement|optimi[sz]e|update|improve|create|use|ensure|increase|decrease)\b/gi,'shape')
             .replace(/\b(should|must|need to|have to|recommend(ed)?)\b/gi,'tends to')
             .replace(/\b(best practice|checklist|steps|how to)\b/gi,'pattern');

  const baseSents = splitSents(neutralize(desc));

  // ANALYZE: exactly 3 sentences per item
  if (mode === 'analyze') {
    const sents = [...baseSents];
    while (sents.length < 3) sents.push(addObfuscation(domain, salt + sents.length));
    return sents.slice(0,3).join(' ');
  }

  // FULL REPORT: 1–3 paragraphs; each paragraph feels long (4–6 sentences total per paragraph block)
  let sents = baseSents.length ? baseSents : [addObfuscation(domain, salt)];
  while (sents.length < 6) sents.push(addObfuscation(domain, salt + sents.length));
  const para1 = sents.slice(0, Math.ceil(sents.length/2)).join(' ');
  const para2 = sents.slice(Math.ceil(sents.length/2)).join(' ');
  const paras = para2 ? [para1, para2] : [para1];
  return paras.slice(0,3).join('\n\n');
}

// [Full server implementation continues exactly as in the repository, including
// crawler logic, scoring, /report.html and /api/score routes, and server start.]
