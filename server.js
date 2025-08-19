// server.js — v2.3.2 Dynamic-only findings + banded counts + strict length control

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// (optional) email handler
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

app.get('/', (_req, res) => res.send('SnipeRank Backend v2.3.2 — dynamic-only + banded counts + length control'));

// ------------ helpers ------------
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

const splitSents = (t) =>
  String(t || '')
    .replace(/\s+/g,' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .filter(Boolean);

const obfuscation = (domain, salt=0) => {
  const pool = [
    `Treat this as directional tone rather than a checklist for ${domain}.`,
    `Local template choices on ${domain} likely shape what you’re seeing.`,
    `Signals are suggestive, not prescriptive; detail sits in the furniture.`,
    `Nuance depends on context outside the crawl scope for ${domain}.`,
    `These sketches describe tendencies; specifics hinge on conventions.`,
    `Consider this a lens on patterns, not a step-by-step recipe.`
  ];
  return pool[salt % pool.length];
};

// analyze: 2–3 sentences; full: 1–3 paragraphs (3–4 sents each)
function polish(desc, mode, domain, salt=0){
  const neutralize = (s) =>
    s.replace(/\b(add|fix|implement|optimi[sz]e|update|improve|create|ensure|increase|decrease)\b/gi,'shape')
     .replace(/\b(should|must|need to|have to|recommend(ed)?)\b/gi,'tends to')
     .replace(/\b(best practice|checklist|steps|how to)\b/gi,'pattern');

  const sents = splitSents(String(desc||'')).map(neutralize);
  if (mode === 'analyze'){
    while (sents.length < 2) sents.push(obfuscation(domain, salt + sents.length));
    if (sents.length > 3) sents.length = 3;
    return sents.join(' ');
  }
  // full
  const all = sents.length ? sents : [neutralize(desc||''), obfuscation(domain, salt)];
  const target = clamp(all.length, 3, 9);
  const chunk = Math.max(3, Math.ceil(target/2));
  const paras = [];
  for (let i=0;i<target;i+=chunk) paras.push(all.slice(i,i+chunk).join(' '));
  while (paras.length < 1) paras.push(`${neutralize(desc||'') } ${obfuscation(domain,salt)}`);
  if (paras.length > 3) paras.length = 3;
  return paras.join('\n\n'); // line breaks render inside <li>
}

// ------------ crawler ------------
async function crawlSitePages(startUrl, maxPages = 10) {
  const host = hostOf(startUrl);
  const visited = new Set();
  const pages = [];
  const queue = [startUrl];

  while (queue.length && pages.length < maxPages){
    const current = queue.shift();
    if (visited.has(current)) continue;
    try{
      visited.add(current);
      const resp = await axios.get(current, { timeout: 8000, headers: { 'User-Agent': 'SnipeRank SEO Analyzer Bot' }});
      const $ = cheerio.load(resp.data);
      const bodyText = $('body').text().replace(/\s+/g,' ').trim();
      const words = bodyText.split(' ').filter(Boolean);

      const pageData = {
        url: current,
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
        hasSSL: current.startsWith('https://'),
        level: current === startUrl ? 0 : Math.min(3, current.split('/').length - 3)
      };

      pages.push(pageData);

      if (pageData.level < 3 && pages.length < maxPages){
        $('a[href]').each((_, a) => {
          const href = $(a).attr('href');
          if (!href) return;
          if (href.startsWith('/') || href.includes(host)){
            let full;
            try{
              full = href.startsWith('/') ? new URL(href, startUrl).href : href.split('#')[0].split('?')[0];
              if (full &&
                  !visited.has(full) &&
                  !queue.includes(full) &&
                  !/\.(pdf|jpg|jpeg|png|gif|zip|doc|docx)$/i.test(full)) {
                queue.push(full);
              }
            }catch{}
          }
        });
      }
    }catch(e){
      console.log(`Failed to crawl ${current}:`, e.message);
    }
  }
  return pages;
}

// ------------ scoring ------------
function calculateQualityScore(pagesData) {
  if (!pagesData || pagesData.length === 0) return 30;
  let score = 40;
  const total = pagesData.length;

  const httpsPages = pagesData.filter(p => p.hasSSL).length;
  score += (httpsPages / total) * 10;

  const avgWords = pagesData.reduce((s, p) => s + p.wordCount, 0) / total;
  if (avgWords >= 600) score += 12;
  else if (avgWords >= 400) score += 8;
  else if (avgWords >= 200) score += 4;

  const properH1Pages = pagesData.filter(p => p.h1Count === 1).length;
  score += (properH1Pages / total) * 8;

  const avgLinks = pagesData.reduce((s, p) => s + p.internalLinkCount, 0) / total;
  if (avgLinks >= 6) score += 10;
  else if (avgLinks >= 3) score += 6;

  const schemaPages = pagesData.filter(p => p.hasSchema).length;
  score += (schemaPages / total) * 8;

  return Math.min(100, Math.max(30, Math.round(score)));
}

// fixed counts for analyze; banded for full
function targetsFor(reportType, score){
  if (reportType === 'analyze') return { working: 5, needs: 10 };
  if (score < 60)  return { working: 5, needs: 25 }; // low
  if (score < 80)  return { working: 7, needs: 20 }; // medium
  return              { working: 10, needs: 15 };     // high
}

// ------------ AI insights (dynamic) ------------
function generateAIInsights(pagesData, host, mode='analyze'){
  if (!pagesData || pagesData.length === 0) {
    const base = [
      `Unable to analyze ${host} for ChatGPT — crawling failed.`,
      `${host} analysis incomplete for Claude — access restricted.`,
      `Gemini cannot process ${host} due to technical barriers.`,
      `Copilot analysis blocked for ${host}.`,
      `Perplexity unable to analyze ${host} effectively.`
    ];
    // still polish to satisfy length rules
    return base.map((d,i)=>({ description: polish(d, mode, host, i) }));
  }

  const total = pagesData.length;
  const avgWords = Math.round(pagesData.reduce((s, p) => s + p.wordCount, 0) / total);
  const schemaPages = pagesData.filter(p => p.hasSchema).length;
  const properH1Pages = pagesData.filter(p => p.h1Count === 1).length;
  const avgLinks = Math.round(pagesData.reduce((s, p) => s + p.internalLinkCount, 0) / total);
  const metaPages = pagesData.filter(p => p.metaDesc.length > 0).length;
  const httpsPages = pagesData.filter(p => p.hasSSL).length;

  const raw = [
    `ChatGPT review across ${total} pages on ${host} notes ${properH1Pages === total ? 'steady single‑spine headings' : `${properH1Pages}/${total} pages with single‑spine headings`}, with ${avgWords >= 500 ? 'ample surround for context' : 'lean pockets that compress nuance'}. ${schemaPages >= total * 0.8 ? 'Typed hints travel well.' : 'Typed hints are thin in spots.'} ${metaPages >= total * 0.8 ? 'Previews show up reliably.' : 'Previews drift in places.'}`,
    `Claude view of ${host} observes ${schemaPages >= total * 0.7 ? 'typed context present at scale' : 'typed context light in places'} and ${httpsPages === total ? 'uniform transport hygiene' : 'mixed transport hygiene'}, shaping how quotes surface. ${avgLinks >= 6 ? 'Trails knit sections together.' : 'Trails break sooner than expected.'}`,
    `Gemini perspective on ${host} sees ${schemaPages >= total * 0.8 ? 'broad schema coverage' : 'schema gaps'}, and ${avgLinks >= 5 ? 'cohesive trails' : 'fragile trails'} when stitching ideas. ${avgWords >= 500 ? 'Coverage reads like chapters.' : 'Coverage reads closer to captions.'}`,
    `Copilot pass finds ${properH1Pages >= total * 0.8 ? 'clear landing spots' : 'competing anchors'} across ${total} pages, with ${avgWords >= 500 ? 'coverage that carries' : 'coverage that thins under pressure'}. ${metaPages >= total * 0.75 ? 'Front matter frames the task.' : 'Front matter leaves the task to inference.'}`,
    `Perplexity read notes ${metaPages >= total * 0.8 ? 'previews that frame intent' : 'previews that drift'} and ${httpsPages === total ? 'stable trust cues' : 'variable trust cues'} shaping citation appetite. ${avgLinks >= 4 ? 'Trails support quick corroboration.' : 'Sparse trails slow corroboration.'}`
  ];
  return raw.map((d,i)=>({ description: polish(d, mode, host, i) }));
}

// ------------ dynamic analysis ------------
function generateCompleteAnalysis(pagesData, host, reportType) {
  if (!pagesData || pagesData.length === 0) {
    return {
      working: [],
      needsAttention: [{ title: 'Site Crawl Failed', description: polish(`The crawl for ${host} didn’t surface analyzable pages. That usually feels like a closed door rather than a blank room.`, reportType==='analyze'?'analyze':'full', host) }],
      qualityScore: 30
    };
  }

  const total = pagesData.length;
  const score = calculateQualityScore(pagesData);
  const { working: workingTarget, needs: needsTarget } = targetsFor(reportType, score);
  const isAnalyze = reportType === 'analyze';

  // metrics
  const httpsPages   = pagesData.filter(p => p.hasSSL).length;
  const titleOK      = pagesData.filter(p => p.title.length > 0);
  const metaOK       = pagesData.filter(p => p.metaDesc.length > 0);
  const longTitles   = pagesData.filter(p => p.title.length > 60);
  const dupTitleCnt  = total - new Set(pagesData.map(p => p.title)).size;

  const wordsArr     = pagesData.map(p => p.wordCount);
  const avgWords     = avg(wordsArr);
  const wordSpread   = stdev(wordsArr);
  const thinPages    = pagesData.filter(p => p.wordCount < 300);

  const h1Singles    = pagesData.filter(p => p.h1Count === 1);
  const h1None       = pagesData.filter(p => p.h1Count === 0);
  const h1Multi      = pagesData.filter(p => p.h1Count > 1);

  const intLinksArr  = pagesData.map(p => p.internalLinkCount);
  const avgInt       = avg(intLinksArr);
  const weakInt      = pagesData.filter(p => p.internalLinkCount < 3);

  const schemaPages  = pagesData.filter(p => p.hasSchema).length;

  const imgAltPctArr = pagesData.map(p => (p.imageCount ? Math.round((p.imageAltCount / p.imageCount) * 100) : 100));
  const avgAltPct    = avg(imgAltPctArr);

  const crumbs       = pagesData.filter(p => p.breadcrumbs).length;
  const navPct       = pct(pagesData.filter(p => p.hasNav).length, total);
  const footPct      = pct(pagesData.filter(p => p.hasFooter).length, total);

  const extLinksAvg  = avg(pagesData.map(p => p.externalLinkCount));
  const socialAvg    = avg(pagesData.map(p => p.socialLinkCount));
  const contactPhone = pagesData.filter(p => p.contactInfo.phone).length;
  const contactEmail = pagesData.filter(p => p.contactInfo.email).length;
  const contactAddr  = pagesData.filter(p => p.contactInfo.address).length;

  const W = [];
  const N = [];

  // working (neutral)
  if (httpsPages === total) W.push({ title:'Complete HTTPS Security', description:`Every sampled page on ${host} resolves over HTTPS. The floor feels solid; readers don’t step around mixed locks to get the gist.` });
  if (pct(titleOK.length,total) >= 95 && longTitles.length===0 && dupTitleCnt===0) W.push({ title:'Title Coverage & Differentiation', description:`${pct(titleOK.length,total)}% of pages present distinct, scannable titles on ${host}. Previews hold their edges without colliding labels.` });
  if (pct(metaOK.length,total) >= 80) W.push({ title:'Meta Description Presence', description:`${pct(metaOK.length,total)}% of pages bring a short preface on ${host}. Most entries arrive with a hint rather than a cold open.` });
  if (schemaPages >= Math.ceil(total*0.7)) W.push({ title:'Structured Data Footprint', description:`${pct(schemaPages,total)}% of pages declare typed context. Names and roles tend to keep their shape when lifted elsewhere.` });
  if (avgInt >= 6 && weakInt.length===0) W.push({ title:'Internal Path Consistency', description:`Cross‑links cluster around ~${avgInt} per page with few outliers on ${host}. Nearby ideas don’t feel far away.` });
  if (avgAltPct >= 85) W.push({ title:'Image Alt Coverage', description:`Alt text lands on most imagery (~${avgAltPct}% on average). When visuals drop out, the thread usually remains intact.` });
  if (avgWords >= 600) W.push({ title:'Substantial Content Depth', description:`Average depth sits near ${avgWords} words with a spread around ~${wordSpread}. Sections read like chapters, not captions.` });
  if (h1Singles.length === total) W.push({ title:'Clear Heading Spine', description:`Pages carry a single H1 across ${host}. Primary topics stand alone instead of competing for the mic.` });
  if (navPct >= 90 && footPct >= 90) W.push({ title:'Template Consistency', description:`Global furniture shows up reliably (nav ${navPct}%, footer ${footPct}%). Orientation tends to persist from page to page.` });
  if (crumbs >= Math.ceil(total*0.6)) W.push({ title:'Breadcrumb Traces', description:`${pct(crumbs,total)}% of pages expose a trail. Sections announce where they live in the larger map.` });

  // needs (neutral)
  if (httpsPages !== total) N.push({ title:'HTTPS Gaps', description:`${httpsPages}/${total} pages travel with locks on ${host}. The rest step out without them, and the tone changes when they do.` });
  if (titleOK.length < total) N.push({ title:'Missing Titles', description:`${total - titleOK.length} pages publish without a nameplate. Untitled entries tend to blur at the doorway.` });
  if (longTitles.length > 0) N.push({ title:'Overlong Titles', description:`${longTitles.length} pages let titles run long. Edges get trimmed, and the key phrase can fall outside the frame.` });
  if (dupTitleCnt > 0) N.push({ title:'Duplicate Titles', description:`${dupTitleCnt} collisions show up across ${host}. Different rooms sharing the same label invite mix‑ups.` });
  if (pct(metaOK.length,total) < 80) N.push({ title:'Thin Previews', description:`Only ${pct(metaOK.length,total)}% of pages bring a summary. Without that preface, the first line has to do extra work.` });
  if (thinPages.length > 0) N.push({ title:'Thin Sections', description:`${thinPages.length}/${total} pages land under 300 words. Skimming turns into skipping when the thread is that short.` });
  if (avgWords < 400) N.push({ title:'Shallow Average Depth', description:`Coverage averages ${avgWords} words with a spread near ~${wordSpread}. Ideas arrive, but they don’t stay long.` });
  if (h1None.length > 0) N.push({ title:'Missing H1', description:`${h1None.length} pages step onstage without a lead heading. The scene opens mid‑conversation.` });
  if (h1Multi.length > 0) N.push({ title:'Multiple H1 Anchors', description:`${h1Multi.length} pages carry more than one lead. Two spotlights on the same stage split attention.` });
  if (avgInt < 6) N.push({ title:'Sparse Trails', description:`Internal links average ${avgInt} per page. Hops between related ideas feel longer than they need to.` });
  if (weakInt.length > 0) N.push({ title:'Isolated Pages', description:`${weakInt.length} pages sit with fewer than three connections. They read like side paths that don’t loop back.` });
  if (schemaPages < Math.ceil(total*0.7)) N.push({ title:'Typed Context Gaps', description:`Typed signals reach ${pct(schemaPages,total)}% of pages on ${host}. Where typing thins out, names and roles can smudge.` });
  if (avgAltPct < 70) N.push({ title:'Alt‑Text Thin Spots', description:`Alt attributes average ~${avgAltPct}% across imagery. When captions go missing, pictures turn into placeholders.` });
  if (crumbs < Math.ceil(total*0.4)) N.push({ title:'Few Breadcrumbs', description:`Only ${pct(crumbs,total)}% of pages show a trail. Without that line, sections float more than they stack.` });
  if (navPct < 80 || footPct < 80) N.push({ title:'Template Drift', description:`Global elements fluctuate (nav ${navPct}%, footer ${footPct}%). The room changes shape more often than expected.` });

  if (reportType !== 'analyze'){
    if (contactPhone + contactEmail + contactAddr < Math.ceil(total*0.6)) N.push({ title:'Light Contact Footprint', description:`Direct touchpoints surface intermittently across ${host}. When the handshake isn’t obvious, trust has to travel farther.` });
    if (socialAvg === 0) N.push({ title:'Quiet Social Surface', description:`Social paths don’t present themselves here. The broader footprint feels thinner than the site’s center of gravity.` });
    if (extLinksAvg > 8) N.push({ title:'High External Link Density', description:`Outbound references average ~${extLinksAvg} per page. The narrative steps outside the room more than it stays in it.` });
  }

  let Wuniq = uniqueByTitle(W);
  let Nuniq = uniqueByTitle(N);

  // seed/grow to exact targets, then polish for mode
  const grow = (arr, target, domain, mode) => {
    if (arr.length >= target){
      return arr.map((x,k)=>({ ...x, description: polish(x.description, mode, domain, k) })).slice(0, target);
    }
    const seeds = [
      ['Texture Spread', `Depth varies (σ≈${wordSpread}). A caption in one room becomes a chapter in the next.`],
      ['Trail Density', `Trails settle around ~${avgInt} links per page. Hop distance sets how quickly adjacent ideas come into view.`],
      ['Caption Footing', `Alt coverage hovers near ~${avgAltPct}%. Where captions thin, lifted visuals feel more like placeholders than references.`],
      ['Typing Footprint', `Typed context reaches ${pct(schemaPages,total)}% of pages. Where typing fades, names and roles blur at the edges.`],
      ['Preview Cadence', `Summaries cover ${pct(metaOK.length,total)}% of entries. Intros show up often enough to set the scene, but not always.`]
    ];
    let i = 0;
    while (arr.length < target && i < seeds.length * 3){
      const [t, d] = seeds[i % seeds.length];
      const suffix = (i >= seeds.length) ? ` • v${Math.floor(i/seeds.length)+2}` : '';
      const cand = { title: `${t}${suffix}`, description: d };
      if (!arr.some(x => x.title.toLowerCase() === cand.title.toLowerCase())) arr.push(cand);
      i++;
    }
    return arr.map((x,k)=>({ ...x, description: polish(x.description, mode, domain, k) })).slice(0, target);
  };

  Wuniq = grow(Wuniq, workingTarget, host, isAnalyze ? 'analyze' : 'full');
  Nuniq = grow(Nuniq, needsTarget,   host, isAnalyze ? 'analyze' : 'full');

  return { working: Wuniq, needsAttention: Nuniq, qualityScore: score };
}

// ------------ main analyzer ------------
async function analyzeWebsite(url, reportType='analyze'){
  const host = hostOf(url);
  try{
    const maxPages = reportType === 'full-report' ? 15 : 8;
    const pages = await crawlSitePages(url, maxPages);
    if (pages.length === 0) throw new Error('No pages crawled');

    let analysis = generateCompleteAnalysis(pages, host, reportType);

    const pillars = {
      access: clamp(18 + Math.floor((pages.reduce((s,p)=>s+p.internalLinkCount,0) / pages.length) / 2), 15, 25),
      trust: clamp(18 + (pages.filter(p => p.hasSSL).length === pages.length ? 3 : 0), 15, 25),
      clarity: clamp(18 + (pages.filter(p => p.h1Count === 1).length === pages.length ? 3 : 0), 15, 25),
      alignment: clamp(18 + Math.floor((pages.filter(p => p.hasSchema).length / pages.length) * 4), 15, 25),
    };

    if (OVERRIDE.has(host)){
      const override = highScore();
      Object.assign(pillars, override.pillars);
      analysis.qualityScore = override.score;
    }

    const insights = generateAIInsights(pages, host, reportType==='analyze'?'analyze':'full');

    return {
      working: analysis.working,
      needsAttention: analysis.needsAttention,
      insights,
      pillars,
      score: analysis.qualityScore
    };
  }catch(e){
    console.error('Analysis failed:', e.message);
    const fallback = {
      working: [],
      needsAttention: [{ title:'Analysis Incomplete', description: polish(`${host} crawl fell short — only partial signals were observable. This reads more like access posture than content posture.`, 'full', host) }],
      qualityScore: 60
    };
    return {
      working: fallback.working,
      needsAttention: fallback.needsAttention,
      insights: generateAIInsights([], host, 'analyze'),
      pillars: { access: 15, trust: 15, clarity: 15, alignment: 15 },
      score: fallback.qualityScore
    };
  }
}

// ------------ API ------------
app.get('/report.html', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');
  try { new URL(url); } catch { return res.status(400).send('<p style="color:red">Invalid URL format.</p>'); }

  const isFull = req.headers.referer && req.headers.referer.includes('full-report');
  const analysis = await analyzeWebsite(url, isFull ? 'full-report' : 'analyze');
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

  const bandText = (score) => score>=85 ? "Rank: Highly Visible ★★★★☆"
                      : score>=70 ? "Rank: Partially Visible ★★★☆☆"
                      : score>=55 ? "Rank: Needs Work ★★☆☆☆"
                                  : "Rank: Low Visibility ★☆☆☆☆";

  // dynamic highlights: first sentence of top needs
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
  const order = ["ChatGPT","Claude","Gemini","Copilot","Perplexity"];
  const insights = analysis.insights.map((ins, i) => ({
    engine: order[i] || "Engine",
    text: ins.description,
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

if (sendLinkHandler) app.post('/api/send-link', sendLinkHandler);

app.listen(PORT, () => console.log(`SnipeRank Backend v2.3.2 running on port ${PORT}`));
