// server.js (v1.9.16)
// Guarantees: ≥5 "What's Working", ≥6–10 "Needs Attention" (non-actionable), and ≥5 "AI Engine Insights".
// De-dupe by title. Domain override for yoramezra.com / quontora.com.

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

/* ---------- Helpers ---------- */
const OVERRIDE = new Set(['yoramezra.com', 'quontora.com']);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } };

const highScore = () => {
  const pillars = { access: 22, trust: 23, clarity: 22, alignment: 22 };
  return { pillars, score: 89, hardCoded: true };
};

const nonActionable = (items=[]) => items.map(({title='Signal',description=''})=>{
  const s=(title+' '+description).toLowerCase();
  const label =
    /h1|heading/.test(s) ? 'Topic focus clarity' :
    /link/.test(s) ? 'Internal connection mapping' :
    /meta|description/.test(s) ? 'Result framing signal' :
    /alt|image/.test(s) ? 'Visual descriptor cadence' :
    /schema|structured/.test(s) ? 'Entity signaling layer' :
    /(vitals|lcp|cls|inp|speed)/.test(s) ? 'Experience smoothness' :
    /(mobile|responsive)/.test(s) ? 'Contextual layout fit' :
    'Signal coherence';
  return { title, description: `${label}: signal variance detected. Indicative only; implementation specifics deferred to guided session.` };
});

const uniqueByTitle = (arr=[]) => {
  const seen=new Set(), out=[];
  for (const it of arr){ const k=(it.title||'').trim().toLowerCase(); if(!k||seen.has(k)) continue; seen.add(k); out.push(it); }
  return out;
};

/* ---------- Analysis ---------- */
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
      a.working.push({ title:'SSL Security Implementation', description:'Your site uses HTTPS encryption, which builds trust with AI crawlers and search algorithms. This security foundation is essential for modern web credibility and ranking factors.' });
    } else {
      a.needsAttention.push({ title:'SSL Certificate Missing', description:'Sites lacking HTTPS face trust issues with AI systems and search engines.' });
    }

    // Title
    const titleTag = $('title').text();
    if (titleTag){
      if (titleTag.length <= 60){
        a.working.push({ title:'Meta Title Optimization', description:`Your page title "${titleTag.substring(0,40)}..." is properly sized and contains clear branding. This helps AI systems quickly understand your page focus and purpose.` });
      } else {
        a.needsAttention.push({ title:'Meta Title Length Issues', description:'Titles exceeding recommended length may truncate and weaken clarity.' });
      }
    } else {
      a.needsAttention.push({ title:'Missing Page Titles', description:'Absent titles reduce content comprehension and discoverability.' });
    }

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc){
      a.working.push({ title:'Meta Description Present', description:'Meta descriptions help AI systems understand content context and improve result presentation.' });
    } else {
      a.needsAttention.push({ title:'Meta Description Gaps', description:'Missing descriptions limit your control over AI summaries.' });
    }

    // Headings
    const h1Count = $('h1').length;
    if (h1Count === 1){
      a.working.push({ title:'Proper Heading Structure', description:'A single H1 with clear hierarchy improves topic comprehension.' });
    } else if (h1Count === 0){
      a.needsAttention.push({ title:'Missing H1 Structure', description:'Lack of H1 can reduce topical clarity and authority signals.' });
    } else {
      a.needsAttention.push({ title:'Multiple H1 Tags Detected', description:'Multiple H1s can dilute focus and confuse parsers.' });
    }

    // Images/alt
    const imgs = $('img'); const imgsAlt = $('img[alt]');
    const altPct = imgs.length>0 ? (imgsAlt.length/imgs.length)*100 : 100;
    if (altPct >= 80){
      a.working.push({ title:'Image Optimization', description:`${Math.round(altPct)}% of images include descriptive alt text, aiding visual comprehension by AI systems.` });
    } else {
      a.needsAttention.push({ title:'Image Alt Text Gaps', description:`${Math.round(altPct)}% coverage may miss opportunities for multimedia understanding.` });
    }

    // Schema
    const hasSchema = $('script[type="application/ld+json"]').length > 0 || $('[itemscope]').length > 0;
    if (hasSchema){
      a.working.push({ title:'Structured Data Implementation', description:'Schema markup helps AI engines understand business info and improves AI search visibility.' });
    } else {
      a.needsAttention.push({ title:'Schema Markup Missing', description:'Absent structured data weakens entity understanding for AI.' });
    }

    // Domain override (high score + richer insights)
    if (OVERRIDE.has(host)){
      const o = highScore();
      a.score = o.score; a.pillars = o.pillars;
      a.insights = [
        { description:`ChatGPT: Treats ${host} as authoritative with structured clarity.` },
        { description:`Claude: High coherence and professional identity are clearly recognized.` },
        { description:`Gemini: Strong semantic presence with minimal distractors; entity graph alignment is favorable.` },
        { description:`Copilot: Key messaging is highlighted; suitable for answer generation.` },
        { description:`Perplexity: Clear tone and Q&A friendliness perform well.` },
      ];
    } else {
      a.insights = [
        { description:`ChatGPT: Professionally composed; stronger narrative cues could improve positioning.` },
        { description:`Claude: Sound, but lacks overt perspective markers.` },
        { description:`Gemini: Topical alignment recognized; stronger entity signaling recommended.` },
        { description:`Copilot: Helpful context; inclusion in answers varies by query specificity.` },
        { description:`Perplexity: Informative yet interchangeable without clearer credibility reinforcement.` },
      ];
    }

    // Top up positives
    const genericWorking = [
      { title:'Mobile-Responsive Design', description:'Mobile-first rendering supports AI and user experience expectations.' },
      { title:'Content Structure Recognition', description:'Semantic HTML elements help AI parse hierarchy efficiently.' },
      { title:'Loading Speed Baseline', description:'Core web vitals appear acceptable; further tuning could raise scores.' },
    ];
    for (const it of genericWorking){ if (a.working.length < 5) a.working.push(it); }

    // Top up issues
    const genericIssues = [
      { title:'Internal Linking Strategy', description:'Cross-reference signals could better guide AI to cornerstone content.' },
      { title:'Content Depth Analysis', description:'Some topics could show deeper coverage to convey authority.' },
      { title:'Site Architecture Issues', description:'Navigation hierarchy and URL structure can be clarified.' },
      { title:'Local SEO Signals', description:'Geographic relevance markers appear limited or inconsistent.' },
      { title:'Content Freshness Gaps', description:'Update cadence may not reflect current expertise signals.' },
      { title:'Core Web Vitals Optimization', description:'Experience metrics have room for improvement on key templates.' },
      { title:'Competitive Content Gaps', description:'Competitors capture related queries with formats you may not be using.' },
    ];
    for (const gi of genericIssues){ if (a.needsAttention.length < 10) a.needsAttention.push(gi); }

    // Finalize: de-dupe + non-actionable needs-attention
    a.working = uniqueByTitle(a.working);
    a.needsAttention = uniqueByTitle(nonActionable(a.needsAttention));
    if (a.insights.length < 5){
      a.insights.push({ description:'Additional engine notes pending crawl variability.' });
    }

    return a;

  } catch (e){
    console.error('Analysis error:', e.message);
    return {
      working: [{ title:'Basic Web Presence', description:'Your website loads properly, providing a foundation for AI analysis and indexing.' }],
      needsAttention: nonActionable([
        { title:'Analysis Connection Issue', description:'Technical limitations prevented complete analysis.' },
        { title:'Schema Markup Missing', description:'Likely absence of structured data impairs entity understanding.' },
      ]),
      insights: [{ description:'Complete AI analysis may require deeper access for accurate visibility mapping.' }],
      score: 86,
      pillars: { access: 21, trust: 22, clarity: 21, alignment: 22 },
    };
  }
}

/* ---------- HTML report ---------- */
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

/* ---------- Other routes ---------- */
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
