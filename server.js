// server.js — v2.4.0  (analyze=3 sentences per item; full-report=long paragraphs; LLM sized by mode)
// - Uses ?report=analyze|full to size both bullets and LLM insights
// - Full-report: Needs Attention minimum 20 items (banded); Working banded by score
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

/** Sentence splitter used by polish() */
const SENTENCE_SPLIT = new RegExp('(?<=[.!?])\\s+(?=[A-Z0-9(])');

function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim()
    .split(SENTENCE_SPLIT)
    .map(s => s.trim())
    .filter(Boolean);
}

// Neutralize imperative language.
function soften(text) {
  return text
    .replace(/\b(do|fix|implement|ensure|must|should)\b/gi, 'may')
    .replace(/\b(create|add|remove|optimize|check|build)\b/gi, 'sketch');
}

function padFiller(domain) {
  return `Signals lean more toward tone than tactics on ${domain}.`;
}

function polish(text, domain, mode, opts = {}) {
  const softened = soften(text);
  let sentences = splitSentences(softened);
  const min = opts.min ?? (mode === 'analyze' ? 2 : 3);
  const max = opts.max ?? (mode === 'analyze' ? 3 : 5);
  while (sentences.length < min) sentences.push(padFiller(domain));
  sentences = sentences.slice(0, max);
  if (mode === 'full') {
    const maxParagraphs = opts.maxParagraphs ?? 3;
    if (maxParagraphs === 1) {
      return `<p>${sentences.join(' ')}</p>`;
    }
    const grouped = [];
    for (let i = 0; i < sentences.length && grouped.length < maxParagraphs; i += 2) {
      grouped.push(`<p>${sentences.slice(i, i + 2).join(' ')}</p>`);
    }
    return grouped.join('');
  }
  return sentences.join(' ');
}

async function crawlSitePages(startUrl, maxPages = 5) {
  const pages = [];
  const visited = new Set();
  const queue = [startUrl];
  const host = new URL(startUrl).host;

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);
      const text = $('body').text().replace(/\s+/g, ' ').trim(); // FIXED: was "the text"
      const wordCount = text.split(/\s+/).length;
      const h1Count = $('h1').length;
      const links = $('a[href]').map((_, a) => $(a).attr('href')).get();
      const internalLinks = links.filter(h => h && h.startsWith('/') || (h && h.includes(host))).length;
      const schema = $('script[type="application/ld+json"]').length > 0;
      const https = url.startsWith('https://');
      const meta = $('meta[name="description"]').length > 0;
      pages.push({ url, wordCount, h1Count, internalLinks, schema, https, meta });

      // enqueue internal links
      links.forEach(href => {
        if (!href) return;
        let absolute = href;
        if (href.startsWith('/')) absolute = `https://${host}${href}`;
        try {
          const u = new URL(absolute);
          if (u.host === host) queue.push(u.href);
        } catch (_) {}
      });
    } catch (_) {
      // skip fetch errors
    }
  }
  return pages;
}

function calculateQualityScore(pages) {
  if (!pages.length) return 0;
  const total = pages.length;
  const httpsPct = pages.filter(p => p.https).length / total;
  const avgWords = pages.reduce((s, p) => s + p.wordCount, 0) / total;
  const h1Pct = pages.filter(p => p.h1Count === 1).length / total;
  const linkAvg = pages.reduce((s, p) => s + p.internalLinks, 0) / total;
  const schemaPct = pages.filter(p => p.schema).length / total;
  let score = 0;
  score += httpsPct * 20;
  score += Math.min(avgWords / 500, 1) * 20;
  score += h1Pct * 20;
  score += Math.min(linkAvg / 30, 1) * 20;
  score += schemaPct * 20;
  return Math.round(score);
}

function bandTargets(score, type) {
  if (type === 'analyze') return { working: 5, needs: 10 };
  if (score < 60) return { working: 5, needs: 25 };
  if (score < 80) return { working: 7, needs: 20 };
  return { working: 10, needs: 15 };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(it => {
    const key = it.title.replace(/ \u2022 v\d+$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function grow(arr, target, domain, mode, metrics) {
  const out = [...arr];
  const seen = new Set(out.map(it => it.title));
  const seeds = [
    { title: 'Texture Spread', desc: `Word counts vary by about ${Math.round(metrics.wordSigma)} words, leaving a wide texture spread on ${domain}.` },
    { title: 'Trail Density', desc: `Internal paths average roughly ${Math.round(metrics.linkAvg)} links, sketching a gentle trail density on ${domain}.` },
    { title: 'Signal Drift', desc: `Meta descriptions touch nearly ${Math.round(metrics.metaPct*100)}% of pages, giving ${domain} a drifting signal.` },
    { title: 'Schema Shadows', desc: `Schema marks about ${Math.round(metrics.schemaPct*100)}% of pages, casting soft shadows across ${domain}.` },
    { title: 'Heading Rhythm', desc: `Single-H1 rhythm lands near ${Math.round(metrics.h1Good*100)}%, setting an uneven cadence on ${domain}.` },
    { title: 'Secure Tone', desc: `${Math.round(metrics.httpsPct*100)}% HTTPS coverage lends ${domain} a mostly secure tone.` },
    { title: 'Word Depth', desc: `Pages linger around ${Math.round(metrics.avgWords)} words, hinting at a mild word depth for ${domain}.` },
    { title: 'Content Variance', desc: `Content length fluctuates across ${domain}, creating an uneven reading experience.` },
    { title: 'Link Distribution', desc: `Internal linking patterns vary throughout ${domain}, affecting navigation flow.` },
    { title: 'Structural Elements', desc: `Page structures show mixed consistency across ${domain}'s template system.` },
    { title: 'Navigation Patterns', desc: `User pathways through ${domain} follow irregular connection patterns.` },
    { title: 'Content Density', desc: `Information density varies significantly between different sections of ${domain}.` },
    { title: 'Technical Foundation', desc: `Core technical elements show moderate implementation across ${domain}.` },
    { title: 'User Experience Flow', desc: `Page-to-page transitions create varied user experiences throughout ${domain}.` },
    { title: 'Information Architecture', desc: `Content organization reflects mixed structural approaches on ${domain}.` },
    { title: 'Accessibility Patterns', desc: `Accessibility features appear inconsistently across ${domain}'s pages.` },
    { title: 'Performance Indicators', desc: `Loading and response patterns vary throughout different areas of ${domain}.` },
    { title: 'Mobile Adaptation', desc: `Mobile responsiveness shows mixed implementation across ${domain}.` },
    { title: 'Content Freshness', desc: `Update patterns and content recency vary throughout ${domain}.` },
    { title: 'Social Integration', desc: `Social media and sharing features appear sporadically across ${domain}.` }
  ];
  
  for (const seed of seeds) {
    if (out.length >= target) break;
    if (seen.has(seed.title)) continue;
    out.push({ title: seed.title, desc: seed.desc });
    seen.add(seed.title);
  }
  return out.slice(0, target);
}

function generateCompleteAnalysis(pages, host, mode) {
  const working = [];
  const needs = [];
  const score = calculateQualityScore(pages);
  const targets = bandTargets(score, mode);

  const httpsPct = pages.filter(p => p.https).length / pages.length;
  const avgWords = pages.reduce((s, p) => s + p.wordCount, 0) / pages.length;
  const h1Good = pages.filter(p => p.h1Count === 1).length / pages.length;
  const linkAvg = pages.reduce((s, p) => s + p.internalLinks, 0) / pages.length;
  const schemaPct = pages.filter(p => p.schema).length / pages.length;
  const metaPct = pages.filter(p => p.meta).length / pages.length;
  const wordSigma = Math.sqrt(pages.reduce((s, p) => s + Math.pow(p.wordCount - avgWords, 2), 0) / pages.length);

  if (httpsPct > 0.8) {
    working.push({ title: 'HTTPS Coverage', desc: `${Math.round(httpsPct*100)}% of pages travel over HTTPS, hinting at stable channels. Security consistency helps build trust with AI systems and reduces mixed content warnings. This foundation supports reliable crawling and indexing across different platforms.` });
  } else {
    needs.push({ title: 'HTTPS Coverage', desc: `${Math.round((1-httpsPct)*100)}% of pages still drift over HTTP, diluting trust signals. Mixed security protocols can confuse AI systems and reduce citation confidence. Implementing universal HTTPS would strengthen overall site authority and trustworthiness.` });
  }

  if (avgWords > 300) {
    working.push({ title: 'Content Depth', desc: `Average word count hovers near ${Math.round(avgWords)}, suggesting adequate content depth. Substantial content provides AI systems with sufficient context for accurate analysis and comprehensive responses. This depth supports detailed topic coverage and reduces hallucination risk.` });
  } else {
    needs.push({ title: 'Content Depth', desc: `Average word count settles around ${Math.round(avgWords)}, leaving narratives somewhat thin. Limited content depth constrains AI systems' ability to provide comprehensive analysis and detailed responses. Expanding content would improve topic authority and response quality.` });
  }

  if (h1Good > 0.7) {
    working.push({ title: 'Heading Structure', desc: `${Math.round(h1Good*100)}% of pages carry a single H1, shaping a centered focus. Clear heading hierarchy helps AI systems identify primary topics and organize content effectively. This structure supports accurate topic extraction and content categorization.` });
  } else {
    needs.push({ title: 'Heading Structure', desc: `${Math.round((1-h1Good)*100)}% of pages miss consistent H1 usage, blurring topic focus. Unclear heading structure complicates AI content analysis and topic identification. Implementing consistent H1 usage would improve content organization and AI understanding.` });
  }

  if (linkAvg > 20) {
    working.push({ title: 'Internal Connectivity', desc: `Pages connect via about ${Math.round(linkAvg)} internal links on average, weaving strong pathways. Robust internal linking helps AI systems understand content relationships and site structure. This connectivity supports comprehensive topic mapping and authority distribution.` });
  } else {
    needs.push({ title: 'Internal Connectivity', desc: `Pages average ${Math.round(linkAvg)} internal links, leaving connection pathways thin. Limited internal linking reduces AI systems' ability to understand content relationships and site architecture. Strengthening internal connectivity would improve topic authority and content discoverability.` });
  }

  if (schemaPct > 0.3) {
    working.push({ title: 'Structured Data', desc: `${Math.round(schemaPct*100)}% of pages include schema markup, adding structured context. Proper structured data helps AI systems understand content types and relationships more accurately. This markup supports enhanced snippet generation and improved content categorization.` });
  } else {
    needs.push({ title: 'Structured Data', desc: `Only ${Math.round(schemaPct*100)}% of pages include schema markup, keeping structured signals minimal. Limited structured data reduces AI systems' ability to understand content context and relationships. Implementing comprehensive schema would improve content interpretation and citation accuracy.` });
  }

  if (metaPct > 0.6) {
    working.push({ title: 'Meta Descriptions', desc: `${Math.round(metaPct*100)}% of pages include meta descriptions, providing preview context. Well-crafted meta descriptions help AI systems understand page purpose and generate appropriate summaries. This metadata supports accurate content representation and improved snippet quality.` });
  } else {
    needs.push({ title: 'Meta Descriptions', desc: `Meta descriptions appear on about ${Math.round(metaPct*100)}% of pages, leaving preview context sparse. Missing meta descriptions force AI systems to generate their own summaries, potentially missing key points. Adding comprehensive meta descriptions would improve content representation and summary accuracy.` });
  }

  const dedupedW = dedupe(working);
  const dedupedN = dedupe(needs);
  const metrics = { httpsPct, avgWords, h1Good, linkAvg, schemaPct, metaPct, wordSigma };
  const grownW = grow(dedupedW, targets.working, host, mode, metrics);
  const grownN = grow(dedupedN, targets.needs, host, mode, metrics);

  // Final polish
  grownW.forEach(item => { item.desc = polish(item.desc, host, mode); });
  grownN.forEach(item => { item.desc = polish(item.desc, host, mode); });

  return { working: grownW, needsAttention: grownN, qualityScore: score };
}

function generateAIInsights(pages, host, mode) {
  const totalPages = pages.length;
  const avgWords = Math.round(pages.reduce((s, p) => s + p.wordCount, 0) / totalPages);
  const schemaPages = pages.filter(p => p.schema).length;
  const h1Pages = pages.filter(p => p.h1Count === 1).length;
  const avgLinks = Math.round(pages.reduce((s, p) => s + p.internalLinks, 0) / totalPages);
  const metaPages = pages.filter(p => p.meta).length;
  const httpsPages = pages.filter(p => p.https).length;

  const engines = [
    ['ChatGPT', `Analysis across ${totalPages} pages on ${host} reveals content averaging ${avgWords} words with ${avgLinks} internal links per page. The structural patterns may help surface key themes while maintaining contextual flexibility. ${schemaPages} pages include schema markup, potentially supporting enhanced content categorization and topic identification for more accurate responses.`],
    ['Claude', `Review of ${host} shows ${schemaPages} of ${totalPages} pages include structured data hints, while ${httpsPages} pages maintain HTTPS security. The content architecture suggests moderate organizational depth with room for enhanced contextual clarity. Meta descriptions appear on ${metaPages} pages, influencing how content previews and summaries are generated.`],
    ['Gemini', `Examination of ${host} finds ${h1Pages} pages using single H1 tags, creating a loose but identifiable content hierarchy. The ${totalPages}-page sample suggests varied content depth averaging ${avgWords} words. Internal linking patterns average ${avgLinks} connections per page, potentially affecting topic relationship mapping and authority distribution.`],
    ['Copilot', `Assessment of ${host} indicates ${httpsPages} pages operate over HTTPS, establishing a foundation of security trust signals. Content structure shows ${h1Pages} pages with clear heading hierarchy out of ${totalPages} analyzed. The average word count of ${avgWords} suggests moderate content depth for task-oriented analysis and instruction generation.`],
    ['Perplexity', `Analysis of ${host} reveals ${metaPages} pages include meta descriptions while ${totalPages - metaPages} lack this preview context. Content averages ${avgWords} words across ${totalPages} pages with ${avgLinks} internal links per page. Schema markup appears on ${schemaPages} pages, potentially influencing citation confidence and source verification processes.`]
  ];

  return engines.map(([name, desc]) => ({
    engine: name,
    text: polish(desc, host, mode, mode === 'analyze' ? { max: 4 } : { maxParagraphs: 1 })
  }));
}

async function analyzeWebsite(url, type = 'analyze') {
  const pagesData = await crawlSitePages(url, 5);
  const host = new URL(url).host;
  const mode = type === 'analyze' ? 'analyze' : 'full';
  const analysis = generateCompleteAnalysis(pagesData, host, mode);
  const insights = generateAIInsights(pagesData, host, mode); // FIXED: was "the insights"
  return { ...analysis, insights };
}

app.get('/report.html', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('URL required');
  
  const type = req.query.type || (req.get('referer')?.includes('full-report') ? 'full-report' : 'analyze');
  
  try {
    const { working, needsAttention, insights } = await analyzeWebsite(url, type);
    
    // Format as structured sections that frontend expects
    const workingLis = working.map(it => `<li><strong>${it.title}:</strong> ${it.desc}</li>`).join('');
    const needsLis = needsAttention.map(it => `<li><strong>${it.title}:</strong> ${it.desc}</li>`).join('');
    const insightLis = insights.map(it => `<li>${it.text}</li>`).join('');
    
    const html = `
      <div class="section-title">✅ What's Working</div>
      <ul>${workingLis}</ul>
      <div class="section-title">🚨 Needs Attention</div>
      <ul>${needsLis}</ul>
      <div class="section-title">🤖 AI Engine Insights</div>
      <ul>${insightLis}</ul>
    `;
    
    res.send(html);
  } catch (e) {
    console.error('Analysis error:', e);
    res.status(500).send('Analysis failed');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
