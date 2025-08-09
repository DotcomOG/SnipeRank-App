/**
 * SnipeRank Server
 * Version: 1.9.15-ssr
 * Last Updated: 2025-08-09
 *
 * Changes:
 * - FIX: Cheerio ESM import (use `import * as cheerio from 'cheerio'`)
 * - Use Node 22 native fetch (no node-fetch)
 * - Keeps server-side enforcement: "Needs Attention" = exactly 10 items, 2–4 sentences each, deduped
 */

import express from "express";
import cors from "cors";
import compression from "compression";
import * as cheerio from "cheerio"; // <-- important: namespace import for ESM

const app = express();
const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ALLOW_ORIGIN || "*";
const UPSTREAM = process.env.UPSTREAM_REPORT_ENDPOINT || ""; // e.g., https://your-service/report.html
const WEBHOOK = process.env.WEBHOOK_URL || ""; // optional email/webhook handler

app.use(cors({ origin: ORIGIN }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

/**
 * Normalize the "Needs Attention" section in an HTML string.
 * Rules:
 *  - Exactly 10 <li> items
 *  - Each item is 2–4 sentences (we produce 3)
 *  - Deduplicate by case-insensitive title (text before first ':')
 */
function enforceNeedsAttention(html) {
  try {
    const $ = cheerio.load(html);

    // Find a header that marks the Needs Attention section
    const $header = $("h1,h2,h3,h4,.section-title")
      .filter((_, el) => /needs\s+attention/i.test($(el).text() || ""))
      .first();

    if (!$header.length) return $.html();

    // Find or create the first UL after the header
    let $ul = $header.next();
    while ($ul.length && $ul[0].tagName && $ul[0].tagName.toLowerCase() !== "ul") {
      $ul = $ul.next();
    }
    if (!$ul.length) {
      $ul = $("<ul></ul>");
      $header.after($ul);
    }

    const fallbackPool = [
      "Topic focus clarity","Internal connection mapping","Result framing signal",
      "Visual descriptor cadence","Entity signaling layer","Experience smoothness",
      "Contextual layout fit","Snippet readiness","Navigation cue consistency",
      "Cross-surface coherence","Canonical intent clarity","Template parity"
    ];

    const seen = new Set();
    const items = [];

    const makeText = (label) => {
      // 3 safe sentences (within 2–4 constraint)
      const s = [
        `${label}: signal variance detected across key surfaces.`,
        `Guidance is directional and intended for scoping; implementation specifics will be provided during the guided session.`,
        `Observed patterns indicate prioritization rather than immediate execution detail.`
      ];
      return s.join(" ");
    };

    const makeLI = (title, label) =>
      `<li><strong>${title}:</strong> ${makeText(label)}</li>`;

    // Use existing <li> items, rewrite & dedupe
    $ul.find("li").each((_, li) => {
      const raw = $(li).text().trim();
      const title = (raw.split(":")[0] || "").trim() || "Signal coherence";
      const key = title.toLowerCase();
      if (seen.has(key)) return;

      const label =
        /h1|heading/i.test(raw) ? "Topic focus clarity" :
        /link/i.test(raw) ? "Internal connection mapping" :
        /meta|description/i.test(raw) ? "Result framing signal" :
        /alt|image/i.test(raw) ? "Visual descriptor cadence" :
        /schema|structured/i.test(raw) ? "Entity signaling layer" :
        /speed|core web vitals|lcp|cls|inp/i.test(raw) ? "Experience smoothness" :
        /mobile|responsive/i.test(raw) ? "Contextual layout fit" :
        /faq|snippet|answer/i.test(raw) ? "Snippet readiness" :
        /nav|menu|ia/i.test(raw) ? "Navigation cue consistency" :
        "Cross-surface coherence";

      items.push(makeLI(title, label));
      seen.add(key);
    });

    // Pad to exactly 10
    let padIdx = 0;
    while (items.length < 10) {
      const label = fallbackPool[padIdx % fallbackPool.length];
      let title = label;
      let key = title.toLowerCase();
      if (seen.has(key)) {
        title = `${label} (site-wide ${padIdx + 1})`;
        key = title.toLowerCase();
      }
      items.push(makeLI(title, label));
      seen.add(key);
      padIdx++;
    }

    // Trim to exactly 10
    const normalized = items.slice(0, 10).join("");

    // Replace UL content
    $ul.empty().append(normalized);

    return $.html();
  } catch (e) {
    console.error("enforceNeedsAttention error:", e);
    return html; // fail-open
  }
}

/**
 * Optional: fetch upstream raw report HTML and normalize.
 * Uses native fetch in Node 22.
 */
async function fetchUpstreamReport(url) {
  const endpoint = `${UPSTREAM}?url=${encodeURIComponent(url)}`;
  const res = await fetch(endpoint, { headers: { "Accept": "text/html" } });
  if (!res.ok) throw new Error(`Upstream error ${res.status}`);
  return await res.text();
}

/**
 * Minimal local fallback HTML (for local test / if no upstream set).
 * Intentionally provides 8 short items to demonstrate server-side normalization.
 */
function buildLocalReport(url) {
  return `
    <section>
      <h2 class="section-title">Needs Attention</h2>
      <ul>
        <li>Headings</li>
        <li>Meta descriptions</li>
        <li>Internal links</li>
        <li>Alt text</li>
        <li>Schema usage</li>
        <li>Core Web Vitals</li>
        <li>Mobile layout</li>
        <li>FAQ coverage</li>
      </ul>
    </section>
    <section>
      <h2 class="section-title">What’s Working</h2>
      <ul><li>Solid HTTPS and redirects</li></ul>
    </section>
  `;
}

/* ---------------------------------------------
   Routes
--------------------------------------------- */

app.get("/report.html", async (req, res) => {
  const targetUrl = (req.query.url || "").toString();
  if (!targetUrl) return res.status(400).send("Missing url param");

  try {
    let html;
    if (UPSTREAM) {
      html = await fetchUpstreamReport(targetUrl);
    } else {
      html = buildLocalReport(targetUrl);
    }

    const normalized = enforceNeedsAttention(html);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(normalized);
  } catch (err) {
    console.error("report.html error:", err);
    res
      .status(500)
      .send(`<p style="color:red;text-align:center">Server error building report.</p>`);
  }
});

// Optional: keep your existing send-link flow working
app.post("/api/send-link", async (req, res) => {
  try {
    if (WEBHOOK) {
      const r = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
      });
      if (!r.ok) throw new Error(`Webhook ${r.status}`);
    } else {
      // No webhook configured — succeed anyway so frontend can redirect
      console.warn("WEBHOOK_URL not set — /api/send-link will no-op with success:true");
    }
    res.json({ success: true });
  } catch (e) {
    console.error("/api/send-link error:", e);
    res.status(500).json({ success: false, error: "delivery_failed" });
  }
});

/* --------------------------------------------- */

app.get("/health", (_, res) => res.json({ ok: true }));
app.listen(PORT, () => {
  console.log(`SnipeRank server running on :${PORT}`);
  if (!UPSTREAM) console.log("UPSTREAM_REPORT_ENDPOINT not set — using local fallback for /report.html");
});
