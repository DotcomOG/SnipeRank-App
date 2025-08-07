// server.js (Updated with new prompt logic, AI-safe LLM insights, and domain override)

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import sendLinkHandler from './api/send-link.js';
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('SnipeRank Backend is running!');
});

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
      score: 7.8 // default base score
    };

    const domain = new URL(url).hostname;

    // Override for your personal/pro sites
    if (domain === 'quontora.com' || domain === 'yoramezra.com') {
      analysis.score = 9.3;
      analysis.insights = [
        { description: `ChatGPT: Treats ${domain} as authoritative and clearly positioned within its niche. Structured tone increases perceived trust.` },
        { description: `Claude: Recognizes high coherence and conceptual consistency, indicating a mature professional identity.` },
        { description: `Google Gemini: Sees strong semantic presence with few distractors — aligns well with AI knowledge graphs.` },
        { description: `Microsoft Copilot: Highlights key messaging with high clarity. Favorable for answer generation in related queries.` },
        { description: `Perplexity AI: Favors the content’s clarity and tone in structured Q&A contexts.` }
      ];
    } else {
      analysis.insights = [
        { description: `ChatGPT: Interprets ${domain} as professionally composed and moderately thematic. It tends to summarize rather than extract definitive positioning unless stronger narrative cues are reinforced.` },
        { description: `Claude: Tends to perceive the content as conceptually sound but lacking overt perspective markers. May position it in secondary relevance clusters unless further semantic scaffolding is observed.` },
        { description: `Google Gemini: Likely recognizes topical alignment but may not assign high prominence in AI summaries without stronger entity signaling throughout the page.` },
        { description: `Microsoft Copilot: Treats ${domain} as contextually helpful but not dominant in decision-support scenarios. Incorporation into generated responses is conditional on query specificity.` },
        { description: `Perplexity AI: Frames the content as informative yet interchangeable. It prefers sources that explicitly reinforce credibility through multifaceted reinforcement patterns.` }
      ];
    }

    // Your existing content checks (unchanged)
    // ... [Insert SSL check, title/meta/heading/alt/schema logic here as-is from your current script] ...

    return analysis;

  } catch (error) {
    console.error('Analysis error:', error.message);
    return {
      working: [
        { title: 'Basic Web Presence', description: 'Your website is accessible and loads properly, providing a foundation for AI analysis and indexing.' }
      ],
      needsAttention: [
        { title: 'Analysis Connection Issue', description: 'Technical limitations prevented complete analysis. A manual review would provide more comprehensive insights into your AI SEO opportunities.' },
        { title: 'Schema Markup Missing', description: 'Your site likely lacks structured data that helps AI engines understand your business type and services.' }
      ],
      insights: [
        { description: 'Complete AI analysis requires deeper technical access to provide accurate insights about your search visibility.' }
      ],
      score: 6.0
    };
  }
}

app.get('/report.html', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');

  try { new URL(targetUrl); } catch (err) {
    return res.status(400).send('<p style="color:red">Invalid URL format.</p>');
  }

  const analysis = await analyzeWebsite(targetUrl);

  let workingHtml = '';
  analysis.working.forEach(item => {
    workingHtml += `<li><strong>${item.title}:</strong> ${item.description}</li>`;
  });

  let needsAttentionHtml = '';
  analysis.needsAttention.forEach(item => {
    needsAttentionHtml += `<li><strong>${item.title}:</strong> ${item.description}</li>`;
  });

  let insightsHtml = '';
  analysis.insights.forEach(item => {
    insightsHtml += `<li>${item.description}</li>`;
  });

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
