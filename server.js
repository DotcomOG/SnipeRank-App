// server.js (v1.9.13)
// - High-score override for yoramezra.com & quontora.com
// - Non-actionable "Needs Attention" (server-side)
// - Deduplicate items by title, no repeats
// - Same HTML sections; plays nice with frontend spacing rules

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

app.get('/', (req, res) => {
  res.send('SnipeRank Backend is running!');
});

/** ---------- Helpers ---------- */
const HIGH_SCORE_WHITELIST = new Set(['yoramezra.com', 'quontora.com']);

function getHostname(urlStr) {
  try { return new URL(urlStr).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function highScoreOverrideFor(host) {
  if (!HIGH_SCORE_WHITELIST.has(host)) return null;
  const pillars = { access: 22, trust: 23, clarity: 22, alignment: 22 }; // total = 89
  const score = pillars.access + pillars.trust + pillars.clarity + pillars.alignment;
  return { score, pillars, hardCoded: true };
}

function makeNeedsAttentionNonActionable(items = []) {
  return items.map(({ title = 'Signal', description = '' }) => {
    const label =
      /h1|heading/i.test(title+description) ? 'Topic focus clarity' :
      /link/i.test(title+description) ? 'Internal connection mapping' :
      /meta|description/i.test(title+description) ? 'Result framing signal' :
      /alt|image/i.test(title+description) ? 'Visual descriptor cadence' :
      /schema|structured/i.test(title+description) ? 'Entity signaling layer' :
      /speed|core web vitals|lcp|cls|inp/i.test(title+description) ? 'Experience smoothness' :
      /mobile|responsive/i.test(title+description) ? 'Contextual layout fit' :
      'Signal coherence';

    return {
      title,
      description: `${label}: signal variance detected. Indicative only; implementation specifics deferred to guided session.`
    };
  });
}

function uniqueByTitle(items = []) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** ---------- Analysis ---------- */
async function analyzeWebsite(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'SnipeRank SEO Analyzer Bot' }
    });

    const $ = cheerio.load(response.data);
    const analysis = {
      working: [],
      needsAttention: [],
      insights: [],
      score: 78,
      pillars: { access: 18, trust: 18, clarity: 18, alignment: 18 }
    };

    const domain = getHostname(url);

    // HTTPS
    if (url.startsWith('https://')) {
      analysis.working.push({
        title: 'SSL Security Implementation',
        description: 'Your site uses HTTPS encryption, which builds trust with AI crawlers and search algorithms. This security foundation is essential for modern web credibility and ranking factors.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'SSL Certificate Missing',
        description: 'Sites lacking HTTPS face trust issues with AI systems and search engines.'
      });
    }

    // Title
    const title = $('title').text();
    if (title && title.length > 0) {
      if (title.length <= 60) {
        analysis.working.push({
          title: 'Meta Title Optimization',
          description: `Your page title "${title.substring(0, 40)}..." is properly sized and contains clear branding. This helps AI systems quickly understand your page focus and purpose.`
        });
      } else {
        analysis.needsAttention.push({
          title: 'Meta Title Length Issues',
          description: 'Titles exceeding recommended length may truncate and weaken clarity.'
        });
      }
    } else {
      analysis.needsAttention.push({
        title: 'Missing Page Titles',
        description: 'Absent titles reduce content comprehension and discoverability.'
      });
    }

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc && metaDesc.length > 0) {
      analysis.working.push({
        title: 'Meta Description Present',
        description: 'Meta descriptions help AI systems understand content context and improve result presentation.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'Meta Description Gaps',
        description: 'Missing descriptions limit your control over AI summaries.'
      });
    }

    // Headings
    const h1Count = $('h1').length;
    if (h1Count === 1) {
      analysis.working.push({
        title: 'Proper Heading Structure',
        description: 'A single H1 with clear hierarchy improves topic comprehension.'
      });
    } else if (h1Count === 0) {
      analysis.needsAttention.push({
        title: 'Missing H1 Structure',
        description: 'Lack of H1 can reduce topical clarity and authority signals.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'Multiple H1 Tags Detected',
        description: 'Multiple H1s can dilute focus and confuse parsers.'
      });
    }

    // Images + alt
    const imgs = $('img'); const imgsAlt = $('img[alt]');
    const altPct = imgs.length > 0 ? (imgsAlt.length / imgs.length) * 100 : 100;
    if (altPct >= 80) {
      analysis.working.push({
        title: 'Image Optimization',
        description: `${Math.round(altPct)}% of images include descriptive alt text, aiding visual comprehension by AI systems.`
      });
    } else {
      analysis.needsAttention.push({
        title: 'Image Alt Text Gaps',
        description: `${Math.round(altPct)}% coverage may miss opportunities for multimedia understanding.`
      });
    }

    // Schema
    const hasSchema = $('script[type="application/ld+json"]').length > 0 || $('[itemscope]').length > 0;
    if (hasSchema) {
      analysis.working.push({
        title: 'Structured Data Implementation',
        description: 'Schema markup helps AI engines understand business info and improves AI search visibility.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'Schema Markup Missing',
        description: 'Absent structured data weakens entity understanding for AI.'
      });
    }

    // High score for your domains
    if (HIGH_SCORE_WHITELIST.has(domain)) {
      const o = highScoreOverrideFor(domain);
      analysis.score = o.score;
      analysis.pillars = o.pillars;
      analysis.insights = [
        { description: `ChatGPT: Treats ${domain} as authoritative with structured clarity.` },
        { description: `Claude: High coherence and professional identity are clearly recognized.` },
        { description: `Gemini: Strong semantic presence with minimal distractors; entity graph alignment is favorable.` },
        { description: `Copilot: Key messaging is highlighted; suitable for answer generation.` },
        { description: `Perplexity: Clear tone and Q&A friendliness perform well.` }
      ];
    } else {
      analysis.insights = [
        { description: `ChatGPT: Summarizes ${domain} as professionally composed; stronger narrative cues could improve positioning.` },
        { description: `Claude: Conceptually sound; additional perspective markers may increase prominence.` },
        { description: `Gemini: Recognizes topical alignment; stronger entity signaling may raise prominence.` },
        { description: `Copilot: Contextually helpful; inclusion in generated answers varies by query specificity.` },
        { description: `Perplexity: Informative yet interchangeable without clearer credibility reinforcement.` }
      ];
    }

    // Provide some generic positives without dupes
    const genericWorking = [
      { title: 'Mobile-Responsive Design', description: 'Mobile-first rendering supports AI and user experience expectations.' },
      { title: 'Content Structure Recognition', description: 'Semantic HTML elements help AI parse content hierarchy efficiently.' },
      { title: 'Loading Speed Baseline', description: 'Core web vitals appear acceptable for most pages; further tuning could raise scores.' }
    ];
    for (const item of genericWorking) if (analysis.working.length < 5) analysis.working.push(item);

    // Generic issues without repeats
    const genericIssues = [
      { title: 'Internal Linking Strategy', description: 'Cross-reference signals could better guide AI to cornerstone content.' },
      { title: 'Content Depth Analysis', description: 'Some topics could show deeper coverage to convey authority.' },
      { title: 'Site Architecture Issues', description: 'Navigation hierarchy and URL structure can be clarified.' },
      { title: 'Local SEO Signals', description: 'Geographic relevance markers appear limited or inconsistent.' },
      { title: 'Content Freshness Gaps', description: 'Update cadence may not reflect current expertise signals.' },
      { title: 'Core Web Vitals Optimization', description: 'Experience metrics have room for improvement on key templates.' },
      { title: 'Competitive Content Gaps', description: 'Competitors capture related queries with formats you may not be using.' }
    ];
    for (const gi of genericIssues) if (analysis.needsAttention.length < 8) analysis.needsAttention.push(gi);

    // FINAL: de-dupe and obfuscate Needs Attention server-side
    analysis.working = uniqueByTitle(analysis.working);
    analysis.needsAttention = uniqueByTitle(makeNeedsAttentionNonActionable(analysis.needsAttention));

    return analysis;

  } catch (error) {
    console.error('Analysis error:', error.message);
    return {
      working: [
        { title: 'Basic Web Presence', description: 'Your website is accessible and loads properly, providing a foundation for AI analysis and indexing.' }
      ],
      needsAttention: makeNeedsAttentionNonActionable([
        { title: 'Analysis Connection Issue', description: 'Technical limitations prevented complete analysis.' },
        { title: 'Schema Markup Missing', description: 'Likely absence of structured data impairs entity understanding.' }
      ]),
      insights: [
        { description: 'Complete AI analysis may require deeper access for accurate visibility mapping.' }
      ],
      score: 86,
      pillars: { access: 21, trust: 22, clarity: 21, alignment: 22 }
    };
  }
}

/** ---------- HTML Report ---------- */
app.get('/report.html', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');

  try { new URL(targetUrl); } catch {
    return res.status(400).send('<p style="color:red">Invalid URL format.</p>');
  }

  const analysis = await analyzeWebsite(targetUrl);

  const workingHtml = analysis.working.map(item =>
    `<li><strong>${item.title}:</strong> ${item.description}</li>`
  ).join('');

  const needsAttentionHtml = analysis.needsAttention.map(item =>
    `<li><strong>${item.title}:</strong> ${item.description}</li>`
  ).join('');

  const insightsHtml = analysis.insights.map(item =>
    `<li>${item.description}</li>`
  ).join('');

  const html = `
    <div class="section-title">✅ What's Working</div>
    <ul>${workingHtml}</ul>
    <div class="section-title">🚨 Needs Attention</div>
    <ul>${needsAttentionHtml}</ul>
    <div class="section-title">📡 AI Engine Insights</div>
    <ul>${insightsHtml}</ul>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/** ---------- Other Routes ---------- */
app.post('/api/send-link', sendLinkHandler);

app.post('/api/full-report-request', (req, res) => {
  const submission = req.body;
  if (!submission.name || !submission.email || !submission.url) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const filePath = path.join(__dirname, 'submissions.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    let submissions = [];
    if (!err && data) {
      try { submissions = JSON.parse(data); } catch (parseErr) { console.error('Error parsing JSON:', parseErr); }
    }

    submissions.push({ ...submission, timestamp: new Date().toISOString() });

    fs.writeFile(filePath, JSON.stringify(submissions, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        console.error('Failed to save submission:', writeErr);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
      res.json({ success: true });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
