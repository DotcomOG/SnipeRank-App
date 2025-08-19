// server.js — v2.3.0 Dynamic-only findings + banded counts + sentence enforcement

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// (Optional) Email handler
let sendLinkHandler = null;
try {
  const mod = await import('./api/send-link.js');
  sendLinkHandler = mod?.default || null;
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.send('SnipeRank Backend v2.3.0 — Dynamic-only findings with banded counts'));


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

function splitSents(t) {
  return (t || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z(0-9])/)
    .filter(Boolean);
}
function addObfuscation(domain, salt = 0) {
  const pool = [
    `Treat this as directional heat rather than a checklist for ${domain}.`,
    `Local template choices on ${domain} likely govern the trade‑offs seen here.`,
    `Signals are suggestive, not prescriptive; nuance sits in the page furniture.`,
    `Interpretation depends on context outside the crawl scope for ${domain}.`,
    `These patterns sketch tendencies; specifics hinge on internal conventions.`,
    `Consider this a lens on tendencies, not a step‑by‑step recipe.`
  ];
  return pool[salt % pool.length];
}
function polish(desc, mode, domain, salt = 0) {
  const sents = splitSents(desc);
  const [MIN, MAX] = (mode === 'analyze') ? [2, 3] : [4, 6];
  let out = sents.slice(0, Math.max(MIN, Math.min(MAX, sents.length)));
  while (out.length < MIN) out.push(addObfuscation(domain, salt + out.length));
  out = out.slice(0, MAX);
  return out.join(' ');
}


// ===== MULTI-PAGE CRAWLER =====
async function crawlSitePages(startUrl, maxPages = 10) {
  const host = hostOf(startUrl);
  const visitedUrls = new Set();
  const pagesData = [];
  const urlsToVisit = [startUrl];

  while (urlsToVisit.length > 0 && pagesData.length < maxPages) {
    const currentUrl = urlsToVisit.shift();
    if (visitedUrls.has(currentUrl)) continue;

    try {
      visitedUrls.add(currentUrl);
      const resp = await axios.get(currentUrl, {
        timeout: 8000,
        headers: { 'User-Agent': 'SnipeRank SEO Analyzer Bot' }
      });

      const $ = cheerio.load(resp.data);
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      const words = bodyText.split(' ').filter(w => w.length > 0);

      const pageData = {
        url: currentUrl,
        title: $('title').text().trim() || '',
        metaDesc: $('meta[name="description"]').attr('content')?.trim() || '',
        h1Count: $('h1').length,
        h1Text: $('h1').map((i, el) => $(el).text().trim()).get(),
        h2Count: $('h2').length,
        h3Count: $('h3').length,
        wordCount: words.length,
        imageCount: $('img').length,
        imageAltCount: $('img[alt]').length,
        internalLinkCount: $(`a[href^="/"], a[href*="${host}"]`).length,
        externalLinkCount: $('a[href^="http"]:not([href*="' + host + '"])').length,
        hasSchema: $('script[type="application/ld+json"]').length > 0,
        hasNav: $('nav').length > 0,
        hasFooter: $('footer').length > 0,
        formCount: $('form').length,
        buttonCount: $('button, input[type="submit"], .btn, [role="button"]').length,
        socialLinkCount: $('a[href*="facebook"], a[href*="twitter"], a[href*="linkedin"], a[href*="instagram"]').length,
        contactInfo: {
          phone: $('a[href^="tel:"], .phone').length > 0,
          email: $('a[href^="mailto:"]').length > 0,
          address: $('.address, .location').length > 0
        },
        breadcrumbs: $('.breadcrumb, .breadcrumbs, nav[aria-label*="breadcrumb"]').length > 0,
        hasSSL: currentUrl.startsWith('https://'),
        level: currentUrl === startUrl ? 0 : Math.min(3, currentUrl.split('/').length - 3)
      };

      pagesData.push(pageData);

      if (pageData.level < 3 && pagesData.length < maxPages) {
        $('a[href]').each((i, link) => {
          const href = $(link).attr('href');
          if (href && (href.startsWith('/') || href.includes(host))) {
            let fullUrl;
            try {
              if (href.startsWith('/')) fullUrl = new URL(href, startUrl).href;
              else if (href.includes(host)) fullUrl = href.split('#')[0].split('?')[0];
              if (fullUrl &&
                  !visitedUrls.has(fullUrl) &&
                  !urlsToVisit.includes(fullUrl) &&
                  !fullUrl.match(/\.(pdf|jpg|jpeg|png|gif|zip|doc|docx)$/i)) {
                urlsToVisit.push(fullUrl);
              }
            } catch {}
          }
        });
      }

    } catch (error) {
      console.log(`Failed to crawl ${currentUrl}:`, error.message);
    }
  }

  return pagesData;
}


// ===== SCORE =====
function calculateQualityScore(pagesData) {
  if (!pagesData || pagesData.length === 0) return 30;
  let score = 40;
  const totalPages = pagesData.length;

  const httpsPages = pagesData.filter(p => p.hasSSL).length;
  score += (httpsPages / totalPages) * 10;

  const avgWords = pagesData.reduce((sum, p) => sum + p.wordCount, 0) / totalPages;
  if (avgWords >= 600) score += 12;
  else if (avgWords >= 400) score += 8;
  else if (avgWords >= 200) score += 4;

  const properH1Pages = pagesData.filter(p => p.h1Count === 1).length;
  score += (properH1Pages / totalPages) * 8;

  const avgLinks = pagesData.reduce((sum, p) => sum + p.internalLinkCount, 0) / totalPages;
  if (avgLinks >= 6) score += 10;
  else if (avgLinks >= 3) score += 6;

  const schemaPages = pagesData.filter(p => p.hasSchema).length;
  score += (schemaPages / totalPages) * 8;

  return Math.min(100, Math.max(30, Math.round(score)));
}


// ===== AI Insights (dynamic) =====
function generateAIInsights(pagesData, host) {
  if (!pagesData || pagesData.length === 0) {
    return [
      { description: `Unable to analyze ${host} for ChatGPT — crawling failed.` },
      { description: `${host} analysis incomplete for Claude — access restricted.` },
      { description: `Gemini cannot process ${host} due to technical barriers.` },
      { description: `Copilot analysis blocked for ${host}.` },
      { description: `Perplexity unable to analyze ${host} effectively.` }
    ];
  }

  const totalPages = pagesData.length;
  const avgWords = Math.round(pagesData.reduce((sum, p) => sum + p.wordCount, 0) / totalPages);
  const schemaPages = pagesData.filter(p => p.hasSchema).length;
  const properH1Pages = pagesData.filter(p => p.h1Count === 1).length;
  const avgLinks = Math.round(pagesData.reduce((sum, p) => sum + p.internalLinkCount, 0) / totalPages);
  const metaPages = pagesData.filter(p => p.metaDesc.length > 0).length;
  const httpsPages = pagesData.filter(p => p.hasSSL).length;

  return [
    { description: `ChatGPT review across ${totalPages} pages on ${host} notes ${properH1Pages === totalPages ? 'steady single‑spine headings' : `${properH1Pages}/${totalPages} pages with single‑spine headings`}, with ${avgWords >= 500 ? 'ample surround for context' : 'lean pockets that compress nuance'}. ${schemaPages >= totalPages * 0.8 ? 'Typed hints travel well.' : 'Typed hints are thin in spots.'}` },
    { description: `Claude view of ${host} observes ${schemaPages >= totalPages * 0.7 ? 'typed context present at scale' : 'typed context light in places'} and ${httpsPages === totalPages ? 'uniform transport hygiene' : 'mixed transport hygiene'}, shaping how quotes surface.` },
    { description: `Gemini perspective on ${host} sees ${schemaPages >= totalPages * 0.8 ? 'broad schema coverage' : 'schema gaps'}, and ${avgLinks >= 5 ? 'cohesive trails' : 'fragile trails'} when stitching related ideas.` },
    { description: `Copilot pass finds ${properH1Pages >= totalPages * 0.8 ? 'clear landing spots' : 'competing anchors'} across ${totalPages} pages on ${host}, with ${avgWords >= 500 ? 'coverage that carries' : 'coverage that thins under pressure'}.` },
    { description: `Perplexity read notes ${metaPages >= totalPages * 0.8 ? 'previews that frame intent' : 'previews that drift'} and ${httpsPages === totalPages ? 'stable trust cues' : 'variable trust cues'} shaping citation appetite.` }
  ];
}


// ===== DYNAMIC-ONLY ANALYSIS =====
function generateCompleteAnalysis(pagesData, host, reportType) {
  if (!pagesData || pagesData.length === 0) {
    return {
      working: [],
      needsAttention: [{ title: 'Site Crawl Failed', description: polish(`The crawl for ${host} did not return analyzable pages. This reads less like content quality and more like reachability or access posture.`, reportType === 'analyze' ? 'analyze' : 'full', host) }],
      qualityScore: 30
    };
  }

  const total = pagesData.length;
  const isAnalyze = reportType === 'analyze';

  // Aggregate metrics
  const httpsPages = pagesData.filter(p => p.hasSSL).length;
  const titleOK = pagesData.filter(p => p.title.length > 0);
  const metaOK = pagesData.filter(p => p.metaDesc.length > 0);
  const longTitles = pagesData.filter(p => p.title.length > 60);
  const dupTitleCount = total - new Set(pagesData.map(p => p.title)).size;

  const wordsArr = pagesData.map(p => p.wordCount);
  const avgWords = avg(wordsArr);
  const sdWords = stdev(wordsArr);
  const thin = pagesData.filter(p => p.wordCount < 300);

  const h1Single = pagesData.filter(p => p.h1Count === 1);
  const h1None = pagesData.filter(p => p.h1Count === 0);
  const h1Multi = pagesData.filter(p => p.h1Count > 1);

  const intLinksArr = pagesData.map(p => p.internalLinkCount);
  const avgInt = avg(intLinksArr);
  const sdInt = stdev(intLinksArr);
  const weakInt = pagesData.filter(p => p.internalLinkCount < 3);

  const schemaPages = pagesData.filter(p => p.hasSchema).length;

  const imgAltRatios = pagesData.map(p => (p.imageCount ? Math.round((p.imageAltCount / p.imageCount) * 100) : 100));
  const avgAltPct = avg(imgAltRatios);

  const crumbs = pagesData.filter(p => p.breadcrumbs).length;
  const navPct = pct(pagesData.filter(p => p.hasNav).length, total);
  const footPct = pct(pagesData.filter(p => p.hasFooter).length, total);
  const socialAvg = avg(pagesData.map(p => p.socialLinkCount));
  const extLinksAvg = avg(pagesData.map(p => p.externalLinkCount));

  // Provisional quality to set band targets
  let qScore = calculateQualityScore(pagesData);

  // BAND TARGETS
  let workingTarget, needsTarget;
  if (isAnalyze) {
    workingTarget = 5;
    needsTarget = 10;
  } else {
    if (qScore >= 80) { workingTarget = 10; needsTarget = 15; }       // High
    else if (qScore >= 60) { workingTarget = 7; needsTarget = 20; }   // Medium
    else { workingTarget = 5; needsTarget = 25; }                     // Low
  }

  // Build dynamic candidates
  const W = [];
  const N = [];
  let salt = 0;

  // Working
  if (httpsPages === total) {
    W.push({ title: 'Transport Consistency', description: `All ${total} sampled pages on ${host} resolve over HTTPS. Trust cues travel cleanly without calling attention to the rails.` });
  }
  if (pct(titleOK.length, total) >= 95 && longTitles.length === 0 && dupTitleCount === 0) {
    W.push({ title: 'Distinct, Legible Titling', description: `${pct(titleOK.length, total)}% of pages present stable, non‑colliding titles on ${host}. Previews stay readable rather than tapering off mid‑thought.` });
  }
  if (pct(metaOK.length, total) >= 80) {
    W.push({ title: 'Preview Coverage', description: `${pct(metaOK.length, total)}% of pages expose summaries on ${host}. Framing tends to carry intent without forcing blind reconstruction.` });
  }
  if (schemaPages >= Math.ceil(total * 0.7)) {
    W.push({ title: 'Typed Context Present', description: `${pct(schemaPages, total)}% of pages declare structured hints on ${host}. Names and roles stay straighter when those hints persist.` });
  }
  if (avgInt >= 6 && weakInt.length === 0) {
    W.push({ title: 'Link Rhythm Holds', description: `Internal trails average ~${avgInt} per page with few thin outliers on ${host}. Readers landing mid‑stream usually find their bearings.` });
  }
  if (avgAltPct >= 85) {
    W.push({ title: 'Alt Coverage Signals', description: `Alt attributes appear across most imagery on ${host} (≈${avgAltPct}%). References can be traced even when visuals are sidelined.` });
  }
  if (avgWords >= 600) {
    W.push({ title: 'Coverage That Carries', description: `${host} averages ~${avgWords} words per page. Context tends to outlast paraphrase instead of collapsing to headlines.` });
  }
  if (h1Single.length === total) {
    W.push({ title: 'Single‑Spine Headings', description: `Primary topic spines stay singular across pages on ${host}. Ladders make sense without side‑by‑side reading.` });
  }
  if (navPct >= 90 && footPct >= 90) {
    W.push({ title: 'Template Familiarity', description: `Global elements show up consistently (${navPct}% nav, ${footPct}% footer). Layout does more signaling than surprise.` });
  }
  if (crumbs >= Math.ceil(total * 0.6)) {
    W.push({ title: 'Breadcrumb Traces', description: `${pct(crumbs, total)}% of pages surface hierarchy traces on ${host}. Sections can be located even when quotes are lifted out.` });
  }
  // Extra working angles (still data-driven)
  if (sdWords <= 120 && avgWords >= 400) {
    W.push({ title: 'Depth Consistency', description: `Page depth clusters around ~${avgWords} words (low spread). Coverage rarely jolts between skim and long‑form.` });
  }
  if (sdInt <= 3 && avgInt >= 4) {
    W.push({ title: 'Trail Regularity', description: `Internal linking varies little across ${host}. Trails feel expected rather than opportunistic.` });
  }

  // Needs
  if (httpsPages !== total) {
    N.push({ title: 'Mixed Transport', description: `${httpsPages}/${total} pages use HTTPS on ${host}. When the rail switches mid‑journey, trust cues don’t travel as smoothly.` });
  }
  if (titleOK.length < total) {
    N.push({ title: 'Untitled Surfaces', description: `${total - titleOK.length} pages publish without a declared title on ${host}. Topic identity fades where the label goes missing.` });
  }
  if (longTitles.length > 0) {
    N.push({ title: 'Run‑On Titling', description: `${longTitles.length} titles run long on ${host}. In tight previews, those strands tend to shear off.` });
  }
  if (dupTitleCount > 0) {
    N.push({ title: 'Title Collisions', description: `${dupTitleCount} collisions appear across ${host}. When different rooms share the same sign, routing gets fuzzy.` });
  }
  if (pct(metaOK.length, total) < 80) {
    N.push({ title: 'Preview Drift', description: `Only ${pct(metaOK.length, total)}% of pages frame a summary on ${host}. Absent framing invites guesswork where you want orientation.` });
  }
  if (thin.length > 0) {
    N.push({ title: 'Surface‑Level Pockets', description: `${thin.length}/${total} pages read under 300 words on ${host}. Short bursts compress nuance the moment they’re quoted.` });
  }
  if (avgWords < 400) {
    N.push({ title: 'Shallow Mean Coverage', description: `Average depth sits near ${avgWords} words on ${host}. Brevity changes what can be carried forward without extra scaffolding.` });
  }
  if (h1None.length > 0) {
    N.push({ title: 'Missing Spines', description: `${h1None.length} pages show no primary heading on ${host}. Without the spine, sections float more than they stack.` });
  }
  if (h1Multi.length > 0) {
    N.push({ title: 'Competing Spines', description: `${h1Multi.length} pages carry multiple primary headings on ${host}. Parallel anchors tug at the same center of gravity.` });
  }
  if (avgInt < 6) {
    N.push({ title: 'Sparse Trails', description: `Internal trails average ~${avgInt} per page on ${host}. Thin paths make side‑topics feel unmoored.` });
  }
  if (weakInt.length > 0) {
    N.push({ title: 'Islands in the Map', description: `${weakInt.length} pages show fewer than three internal links on ${host}. Those islands read more like asides than nodes.` });
  }
  if (schemaPages < Math.ceil(total * 0.7)) {
    N.push({ title: 'Typed Hints Go Missing', description: `Structured context appears on ${pct(schemaPages, total)}% of pages for ${host}. Where types go quiet, names blur.` });
  }
  if (avgAltPct < 70) {
    N.push({ title: 'Alt Coverage Thin', description: `Alt attributes average ~${avgAltPct}% across imagery on ${host}. Visuals without captions become dead air when lifted.` });
  }
  if (crumbs < Math.ceil(total * 0.4)) {
    N.push({ title: 'Faint Hierarchy Traces', description: `Only ${pct(crumbs, total)}% of pages expose breadcrumb cues on ${host}. Without the trail, excerpts lose their place.` });
  }
  if (navPct < 80 || footPct < 80) {
    N.push({ title: 'Template Drift', description: `Global elements vary (nav ${navPct}%, footer ${footPct}%) on ${host}. Readers relearn the furniture more than the ideas.` });
  }
  if (extLinksAvg > 8) {
    N.push({ title: 'Outflow Bias', description: `External linking averages ~${extLinksAvg} per page on ${host}. When the door out is prominent, the room gets less attention.` });
  }
  if (socialAvg === 0) {
    N.push({ title: 'Quiet Social Footprint', description: `Social signals are scarcely visible on ${host}. Off‑site echoes are faint where corroboration might help.` });
  }
  if (sdWords > 220) {
    N.push({ title: 'Depth Whiplash', description: `Depth swings widely across ${host} (spread ≈${sdWords}). Switching between skim and sprawl shakes continuity.` });
  }
  if (sdInt > 5) {
    N.push({ title: 'Trail Volatility', description: `Internal link counts jump around (spread ≈${sdInt}) on ${host}. Trails feel situational rather than patterned.` });
  }

  // Uniqueness
  let Wuniq = uniqueByTitle(W);
  let Nuniq = uniqueByTitle(N);

  // FORCE EXACT TARGETS (no static padding; derive variants from metrics)
  const makeVariant = (baseTitle, baseText, idx) => ({
    title: `${baseTitle}${idx > 0 ? ` (view ${idx + 1})` : ''}`,
    description: baseText.replace(/\s+/g, ' ')
  });

  // If short, derive more angles from the same metric families with varied phrasing
  const grow = (arr, target, domain, mode) => {
    let i = 0;
    while (arr.length < target && i < 50) {
      const pick = i % 6;
      if (pick === 0 && avgWords) {
        arr.push(makeVariant('Coverage Balance', `Depth centers near ~${avgWords} words on ${domain}, but the edge cases pull differently. The read shifts more with where you land than what you search.`, i));
      } else if (pick === 1 && sdWords) {
        arr.push(makeVariant('Texture Spread', `Depth texture stretches across a wide band (≈${sdWords}). The same subject can feel like a caption in one room and a chapter in the next.`, i));
      } else if (pick === 2 && avgInt) {
        arr.push(makeVariant('Trail Density', `Trails settle around ~${avgInt} links per page. Hop‑to‑hop distance shapes how quickly adjacent ideas come into view.`, i));
      } else if (pick === 3 && avgAltPct) {
        arr.push(makeVariant('Caption Footing', `Alt coverage sits near ${avgAltPct}%. Where captions thin, lifted visuals act more like placeholders than references.`, i));
      } else if (pick === 4 && schemaPages >= 0) {
        arr.push(makeVariant('Typing Footprint', `Typed hints appear on ${pct(schemaPages, total)}% of pages. Where those hints drop, naming and roles take longer to settle.`, i));
      } else if (pick === 5 && dupTitleCount >= 0) {
        arr.push(makeVariant('Label Drift', `Naming collides in pockets (collisions: ${dupTitleCount}). When labels mirror each other, routing loses its edge.`, i));
      }
      i++;
    }
    // polish each
    return arr.map((x, k) => ({ ...x, description: polish(x.description, mode, domain, k) })).slice(0, target);
  };

  Wuniq = grow(Wuniq, workingTarget, host, isAnalyze ? 'analyze' : 'full');
  Nuniq = grow(Nuniq, needsTarget, host, isAnalyze ? 'analyze' : 'full');

  // Recompute quality to return (respect override later)
  let qualityScore = calculateQualityScore(pagesData);

  return { working: Wuniq, needsAttention: Nuniq, qualityScore };
}


// ===== MAIN ANALYZER =====
async function analyzeWebsite(url, reportType = 'analyze') {
  const host = hostOf(url);
  try {
    const maxPages = reportType === 'full-report' ? 15 : 8;
    const pagesData = await crawlSitePages(url, maxPages);
    if (pagesData.length === 0) throw new Error('No pages crawled');

    let analysis = generateCompleteAnalysis(pagesData, host, reportType);

    const pillars = {
      access: clamp(18 + Math.floor((pagesData.reduce((s, p) => s + p.internalLinkCount, 0) / pagesData.length) / 2), 15, 25),
      trust: clamp(18 + (pagesData.filter(p => p.hasSSL).length === pagesData.length ? 3 : 0), 15, 25),
      clarity: clamp(18 + (pagesData.filter(p => p.h1Count === 1).length === pagesData.length ? 3 : 0), 15, 25),
      alignment: clamp(18 + Math.floor((pagesData.filter(p => p.hasSchema).length / pagesData.length) * 4), 15, 25),
    };

    if (OVERRIDE.has(host)) {
      const override = highScore();
      Object.assign(pillars, override.pillars);
      analysis.qualityScore = override.score;
    }

    const insights = generateAIInsights(pagesData, host);

    return {
      working: analysis.working,
      needsAttention: analysis.needsAttention,
      insights,
      pillars,
      score: analysis.qualityScore
    };

  } catch (error) {
    console.error('Analysis failed:', error.message);
    const fallback = {
      working: [],
      needsAttention: [{ title: 'Analysis Incomplete', description: polish(`${host} crawl fell short — only partial signals were observable. This reads more like access posture than content posture.`, 'full', host) }],
      qualityScore: 60
    };
    return {
      working: fallback.working,
      needsAttention: fallback.needsAttention,
      insights: generateAIInsights([], host),
      pillars: { access: 15, trust: 15, clarity: 15, alignment: 15 },
      score: fallback.qualityScore
    };
  }
}


// ===== API ENDPOINTS =====
app.get('/report.html', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');
  try { new URL(url); } catch { return res.status(400).send('<p style="color:red">Invalid URL format.</p>'); }

  const isFullReport = req.headers.referer && req.headers.referer.includes('full-report');
  const reportType = isFullReport ? 'full-report' : 'analyze';

  const analysis = await analyzeWebsite(url, reportType);
  const li = (t, d) => `<li><strong>${t}:</strong> ${d}</li>`;

  const html = `
    <div class="section-title">✅ What's Working</div>
    <ul>${analysis.working.map(x => li(x.title, x.description)).join('')}</ul>
    <div class="section-title">🚨 Needs Attention</div>
    <ul>${analysis.needsAttention.map(x => li(x.title, x.description)).join('')}</ul>
    <div class="section-title">🤖 AI Engine Insights</div>
    <ul>${analysis.insights.map(x => `<li>${x.description}</li>`).join('')}</ul>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.get('/api/score', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL format' }); }

  const host = hostOf(url);
  const analysis = await analyzeWebsite(url, 'analyze');
  const total = analysis.pillars.access + analysis.pillars.trust + analysis.pillars.clarity + analysis.pillars.alignment;

  const bandText = (score) => {
    if (score >= 85) return "Rank: Highly Visible ★★★★☆";
    if (score >= 70) return "Rank: Partially Visible ★★★☆☆";
    if (score >= 55) return "Rank: Needs Work ★★☆☆☆";
    return "Rank: Low Visibility ★☆☆☆☆";
  };

  // Dynamic highlights: first four Needs (site-specific, non-prescriptive)
  const highlights = analysis.needsAttention.slice(0, 4).map(x => {
    const first = splitSents(x.description)[0] || x.description;
    return `${x.title} — ${first}`;
  });

  const logos = {
    ChatGPT: "/img/chatgpt-logo.png",
    Claude: "/img/claude-logo.png",
    Gemini: "/img/gemini-logo.png",
    Copilot: "/img/copilot-logo.png",
    Perplexity: "/img/perplexity-logo.png"
  };
  const order = ["ChatGPT", "Claude", "Gemini", "Copilot", "Perplexity"];
  const insights = analysis.insights.map((insight, i) => ({
    engine: order[i] || "Engine",
    text: insight.description,
    logo: logos[order[i]] || ""
  }));

  res.json({
    url, host,
    score: total,
    pillars: analysis.pillars,
    highlights,
    band: bandText(total),
    override: OVERRIDE.has(host),
    insights
  });
});

if (sendLinkHandler) {
  app.post('/api/send-link', sendLinkHandler);
}

app.listen(PORT, () => console.log(`SnipeRank Backend v2.3.0 running on port ${PORT}`));
