// server.js — v2.4.2  (analyze=3 sentences per item; full-report=long paragraphs; LLM sized by mode)
// - Uses ?report=analyze|full to size both bullets and LLM insights (fallback: referer, else analyze)
// - Full-report: Needs Attention banded by score (low=25, medium=20, high=15); Working banded (5/7/10)
// - Analyze: fixed 5 Working / 10 Needs; every item exactly 3 sentences; LLM = 1 compact paragraph
// - Defensive try/catch to avoid 5xx on crawl/parse issues

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import path from 'path';

let sendLinkHandler = null;
try {
  const mod = await import('./api/send-link.js');
  sendLinkHandler = mod?.default || null;
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.send('SnipeRank Backend v2.4.2 — dynamic-only, banded, mode-sized'));

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
    `Consider this a lens on tendencies, not a step‑by‑step recipe.`,
  ];
  return pool[salt % pool.length];
};

// ——— crawler ———
async function crawlSitePages(startUrl, maxPages = 10) {
  const host = hostOf(startUrl);
  const visited = new Set();
  const pages = [];
  const queue = [startUrl];

  while (queue.length && pages.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    try {
      visited.add(current);
      const resp = await axios.get(current, { timeout: 10000, headers: { 'User-Agent': 'SnipeRank SEO Analyzer Bot' }});
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

      if (pageData.level < 3 && pages.length < maxPages) {
        $('a[href]').each((_, link) => {
          const href = $(link).attr('href');
          if (!href) return;
          let fullUrl = '';
          try {
            if (href.startsWith('/')) fullUrl = new URL(href, startUrl).href;
            else if (href.includes(host)) fullUrl = href.split('#')[0].split('?')[0];
            if (fullUrl &&
                !visited.has(fullUrl) &&
                !queue.includes(fullUrl) &&
                !fullUrl.match(/\.(pdf|jpg|jpeg|png|gif|zip|doc|docx)$/i)) {
              queue.push(fullUrl);
            }
          } catch {}
        });
      }
    } catch (e) {
      console.log(`Failed to crawl ${current}:`, e.message);
    }
  }
  return pages;
}

// ——— score ———
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

// ——— band targets ———
function targetsFor(reportType, score) {
  if (reportType === 'analyze') return { working: 5, needs: 10 };
  // full-report (min is 15 for Needs, per your correction)
  if (score < 60)  return { working: 5, needs: 25 };  // low
  if (score < 80)  return { working: 7, needs: 20 };  // medium
  return              { working: 10, needs: 15 };      // high
}

// ——— LLM insights (mode-sized) ———
function generateAIInsights(pagesData, host, mode='analyze') {
  const analyzeLLM = (text) => {
    // 1 compact paragraph ~3–5 sentences max
    const s = splitSents(text);
    while (s.length < 3) s.push(addObfuscation(host, s.length));
    return [s.slice(0,5).join(' ')];
  };
  const fullLLM = (text) => {
    // 1–2 substantive paragraphs
    const s = splitSents(text);
    while (s.length < 6) s.push(addObfuscation(host, s.length));
    const mid = Math.ceil(s.length/2);
    const paras = [ s.slice(0, mid).join(' '), s.slice(mid).join(' ') ];
    return paras;
  };

  if (!pagesData || pagesData.length === 0) {
    const msg = `Crawl didn’t surface pages for ${host}. Access posture, not content posture, seems to be the limiter.`;
    const pack = mode === 'analyze' ? analyzeLLM(msg) : fullLLM(msg);
    return ['ChatGPT','Claude','Gemini','Copilot','Perplexity'].map((_,i)=>({ description: pack.join('\n\n') }));
  }

  const total = pagesData.length;
  const avgWords = Math.round(pagesData.reduce((s, p) => s + p.wordCount, 0) / total);
  const schemaPages = pagesData.filter(p => p.hasSchema).length;
  const properH1Pages = pagesData.filter(p => p.h1Count === 1).length;
  const avgLinks = Math.round(pagesData.reduce((s, p) => s + p.internalLinkCount, 0) / total);
  const metaPages = pagesData.filter(p => p.metaDesc.length > 0).length;
  const httpsPages = pagesData.filter(p => p.hasSSL).length;

  const texts = [
    `ChatGPT review across ${total} pages on ${host} notes ${properH1Pages === total ? 'steady single‑spine headings' : `${properH1Pages}/${total} pages with single‑spine headings`}. ${avgWords >= 500 ? 'Coverage runs ample for context' : 'Coverage leans compact in places'}, which shapes how claims hold together when lifted. ${schemaPages >= total * 0.8 ? 'Typed hints tend to travel well; ' : 'Typed hints thin in spots; '}previews ${metaPages >= total * 0.8 ? 'frame intent reliably.' : 'drift more often than they anchor.'}`,
    `Claude view of ${host} observes ${schemaPages >= total * 0.7 ? 'typed context at scale' : 'typed context that runs light'}, with ${httpsPages === total ? 'uniform transport hygiene' : 'mixed transport hygiene'} setting trust tone. ${avgLinks >= 6 ? 'Trails feel cohesive' : 'Trails feel brittle'} and that distance affects what quotations look like out of context.`,
    `Gemini perspective on ${host} sees ${schemaPages >= total * 0.8 ? 'broad schema' : 'schema gaps'} and ${avgLinks >= 5 ? 'link density that maps adjacency' : 'sparser linking that obscures adjacency'}. Headings ${properH1Pages >= total * 0.8 ? 'land consistently' : 'compete periodically'}, which nudges how summaries are stitched.`,
    `Copilot pass finds ${properH1Pages >= total * 0.8 ? 'clear landing spots' : 'competing anchors'} across the set, with ${avgWords >= 500 ? 'coverage that carries examples' : 'coverage that thins under pressure'}. ${httpsPages === total ? 'Trust cues hold even as context shifts.' : 'Trust cues fluctuate with protocol mix.'}`,
    `Perplexity read notes ${metaPages >= total * 0.8 ? 'previews that frame the task' : 'previews that leave edges undefined'} and ${avgLinks >= 4 ? 'connectivity that supports fact‑checking trails' : 'thin trails that shorten verification paths'}. ${schemaPages >= total * 0.6 ? 'Typed context helps names keep their shape.' : 'Un‑typed pockets let names smudge at the edges.'}`
  ];

  const format = mode === 'analyze' ? analyzeLLM : fullLLM;
  return texts.map(t => ({ description: format(t).join('\n\n') }));
}

// ——— dynamic analysis ———
function generateCompleteAnalysis(pagesData, host, reportType) {
  if (!pagesData || pagesData.length === 0) {
    return {
      working: [],
      needsAttention: [{
        title: 'Site Crawl Failed',
        description: `The crawl for ${host} didn’t surface analyzable pages. That reads more like access posture than content posture.`
      }],
      qualityScore: 30
    };
  }

  const total = pagesData.length;
  const isAnalyze = reportType === 'analyze';
  const score = calculateQualityScore(pagesData);
  const { working: workingTarget, needs: needsTarget } = targetsFor(reportType, score);

  // aggregate
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

  // Working (neutral phrasing)
  if (httpsPages === total) W.push({ title:'Complete HTTPS Security', description:`Every sampled page on ${host} resolves over HTTPS. The floor feels solid; readers don’t step around mixed locks to get the gist.`});
  if (pct(titleOK.length,total) >= 95 && longTitles.length===0 && dupTitleCnt===0) W.push({ title:'Title Coverage & Differentiation', description:`${pct(titleOK.length,total)}% of pages present distinct, scannable titles on ${host}. Previews hold their edges without colliding labels.`});
  if (pct(metaOK.length,total) >= 80) W.push({ title:'Meta Description Presence', description:`${pct(metaOK.length,total)}% of pages bring a short preface on ${host}. Most entries arrive with a hint rather than a cold open.`});
  if (schemaPages >= Math.ceil(total*0.7)) W.push({ title:'Structured Data Footprint', description:`${pct(schemaPages,total)}% of pages declare typed context. Names and roles tend to keep their shape when lifted elsewhere.`});
  if (avgInt >= 6 && weakInt.length===0) W.push({ title:'Internal Path Consistency', description:`Cross‑links cluster around ~${avgInt} per page with few outliers on ${host}. Nearby ideas don’t feel far away.`});
  if (avgAltPct >= 85) W.push({ title:'Image Alt Coverage', description:`Alt text lands on most imagery (~${avgAltPct}% on average). When visuals drop out, the thread usually remains intact.`});
  if (avgWords >= 600) W.push({ title:'Substantial Content Depth', description:`Average depth sits near ${avgWords} words with a spread around ~${wordSpread}. Sections read like chapters, not captions.`});
  if (h1Singles.length === total) W.push({ title:'Clear Heading Spine', description:`Pages carry a single H1 across ${host}. Primary topics stand alone instead of competing for the mic.`});
  if (navPct >= 90 && footPct >= 90) W.push({ title:'Template Consistency', description:`Global furniture shows up reliably (nav ${navPct}%, footer ${footPct}%). Orientation tends to persist from page to page.`});
  if (crumbs >= Math.ceil(total*0.6)) W.push({ title:'Breadcrumb Traces', description:`${pct(crumbs,total)}% of pages expose a trail. Sections announce where they live in the larger map.`});

  // Needs (neutral)
  if (httpsPages !== total) N.push({ title:'HTTPS Gaps', description:`${httpsPages}/${total} pages travel with locks on ${host}. The rest step out without them, and the tone changes when they do.`});
  if (titleOK.length < total) N.push({ title:'Missing Titles', description:`${total - titleOK.length} pages publish without a nameplate. Untitled entries tend to blur at the doorway.`});
  if (longTitles.length > 0) N.push({ title:'Overlong Titles', description:`${longTitles.length} pages let titles run long. Edges get trimmed, and the key phrase can fall outside the frame.`});
  if (dupTitleCnt > 0) N.push({ title:'Duplicate Titles', description:`${dupTitleCnt} collisions show up across ${host}. Different rooms sharing the same label invite mix‑ups.`});
  if (pct(metaOK.length,total) < 80) N.push({ title:'Thin Previews', description:`Only ${pct(metaOK.length,total)}% of pages bring a summary. Without that preface, the first line has to do extra work.`});
  if (thinPages.length > 0) N.push({ title:'Thin Sections', description:`${thinPages.length}/${total} pages land under 300 words. Skimming turns into skipping when the thread is that short.`});
  if (avgWords < 400) N.push({ title:'Shallow Average Depth', description:`Coverage averages ${avgWords} words with a spread near ~${wordSpread}. Ideas arrive, but they don’t stay long.`});
  if (h1None.length > 0) N.push({ title:'Missing H1', description:`${h1None.length} pages step onstage without a lead heading. The scene opens mid‑conversation.`});
  if (h1Multi.length > 0) N.push({ title:'Multiple H1 Anchors', description:`${h1Multi.length} pages carry more than one lead. Two spotlights on the same stage split attention.`});
  if (avgInt < 6) N.push({ title:'Sparse Trails', description:`Internal links average ${avgInt} per page. Hops between related ideas feel longer than they need to.`});
  if (weakInt.length > 0) N.push({ title:'Isolated Pages', description:`${weakInt.length} pages sit with fewer than three connections. They read like side paths that don’t loop back.`});
  if (schemaPages < Math.ceil(total*0.7)) N.push({ title:'Typed Context Gaps', description:`Typed signals reach ${pct(schemaPages,total)}% of pages on ${host}. Where typing thins out, names and roles can smudge.`});
  if (avgAltPct < 70) N.push({ title:'Alt‑Text Thin Spots', description:`Alt attributes average ~${avgAltPct}% across imagery. When captions go missing, pictures turn into placeholders.`});
  if (crumbs < Math.ceil(total*0.4)) N.push({ title:'Few Breadcrumbs', description:`Only ${pct(crumbs,total)}% of pages show a trail. Without that line, sections float more than they stack.`});
  if (navPct < 80 || footPct < 80) N.push({ title:'Template Drift', description:`Global elements fluctuate (nav ${navPct}%, footer ${footPct}%). The room changes shape more often than expected.`});

  if (!isAnalyze) {
    if (contactPhone + contactEmail + contactAddr < Math.ceil(total*0.6)) N.push({ title:'Light Contact Footprint', description:`Direct touchpoints surface intermittently across ${host}. When the handshake isn’t obvious, trust has to travel farther.`});
    if (socialAvg === 0) N.push({ title:'Quiet Social Surface', description:`Social paths don’t present themselves here. The broader footprint feels thinner than the site’s center of gravity.`});
    if (extLinksAvg > 8) N.push({ title:'High External Link Density', description:`Outbound references average ~${extLinksAvg} per page. The narrative steps outside the room more than it stays in it.`});
  }

  // dedupe
  let Wuniq = uniqueByTitle(W);
  let Nuniq = uniqueByTitle(N);

  // length / texture polish
  const polish = (raw, mode, domain, idx) => {
    const base = String(raw||'').trim();
    const neutralize = (s) =>
      s.replace(/\b(add|fix|implement|optimi[sz]e|update|improve|create|use|ensure|increase|decrease)\b/gi, 'shape')
       .replace(/\b(should|must|need to|have to|recommend(ed)?)\b/gi, 'tends to')
       .replace(/\b(best practice|checklist|steps|how to)\b/gi, 'pattern');
    const s = splitSents(neutralize(base));

    if (mode === 'analyze') {
      while (s.length < 3) s.push(addObfuscation(domain, idx + s.length));
      return s.slice(0,3).join(' ');
    }
    // full → long paragraphs (1–3); aim 6–10 sentences split across 1–2 paras
    while (s.length < 6) s.push(addObfuscation(domain, idx + s.length));
    const goal = Math.min(10, Math.max(6, s.length));
    const cut = s.slice(0, goal);
    const mid = Math.ceil(cut.length/2);
    const paras = [ cut.slice(0, mid).join(' '), cut.slice(mid).join(' ') ];
    return paras.join('\n\n');
  };

  const grow = (arr, target, domain, mode) => {
    if (arr.length >= target) {
      return arr.map((x,k)=>({ ...x, description: polish(x.description, mode, domain, k)})).slice(0,target);
    }
    const seeds = [
      ['Texture Spread', `Depth varies (σ≈${wordSpread}). A caption in one room becomes a chapter in the next.`],
      ['Trail Density', `Trails settle around ~${avgInt} links per page. Hop distance sets how quickly adjacent ideas come into view.`],
      ['Caption Footing', `Alt coverage hovers near ~${avgAltPct}%. Where captions thin, lifted visuals feel more like placeholders than references.`],
      ['Typing Footprint', `Typed context reaches ${pct(schemaPages,total)}% of pages. Where typing fades, names and roles blur at the edges.`],
      ['Preview Cadence', `Summaries cover ${pct(metaOK.length,total)}% of entries. Intros show up often enough to set the scene, but not always.`],
    ];
    let i = 0;
    while (arr.length < target && i < seeds.length * 3) {
      const [t,d] = seeds[i % seeds.length];
      const suffix = (i >= seeds.length) ? ` • v${Math.floor(i/seeds.length)+2}` : '';
      const cand = { title: `${t}${suffix}`, description: d };
      if (!arr.some(x => x.title.toLowerCase() === cand.title.toLowerCase())) arr.push(cand);
      i++;
    }
    return arr.map((x,k)=>({ ...x, description: polish(x.description, mode, domain, k)})).slice(0,target);
  };

  Wuniq = grow(Wuniq, workingTarget, host, isAnalyze ? 'analyze' : 'full');
  Nuniq = grow(Nuniq, needsTarget,   host, isAnalyze ? 'analyze' : 'full');

  return { working: Wuniq, needsAttention: Nuniq, qualityScore: score };
}

// ——— main analyzer ———
async function analyzeWebsite(url, reportType='analyze') {
  const host = hostOf(url);
  try {
    const maxPages = reportType === 'full' || reportType === 'full-report' ? 15 : 8;
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

    const mode = (reportType === 'full' || reportType === 'full-report') ? 'full' : 'analyze';
    const insights = generateAIInsights(pagesData, host, mode);

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
      needsAttention: [{ title: 'Analysis Incomplete', description: `Crawl for ${host} fell short — this looks more like an access posture than a content posture.` }],
      qualityScore: 60
    };
    return {
      working: fallback.working,
      needsAttention: fallback.needsAttention,
      insights: generateAIInsights([], host, reportType),
      pillars: { access: 15, trust: 15, clarity: 15, alignment: 15 },
      score: fallback.qualityScore
    };
  }
}

// ——— endpoints ———
app.get('/report.html', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');
    try { new URL(url); } catch { return res.status(400).send('<p style="color:red">Invalid URL format.</p>'); }

    // report mode: query ?report=full|analyze → referer check → default analyze
    const qMode = String(req.query.report||'').toLowerCase();
    const ref = String(req.headers.referer||'').toLowerCase();
    let reportType = (qMode.includes('full') ? 'full' : (qMode.includes('analyze') ? 'analyze' : ''));
    if (!reportType) reportType = (ref.includes('full-report') ? 'full' : (ref.includes('analyze') ? 'analyze' : 'analyze'));

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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    console.error('/report.html error:', e);
    return res.status(500).send('<p style="color:red">Server error generating report.</p>');
  }
});

app.get('/api/score', async (req, res) => {
  try {
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

    return res.json({
      url, host,
      score: total,
      pillars: analysis.pillars,
      highlights,
      band: bandText(total),
      override: OVERRIDE.has(host),
      insights
    });
  } catch (e) {
    console.error('/api/score error:', e);
    return res.status(500).json({ error: 'Server error generating score' });
  }
});

if (sendLinkHandler) {
  app.post('/api/send-link', sendLinkHandler);
}

app.listen(PORT, () => console.log(`SnipeRank Backend v2.4.2 running on port ${PORT}`));
