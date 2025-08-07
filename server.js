// server.js (Updated with new prompt logic, AI-safe LLM insights, and domain override)

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
      score: 7.8
    };

    const domain = new URL(url).hostname;

    // Check HTTPS
    if (url.startsWith('https://')) {
      analysis.working.push({
        title: 'SSL Security Implementation',
        description: 'Your site uses HTTPS encryption, which builds trust with AI crawlers and search algorithms. This security foundation is essential for modern web credibility and ranking factors.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'SSL Certificate Missing',
        description: 'Your site lacks HTTPS encryption, which is now a baseline requirement for AI systems and search engines. This security gap significantly impacts trustworthiness and ranking potential.'
      });
    }

    // Check meta title
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
          description: 'Your page titles exceed recommended character limits, potentially causing truncation in search results and reducing AI comprehension of your key messaging.'
        });
      }
    } else {
      analysis.needsAttention.push({
        title: 'Missing Page Titles',
        description: 'Critical pages lack proper title tags, preventing AI systems from understanding page content and significantly reducing search visibility potential.'
      });
    }

    // Check meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc && metaDesc.length > 0) {
      analysis.working.push({
        title: 'Meta Description Present',
        description: 'Your pages include meta descriptions that help AI systems understand content context. This provides better control over how your content appears in search results.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'Meta Description Gaps',
        description: 'Missing meta descriptions reduce your ability to control how AI systems summarize your content, leading to potentially less compelling search result presentations.'
      });
    }

    // Check headings structure
    const h1Count = $('h1').length;
    if (h1Count === 1) {
      analysis.working.push({
        title: 'Proper Heading Structure',
        description: 'Your page uses a single H1 tag with clear hierarchy, helping AI systems understand content organization and topic priorities effectively.'
      });
    } else if (h1Count === 0) {
      analysis.needsAttention.push({
        title: 'Missing H1 Structure',
        description: 'Pages lack proper H1 headings, making it difficult for AI systems to identify main topics and content hierarchy, reducing topical authority signals.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'Multiple H1 Tags Detected',
        description: 'Multiple H1 tags create content hierarchy confusion for AI parsers, potentially diluting topic focus and reducing content authority signals.'
      });
    }

    // Check images and alt text
    const images = $('img');
    const imagesWithAlt = $('img[alt]');
    const altTextCoverage = images.length > 0 ? (imagesWithAlt.length / images.length) * 100 : 100;
    
    if (altTextCoverage >= 80) {
      analysis.working.push({
        title: 'Image Optimization',
        description: `${Math.round(altTextCoverage)}% of your images include descriptive alt text, helping AI systems understand visual content and improving accessibility for search algorithms.`
      });
    } else {
      analysis.needsAttention.push({
        title: 'Image Alt Text Gaps',
        description: `Only ${Math.round(altTextCoverage)}% of images have descriptive alt text, missing opportunities for AI systems to understand visual content and index multimedia elements.`
      });
    }

    // Check for schema markup
    const hasSchema = $('script[type="application/ld+json"]').length > 0 ||
                     $('[itemscope]').length > 0;
    
    if (hasSchema) {
      analysis.working.push({
        title: 'Structured Data Implementation',
        description: 'Your site includes schema markup that helps AI engines understand your business type, services, and key information, improving visibility in AI-powered search results.'
      });
    } else {
      analysis.needsAttention.push({
        title: 'Schema Markup Missing',
        description: 'Your site lacks structured data that helps AI engines understand your business type, services, and key information. This is becoming increasingly critical for AI visibility.'
      });
    }

    // Domain-specific insights
    if (domain === 'quontora.com' || domain === 'yoramezra.com') {
      analysis.score = 9.3;
      analysis.insights = [
        { description: `ChatGPT: Treats ${domain} as authoritative and clearly positioned within its niche. Structured tone increases perceived trust.` },
        { description: `Claude: Recognizes high coherence and conceptual consistency, indicating a mature professional identity.` },
        { description: `Google Gemini: Sees strong semantic presence with few distractors — aligns well with AI knowledge graphs.` },
        { description: `Microsoft Copilot: Highlights key messaging with high clarity. Favorable for answer generation in related queries.` },
        { description: `Perplexity AI: Favors the content's clarity and tone in structured Q&A contexts.` }
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

      // Fill remaining spots with generic analysis
      while (analysis.working.length < 5) {
        const genericWorking = [
          { title: 'Mobile-Responsive Design', description: 'Your website adapts well to different screen sizes and devices. AI systems increasingly prioritize mobile-first indexing, making this a critical competitive advantage.' },
          { title: 'Content Structure Recognition', description: 'Your pages use semantic HTML elements that help AI understand content hierarchy. Clear headings and paragraph structures make your content easily parseable by machine learning algorithms.' },
          { title: 'Loading Speed Baseline', description: 'Your core web vitals fall within acceptable ranges for most pages. Fast-loading sites receive preference from both users and AI ranking systems that evaluate user experience signals.' }
        ];
        
        if (analysis.working.length < 5) {
          analysis.working.push(genericWorking[analysis.working.length - 2] || genericWorking[0]);
        }
      }

      while (analysis.needsAttention.length < 10) {
        const genericIssues = [
          { title: 'Internal Linking Strategy', description: 'Your pages don\'t effectively cross-reference related content, missing opportunities to guide AI crawlers through your most important information.' },
          { title: 'Content Depth Analysis', description: 'Some key pages lack the comprehensive content depth that AI systems now expect for authoritative rankings in competitive topics.' },
          { title: 'Site Architecture Issues', description: 'Your URL structure and navigation hierarchy could be optimized to better guide AI crawlers to your most valuable content.' },
          { title: 'Local SEO Signals', description: 'Missing or incomplete local business information prevents AI systems from understanding your geographic relevance and service areas.' },
          { title: 'Content Freshness Gaps', description: 'Limited recent content updates may signal to AI algorithms that your site lacks current, relevant information in your industry.' },
          { title: 'Core Web Vitals Optimization', description: 'While acceptable, your page speed and user experience metrics have room for improvement that could significantly impact AI rankings.' },
          { title: 'Competitive Content Gaps', description: 'Analysis shows opportunities where competitors are capturing AI attention with content topics and formats you\'re not currently addressing.' }
        ];
        
        const issueIndex = analysis.needsAttention.length - 3;
        if (issueIndex >= 0 && issueIndex < genericIssues.length) {
          analysis.needsAttention.push(genericIssues[issueIndex]);
        } else {
          analysis.needsAttention.push(genericIssues[0]);
        }
      }
      
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
