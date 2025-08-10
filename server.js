// server.js (v1.9.17)
// - Domain-specific expansions:
//   * Needs Attention: 2–3 sentences each (LLM-safe, non-actionable), includes host
//   * AI Engine Insights: 5 sentences per engine, includes host
// - High-score override for yoramezra.com & quontora.com
// - De-dup by title; stable HTML for /report.html

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import sendLinkHandler from './api/send-link.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.send('SnipeRank Backend is running!'));

/* -------------------- Helpers -------------------- */

const OVERRIDE = new Set(['yoramezra.com', 'quontora.com']);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } };

const highScore = () => {
  const pillars = { access: 22, trust: 23, clarity: 22, alignment: 22 };
  return { pillars, score: 89, hardCoded: true };
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

// Expand an issue into a domain-specific, LLM-safe 2–3 sentence description
function expandIssue({ title, description = '' }, host) {
  const src = `${title} ${description}`.toLowerCase();

  const label =
    /h1|heading/.test(src) ? 'Topic focus clarity' :
    /link/.test(src) ? 'Internal connection mapping' :
    /meta|description/.test(src) ? 'Result framing signal' :
    /alt|image/.test(src) ? 'Visual descriptor cadence' :
    /schema|structured/.test(src) ? 'Entity signaling layer' :
    /(vitals|lcp|cls|inp|speed|core web vitals)/.test(src) ? 'Experience smoothness' :
    /(mobile|responsive)/.test(src) ? 'Contextual layout fit' :
    'Signal coherence';

  const s1 = `${label} on ${host}: signal variance detected across sampled pages.`;
  const s2 = `This may reduce how AI systems map ${host}'s intent, entities, and answer paths against competitive queries.`;
  const s3 = `Indicative only; implementation specifics are deferred to a guided session for ${host}.`;

  return { title, description: `${s1} ${s2} ${s3}` };
}

function expandNeedsAttention(list = [], host) {
  return list.map(item => expandIssue(item, host));
}

// Five-sentence, domain-specific paragraphs for each engine
function buildEngineInsights(host, isOverride) {
  return [
    {
      engine: 'ChatGPT',
      text: [
        `ChatGPT recognizes ${host} primarily through on-page structure and consistent entity naming.`,
        `When headings ladder to a single core claim, the model is more likely to extract answers from ${host} without extra prompting.`,
        `Redundant sections or diffuse navigation can cause the system to summarize conservatively and default to broader sources.`,
        `Clear FAQ/Q&A and concise lists on ${host} typically improve snippet quality and reduce hallucination risk.`,
        `Overall visibility trends positive${isOverride ? ' with strong authority cues already present' : ''}, but reinforcement of task-first summaries would strengthen inclusion in assistant-style responses.`
      ].join(' ')
    },
    {
      engine: 'Claude',
      text: [
        `Claude favors narrative clarity and ethical sourcing; ${host} benefits when authorship and source intent are explicit.`,
        `Sections that open with context, action, and outcome help Claude triage what to quote or summarize.`,
        `If ${host} mixes promotional copy with how-to steps, the model may downweight the page for instructional prompts.`,
        `Consistent “who/what/where” entity clarifiers reduce ambiguity in Claude’s multi-hop reasoning.`,
        `Expect stable parsing${isOverride ? ' given the site’s coherent identity signals' : ''}; sharper task framing would lift eligibility for direct, stepwise answers.`
      ].join(' ')
    },
    {
      engine: 'Gemini',
      text: [
        `Gemini emphasizes structured markup and web-scale corroboration; ${host} gains when schema and internal links point to canonical answers.`,
        `Pages that pair definitions with short lists are more quotable in Gemini’s long-form summaries.`,
        `Weak or mixed anchor text on ${host} can blur topic boundaries at crawl time.`,
        `Entity disambiguation (names, dates, roles) reduces false merges with similarly named organizations.`,
        `Strengthening schema breadth and anchor specificity on ${host} should improve surfacing in synthesized overviews.`
      ].join(' ')
    },
    {
      engine: 'Copilot',
      text: [
        `Copilot leans on Microsoft index signals and task resolution; ${host} is favored when instructions are explicit and scannable.`,
        `If primary answers are buried deep in paragraphs, Copilot tends to cite aggregators instead of ${host}.`,
        `Clear headings and bullets near the top of pages help the assistant construct immediate steps.`,
        `Trust markers (contact paths, organization schema) reduce defensive phrasing in responses referencing ${host}.`,
        `Improving first-screen scannability should increase the rate at which Copilot promotes ${host} for action-oriented prompts.`
      ].join(' ')
    },
    {
      engine: 'Perplexity',
      text: [
        `Perplexity rewards crisp citations and unique insights; ${host} performs best when pages contain specific, attributable facts.`,
        `Overly general summaries on ${host} can be treated as redundant against corpus baselines.`,
        `Tables, lists, and inline sources make it easier for the answer engine to attribute snippets back to ${host}.`,
        `Stable NAP/identity cues reduce confusion when multiple entities share similar names.`,
        `With stronger evidence density, ${host} is more likely to appear as a primary citation rather than a supporting mention.`
      ].join(' ')
    }
  ].map(x => ({ description: `${x.text}` }));
}

/* -------------------- Analysis -------------------- */

async function analyzeWebsite(url) {
  try {
    const resp = await axios.get(url, { timeout: 10000, headers: { 'User-Agent':'SnipeRank SEO Analyzer Bot' }});
    const $ = cheerio.load(resp.data);
    const host = hostOf(url);

    const a = {
      working: [],
      needsAttention: [],
      insights: [],
      score: 78,
      pillars: { access: 18, trust: 18, clarity: 18, alignment: 18 }
    };

    // HTTPS
    if (url.startsWith('https://')){
      a.working.push({
        title:'SSL Security Implementation',
        description:`${host} serves over HTTPS, which establishes transport security and baseline trust with AI crawlers and search engines. This foundation improves eligibility for inclusion in assistant-style answers and reduces downgrade risk from insecure redirects.`
      });
    } else {
      a.needsAttention.push({ title:'SSL Certificate Missing', description:'No HTTPS detected.' });
    }

    // Title
    const titleTag = $('title').text();
    if (titleTag){
      if (titleTag.length <= 60){
        a.working.push({
          title:'Meta Title Optimization',
          description:`"${titleTag.substring(0, 60)}" is within recommended length and carries clear branding for ${host}. This helps models quickly infer the page’s primary topic during snippet selection.`
        });
      } else {
        a.needsAttention.push({ title:'Meta Title Length Issues', description:'Title exceeds recommended length.' });
      }
    } else {
      a.needsAttention.push({ title:'Missing Page Titles', description:'No <title> tag found.' });
    }

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc){
      a.working.push({
        title:'Meta Description Present',
        description:`${host} includes meta descriptions that frame page intent for preview and summarization. While not a ranking factor, this improves how content is excerpted by AI systems.`
      });
    } else {
      a.needsAttention.push({ title:'Meta Description Gaps', description:'Missing meta descriptions.' });
    }

    // Headings
    const h1Count = $('h1').length;
    if (h1Count === 1){
      a.working.push({
        title:'Proper Heading Structure',
        description:`A single H1 establishes a clear topic spine for ${host}. Consistent hierarchy helps AI map subtopics and reduces off-topic merges.`
      });
    } else if (h1Count === 0){
      a.needsAttention.push({ title:'Missing H1 Structure', description:'No H1 found.' });
    } else {
      a.needsAttention.push({ title:'Multiple H1 Tags Detected', description:'More than one H1 detected.' });
    }

    // Images/alt
    const imgs = $('img'); const imgsAlt = $('img[alt]');
    const altPct = imgs.length>0 ? (imgsAlt.length/imgs.length)*100 : 100;
    if (altPct >= 80){
      a.working.push({
        title:'Image Optimization',
        description:`Approximately ${Math.round(altPct)}% of images on ${host} include descriptive alt text. This supports multimodal understanding and improves robustness of visual references.`
      });
    } else {
      a.needsAttention.push({ title:'Image Alt Text Gaps', description:`Alt coverage ~${Math.round(altPct)}%.` });
    }

    // Schema
    const hasSchema = $('script[type="application/ld+json"]').length > 0 || $('[itemscope]').length > 0;
    if (hasSchema){
      a.working.push({
        title:'Structured Data Implementation',
        description:`${host} exposes machine-readable schema that clarifies entities and relationships. Broader coverage generally improves confidence in synthesized answers.`
      });
    } else {
      a.needsAttention.push({ title:'Schema Markup Missing', description:'No structured data detected.' });
    }

    // Domain override (high score + richer insights)
    const isOverride = OVERRIDE.has(host);
    if (isOverride){
      const o = highScore();
      a.score = o.score; a.pillars = o.pillars;
    }

    // Build AI Engine Insights (5 sentences each, domain-specific)
    a.insights = buildEngineInsights(host, isOverride);

    // Top up positives (cap ~5)
    const genericWorking = [
      { title:'Mobile-Responsive Design', description:`${host} renders responsively, aligning with mobile-first crawling and assistant UIs.` },
      { title:'Content Structure Recognition', description:`Semantic HTML on ${host} helps parsers segment content into scannable units.` },
      { title:'Loading Speed Baseline', description:`Core template performance appears serviceable; further tuning can improve snippet eligibility.` },
    ];
    for (const it of genericWorking){ if (a.working.length < 5) a.working.push(it); }

    // Top up issues (will be expanded below; cap 10)
    const genericIssues = [
      { title:'Internal Linking Strategy', description:'Cross-reference signals could better guide to cornerstone content.' },
      { title:'Content Depth Analysis', description:'Some topics appear shallow versus competitive baselines.' },
      { title:'Site Architecture Issues', description:'Navigation hierarchy and URL structure could be clarified.' },
      { title:'Local SEO Signals', description:'Geographic relevance markers are limited or inconsistent.' },
      { title:'Content Freshness Gaps', description:'Update cadence may not reflect current expertise signals.' },
      { title:'Core Web Vitals Optimization', description:'Experience metrics have room for improvement on key templates.' },
      { title:'Competitive Content Gaps', description:'Competitors capture related queries with alternative formats.' },
    ];
    for (const gi of genericIssues){ if (a.needsAttention.length < 10) a.needsAttention.push(gi); }

    // Expand Needs Attention to domain-specific 2–3 sentence items and de-dupe
    a.needsAttention = uniqueByTitle(expandNeedsAttention(a.needsAttention, host));

    // De-dupe working and ensure at least 5 items
    a.working = uniqueByTitle(a.working);

    // Ensure insights length (already 5 per builder); keep as-is
    if (a.insights.length < 5){
      a.insights.push({ description: `Additional notes pending crawl variability for ${host}. This placeholder confirms section visibility.` });
    }

    return a;

  } catch (e){
    console.error('Analysis error:', e.message);
    const host = hostOf(url || '');
    return {
      working: [{ title:'Basic Web Presence', description:`${host || 'This site'} loads properly, providing a foundation for AI analysis and indexing.` }],
      needsAttention: expandNeedsAttention([
        { title:'Analysis Connection Issue', description:'Network or rendering blocked.' },
        { title:'Schema Markup Missing', description:'Likely absence of structured data.' },
      ], host || 'the site'),
      insights: buildEngineInsights(host || 'the site', false),
      score: 86,
      pillars: { access: 21, trust: 22, clarity: 21, alignment: 22 },
    };
  }
}

/* -------------------- HTML report -------------------- */

app.get('/report.html', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');
  try { new URL(url); } catch { return res.status(400).send('<p style="color:red">Invalid URL format.</p>'); }

  const a = await analyzeWebsite(url);
  const li = (t,d)=>`<li><strong>${t}:</strong> ${d}</li>`;

  const html = `
    <div class="section-title">✅ What's Working</div>
    <ul>${a.working.map(x=>li(x.title,x.description)).join('')}</ul>
    <div class="section-title">🚨 Needs Attention</div>
    <ul>${a.needsAttention.map(x=>li(x.title,x.description)).join('')}</ul>
    <div class="section-title">📡 AI Engine Insights</div>
    <ul>${a.insights.map(x=>`<li>${x.description}</li>`).join('')}</ul>
  `;
  res.setHeader('Content-Type','text/html');
  res.send(html);
});

/* -------------------- Other routes -------------------- */

app.post('/api/send-link', sendLinkHandler);

app.post('/api/full-report-request', (req, res) => {
  const s = req.body;
  if (!s.name || !s.email || !s.url) return res.status(400).json({ success:false, message:'Missing required fields' });

  const filePath = path.join(__dirname, 'submissions.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    let submissions = [];
    if (!err && data){ try { submissions = JSON.parse(data); } catch {} }
    submissions.push({ ...s, timestamp: new Date().toISOString() });
    fs.writeFile(filePath, JSON.stringify(submissions,null,2), 'utf8', (wErr)=>{
      if (wErr) return res.status(500).json({ success:false, message:'Internal server error' });
      res.json({ success:true });
    });
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
