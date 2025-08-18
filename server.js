// server.js — v2.2.1 Fixed spaces and count issues

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

app.get('/', (_req, res) => res.send('SnipeRank Backend v2.2.1 — Fixed spaces and counts'));

// ===== Helpers (kept) =====
const OVERRIDE = new Set(['yoramezra.com', 'quontora.com']);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const highScore = () => ({ pillars: { access: 22, trust: 23, clarity: 22, alignment: 22 }, score: 89 });

const uniqueByTitle = (arr = []) => {
  const seen = new Set(), out = [];
  for (const it of arr) {
    const k = (it.title || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);
const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0);
const stdev = (arr) => {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  const v = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.round(Math.sqrt(v));
};

// FIXED: Keep spaces, just ensure minimum sentence count
function ensureSentenceCount(descParts, minSentences) {
  const out = [...descParts.map(s => s.trim())]; // KEEP SPACES!
  
  while (out.length < minSentences) {
    const last = out[out.length - 1] || 'Signals vary across the sample.';
    // Light paraphrase to avoid repetition
    const paraphrased = last
      .replace(/\bshows\b/gi, 'indicates')
      .replace(/\bappears\b/gi, 'presents')
      .replace(/\bvaries?\b/gi, 'fluctuates')
      .replace(/\bmay\b/gi, 'can')
      .replace(/\bcould\b/gi, 'can');
    
    if (paraphrased !== last && !out.includes(paraphrased)) {
      out.push(paraphrased);
    } else {
      out.push('Distribution varies across the crawled pages.');
      break;
    }
  }
  
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
              if (href.startsWith('/')) {
                fullUrl = new URL(href, startUrl).href;
              } else if (href.includes(host)) {
                fullUrl = href.split('#')[0].split('?')[0];
              }
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

// ===== SCORE (kept) =====
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

// ===== AI Insights (kept) =====
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
    { description: `ChatGPT review across ${totalPages} pages on ${host} notes ${properH1Pages === totalPages ? 'steady single-spine headings' : `${properH1Pages}/${totalPages} pages with single-spine headings`}, with ${avgWords >= 500 ? 'ample surround for context' : 'lean pockets that compress nuance'}. ${schemaPages >= totalPages * 0.8 ? 'Rich structured data supports topic identification.' : 'Limited schema markup affects content categorization.'} ${metaPages >= totalPages * 0.8 ? 'Strong meta descriptions provide clear previews.' : 'Sparse meta descriptions reduce summary quality.'}` },
    { description: `Claude view of ${host} observes ${schemaPages >= totalPages * 0.7 ? 'typed context present at scale' : 'typed context thin in places'}, and ${httpsPages === totalPages ? 'uniform security' : 'mixed security'}, shaping how quotes surface. ${avgWords >= 600 ? 'Substantial content depth supports detailed analysis.' : 'Limited content depth constrains response complexity.'} ${avgLinks >= 6 ? 'Strong internal linking creates content connectivity.' : 'Weak internal linking fragments topic relationships.'}` },
    { description: `Gemini perspective on ${host} sees ${schemaPages >= totalPages * 0.8 ? 'comprehensive schema' : 'schema gaps'}, and ${avgLinks >= 5 ? 'cohesive trails' : 'fragile trails'} when stitching related ideas. ${properH1Pages >= totalPages * 0.8 ? 'Clear heading structure aids topic mapping.' : 'Inconsistent headings complicate content organization.'} ${httpsPages === totalPages ? 'Complete HTTPS coverage builds trust signals.' : 'Mixed security protocols weaken authority indicators.'}` },
    { description: `Copilot pass finds ${properH1Pages >= totalPages * 0.8 ? 'clear landing spots' : 'competing anchors'} and ${httpsPages === totalPages ? 'stable trust hints' : 'uneven trust hints'} across ${totalPages} pages on ${host}. ${avgWords >= 500 ? 'Rich content provides comprehensive context for task completion.' : 'Thin content limits instructional depth and examples.'} ${metaPages >= totalPages * 0.7 ? 'Good meta coverage supports result framing.' : 'Missing meta descriptions reduce preview quality.'}` },
    { description: `Perplexity read notes ${metaPages >= totalPages * 0.8 ? 'previews that frame intent' : 'previews that drift'} and ${avgWords >= 600 ? 'rich coverage' : 'sparser coverage'} affecting citation likeliness. ${schemaPages >= totalPages * 0.6 ? 'Adequate structured data helps source verification.' : 'Limited schema reduces citation confidence.'} ${avgLinks >= 4 ? 'Internal connectivity supports fact-checking trails.' : 'Sparse linking hampers source verification processes.'}` }
  ];
}

// ===== DYNAMIC-ONLY ANALYSIS =====
function generateCompleteAnalysis(pagesData, host, reportType) {
  if (!pagesData || pagesData.length === 0) {
    return {
      working: [],
      needsAttention: [{ title: 'Site Crawl Failed', description: `The crawl for ${host} did not return analyzable pages. This could indicate server issues, access restrictions, or connectivity problems.` }],
      qualityScore: 30
    };
  }

  const total = pagesData.length;
  const isAnalyze = reportType === 'analyze';
  
  // FIXED: Use correct targets
  const workingTarget = isAnalyze ? 5 : 10;
  const needsTarget = isAnalyze ? 10 : 20;

  // Aggregate metrics
  const httpsPages = pagesData.filter(p => p.hasSSL).length;
  const titleOK = pagesData.filter(p => p.title.length > 0);
  const metaOK = pagesData.filter(p => p.metaDesc.length > 0);
  const longTitles = pagesData.filter(p => p.title.length > 60);
  const dupTitleCount = total - new Set(pagesData.map(p => p.title)).size;

  const wordsArr = pagesData.map(p => p.wordCount);
  const avgWords = avg(wordsArr);
  const thin = pagesData.filter(p => p.wordCount < 300);

  const h1Single = pagesData.filter(p => p.h1Count === 1);
  const h1None = pagesData.filter(p => p.h1Count === 0);
  const h1Multi = pagesData.filter(p => p.h1Count > 1);

  const intLinksArr = pagesData.map(p => p.internalLinkCount);
  const avgInt = avg(intLinksArr);
  const weakInt = pagesData.filter(p => p.internalLinkCount < 3);

  const schemaPages = pagesData.filter(p => p.hasSchema).length;

  const imgAltRatios = pagesData.map(p => (p.imageCount ? Math.round((p.imageAltCount / p.imageCount) * 100) : 100));
  const avgAltPct = avg(imgAltRatios);

  const crumbs = pagesData.filter(p => p.breadcrumbs).length;
  const navPct = pct(pagesData.filter(p => p.hasNav).length, total);
  const footPct = pct(pagesData.filter(p => p.hasFooter).length, total);

  // Build candidates (dynamic, site-specific)
  const W = [];
  const N = [];

  // Working candidates
  if (httpsPages === total) {
    W.push({
      title: 'Complete HTTPS Security',
      description: `All ${total} sampled pages on ${host} resolved over HTTPS. Security consistency helps previews carry trust without calling attention to transport gaps.`
    });
  }
  if (pct(titleOK.length, total) >= 95 && longTitles.length === 0 && dupTitleCount === 0) {
    W.push({
      title: 'Title Coverage & Differentiation',
      description: `${pct(titleOK.length, total)}% of pages present distinct, scannable titles on ${host}. Uniform titling avoids collisions and keeps previews legible across contexts.`
    });
  }
  if (pct(metaOK.length, total) >= 80) {
    W.push({
      title: 'Meta Description Presence',
      description: `${pct(metaOK.length, total)}% of pages expose descriptive previews on ${host}. This steadies how summaries situate the page before deeper reading.`
    });
  }
  if (schemaPages >= Math.ceil(total * 0.7)) {
    W.push({
      title: 'Structured Data Footprint',
      description: `${pct(schemaPages, total)}% of pages declare typed context on ${host}. Typed signals often help third-party readers keep names and roles straight.`
    });
  }
  if (avgInt >= 6 && weakInt.length === 0) {
    W.push({
      title: 'Internal Path Consistency',
      description: `Pages on ${host} average ~${avgInt} internal links with few thinly connected outliers. Continuity between related sections tends to hold even when readers enter mid-stream.`
    });
  }
  if (avgAltPct >= 85) {
    W.push({
      title: 'Image Alt Coverage',
      description: `Alt attributes are present for most imagery on ${host} (avg ~${avgAltPct}%). Descriptive text helps multimodal readers track references when visuals are suppressed.`
    });
  }
  if (avgWords >= 600) {
    W.push({
      title: 'Substantial Content Depth',
      description: `Pages on ${host} average ${avgWords} words, providing substantial context for AI systems. Rich content supports detailed responses and reduces hallucination risk.`
    });
  }
  if (h1Single.length === total) {
    W.push({
      title: 'Clear Heading Structure',
      description: `All pages on ${host} use single H1 headings, creating clear topic hierarchies. This structure helps AI systems identify primary themes accurately.`
    });
  }
  if (navPct >= 90 && footPct >= 90) {
    W.push({
      title: 'Consistent Site Architecture',
      description: `Navigation and footer elements appear consistently across ${host} (${navPct}% nav, ${footPct}% footer). Predictable structure aids content understanding.`
    });
  }
  if (crumbs >= Math.ceil(total * 0.6)) {
    W.push({
      title: 'Breadcrumb Navigation',
      description: `${pct(crumbs, total)}% of pages show hierarchical traces on ${host}. This makes section boundaries easier to infer when content is quoted in isolation.`
    });
  }

  // Needs candidates
  if (httpsPages !== total) {
    N.push({
      title: 'HTTPS Gaps',
      description: `${httpsPages}/${total} pages used HTTPS on ${host}. Mixed security protocols can reduce trust signals and affect AI citation preferences.`
    });
  }
  if (titleOK.length < total) {
    N.push({
      title: 'Missing Title Tags',
      description: `${total - titleOK.length} pages published without titles on ${host}. Missing titles reduce topic clarity and search visibility for AI systems.`
    });
  }
  if (longTitles.length > 0) {
    N.push({
      title: 'Overlong Titles',
      description: `${longTitles.length} pages exceed optimal title length on ${host}. Lengthy titles may be truncated in AI responses and search results.`
    });
  }
  if (dupTitleCount > 0) {
    N.push({
      title: 'Duplicate Titles',
      description: `${dupTitleCount} title collisions were observed across ${host}. Duplicate titles confuse topic identification and dilute page authority.`
    });
  }
  if (pct(metaOK.length, total) < 80) {
    N.push({
      title: 'Thin Preview Coverage',
      description: `${pct(metaOK.length, total)}% of pages include meta descriptions on ${host}. Missing previews force AI systems to generate their own summaries.`
    });
  }
  if (thin.length > 0) {
    N.push({
      title: 'Thin Content Segments',
      description: `${thin.length}/${total} pages contain under 300 words on ${host}. Thin content provides insufficient context for comprehensive AI analysis.`
    });
  }
  if (avgWords < 400) {
    N.push({
      title: 'Shallow Average Coverage',
      description: `Average page depth is ${avgWords} words on ${host}. Brief content limits AI systems' ability to provide detailed, accurate responses.`
    });
  }
  if (h1None.length > 0) {
    N.push({
      title: 'Missing H1 Headings',
      description: `${h1None.length} pages lack primary headings on ${host}. Missing H1s make topic identification difficult for AI content analysis.`
    });
  }
  if (h1Multi.length > 0) {
    N.push({
      title: 'Multiple H1 Anchors',
      description: `${h1Multi.length} pages carry multiple H1 headings on ${host}. Multiple H1s create ambiguity about the primary page topic.`
    });
  }
  if (avgInt < 6) {
    N.push({
      title: 'Weak Internal Linking',
      description: `Internal links average ${avgInt} per page on ${host}. Sparse internal linking reduces content discoverability and topical authority.`
    });
  }
  if (weakInt.length > 0) {
    N.push({
      title: 'Isolated Pages',
      description: `${weakInt.length} pages have fewer than 3 internal links on ${host}. Isolated pages are harder for AI systems to contextualize within site themes.`
    });
  }
  if (schemaPages < Math.ceil(total * 0.7)) {
    N.push({
      title: 'Schema Coverage Gaps',
      description: `Structured data appears on ${pct(schemaPages, total)}% of pages for ${host}. Limited schema markup reduces AI understanding of content types and relationships.`
    });
  }
  if (avgAltPct < 70) {
    N.push({
      title: 'Image Alt-Text Coverage',
      description: `Alt attributes average ${avgAltPct}% across imagery on ${host}. Missing alt text limits accessibility and multimodal AI understanding.`
    });
  }
  if (crumbs < Math.ceil(total * 0.4)) {
    N.push({
      title: 'Breadcrumb Absence',
      description: `Only ${pct(crumbs, total)}% of pages show breadcrumb navigation on ${host}. Missing breadcrumbs make site hierarchy unclear to AI systems.`
    });
  }
  if (navPct < 80 || footPct < 80) {
    N.push({
      title: 'Template Inconsistency',
      description: `Global elements vary across pages on ${host} (nav ${navPct}%, footer ${footPct}%). Inconsistent structure complicates AI content parsing.`
    });
  }

  // Additional needs items for full reports
  if (!isAnalyze) {
    const contactPhone = pagesData.filter(p => p.contactInfo.phone).length;
    const contactEmail = pagesData.filter(p => p.contactInfo.email).length;
    const contactAddr = pagesData.filter(p => p.contactInfo.address).length;
    const socialAvg = avg(pagesData.map(p => p.socialLinkCount));
    const extLinksAvg = avg(pagesData.map(p => p.externalLinkCount));
    
    if (contactPhone + contactEmail + contactAddr < Math.ceil(total * 0.6)) {
      N.push({
        title: 'Limited Contact Information',
        description: `Contact details appear sparingly across ${host}. Clear contact information helps establish authority and trustworthiness for AI citations.`
      });
    }
    if (socialAvg === 0) {
      N.push({
        title: 'Missing Social Signals',
        description: `Social media links are absent from ${host}. Social signals can enhance credibility and provide additional verification pathways.`
      });
    }
    if (extLinksAvg > 8) {
      N.push({
        title: 'High External Link Density',
        description: `External links average ${extLinksAvg} per page on ${host}. Excessive external linking may signal lower content authority to AI systems.`
      });
    }
  }

  // Trim to targets and ensure quality
  let Wuniq = uniqueByTitle(W);
  let Nuniq = uniqueByTitle(N);

  // FORCE correct counts by adding more items if needed
  while (Wuniq.length < workingTarget) {
    if (pct(metaOK.length, total) >= 60) {
      Wuniq.push({
        title: 'Adequate Meta Coverage',
        description: `${pct(metaOK.length, total)}% of pages include meta descriptions on ${host}. This provides AI systems with summary context for better understanding.`
      });
    }
    if (Wuniq.length < workingTarget && avgWords >= 200) {
      Wuniq.push({
        title: 'Reasonable Content Length',
        description: `Pages on ${host} average ${avgWords} words, providing sufficient context for analysis. Content length supports AI comprehension and response quality.`
      });
    }
    if (Wuniq.length < workingTarget && total >= 3) {
      Wuniq.push({
        title: 'Multi-Page Analysis',
        description: `Analysis covered ${total} pages from ${host}, enabling comprehensive site assessment. Multiple pages provide better insight into site patterns.`
      });
    }
    if (Wuniq.length < workingTarget) {
      Wuniq.push({
        title: 'Basic Site Structure',
        description: `${host} demonstrates functional web architecture with accessible content. Basic structure supports AI crawler access and content indexing.`
      });
    }
    if (Wuniq.length < workingTarget) {
      Wuniq.push({
        title: 'Content Accessibility',
        description: `Pages on ${host} load successfully and provide readable content for analysis. Accessibility ensures AI systems can process site information effectively.`
      });
    }
    if (Wuniq.length >= workingTarget) break;
  }

  while (Nuniq.length < needsTarget) {
    if (avgWords < 500) {
      Nuniq.push({
        title: 'Content Depth Opportunity',
        description: `Pages average ${avgWords} words on ${host}. Expanding content depth would provide richer context for AI analysis and improve response quality.`
      });
    }
    if (Nuniq.length < needsTarget && pct(metaOK.length, total) < 100) {
      Nuniq.push({
        title: 'Meta Description Gaps',
        description: `${100 - pct(metaOK.length, total)}% of pages lack meta descriptions on ${host}. Adding descriptions would improve AI preview generation and search visibility.`
      });
    }
    if (Nuniq.length < needsTarget && avgInt < 10) {
      Nuniq.push({
        title: 'Internal Linking Enhancement',
        description: `Internal links average ${avgInt} per page on ${host}. Increasing internal connectivity would strengthen topical authority and content relationships.`
      });
    }
    if (Nuniq.length < needsTarget && pct(schemaPages, total) < 100) {
      Nuniq.push({
        title: 'Schema Markup Expansion',
        description: `${100 - pct(schemaPages, total)}% of pages lack structured data on ${host}. Adding schema markup would improve AI content understanding and categorization.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'FAQ Implementation',
        description: `${host} would benefit from FAQ sections addressing common user questions. FAQ content helps AI systems provide direct answers to specific queries.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Content Categorization',
        description: `Implementing clear content categories on ${host} would improve topical organization. Better categorization helps AI systems understand content relationships.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Image Optimization',
        description: `Image optimization opportunities exist across ${host}. Optimized images with descriptive alt text enhance accessibility and AI understanding.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Mobile Optimization',
        description: `Mobile experience optimization could enhance ${host}'s accessibility. Mobile-friendly design ensures consistent AI access across devices.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Loading Speed Enhancement',
        description: `Page loading speed optimization would improve ${host}'s performance. Faster loading supports better AI crawler efficiency and user experience.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Content Freshness',
        description: `Regular content updates would enhance ${host}'s relevance. Fresh content signals help AI systems prioritize current information.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'External Authority Building',
        description: `Building external authority through quality backlinks would strengthen ${host}'s credibility. Authority signals influence AI citation preferences.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'User Experience Enhancement',
        description: `User experience improvements across ${host} would support engagement metrics. Better UX contributes to positive AI assessment signals.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Technical SEO Audit',
        description: `A comprehensive technical SEO audit would identify optimization opportunities for ${host}. Technical improvements enhance AI crawler access and understanding.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Content Strategy Development',
        description: `Developing a comprehensive content strategy would strengthen ${host}'s topical authority. Strategic content creation improves AI system recognition and citations.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Analytics Implementation',
        description: `Enhanced analytics tracking would provide insights into ${host}'s performance. Data-driven optimization improves AI visibility strategies.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Social Media Integration',
        description: `Social media integration would expand ${host}'s digital presence. Social signals contribute to overall authority and discoverability.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Local SEO Optimization',
        description: `Local SEO optimization would improve ${host}'s geographic relevance. Location-based optimization helps AI systems provide geographically relevant responses.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Voice Search Optimization',
        description: `Voice search optimization would prepare ${host} for conversational AI queries. Voice-friendly content improves compatibility with AI assistants.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Content Personalization',
        description: `Content personalization features would enhance ${host}'s user engagement. Personalized content supports better AI understanding of user intent.`
      });
    }
    if (Nuniq.length < needsTarget) {
      Nuniq.push({
        title: 'Security Enhancement',
        description: `Additional security measures would strengthen ${host}'s trustworthiness. Enhanced security contributes to positive AI trust signals and user confidence.`
      });
    }
    if (Nuniq.length >= needsTarget) break;
  }

  return {
    working: Wuniq.slice(0, workingTarget),
    needsAttention: Nuniq.slice(0, needsTarget),
    qualityScore: calculateQualityScore(pagesData)
  };
}

// ===== MAIN ANALYZER (kept pillars/insights wiring) =====
async function analyzeWebsite(url, reportType = 'analyze') {
  const host = hostOf(url);
  try {
    const maxPages = reportType === 'full-report' ? 15 : 8;
    const pagesData = await crawlSitePages(url, maxPages);
    if (pagesData.length === 0) throw new Error('No pages crawled');

    const analysis = generateCompleteAnalysis(pagesData, host, reportType);

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
      needsAttention: [{ title: 'Analysis Incomplete', description: `${host} crawl fell short — only partial signals were observable. This may indicate server issues or access restrictions.` }],
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

// ===== API ENDPOINTS (unchanged output shape) =====
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

  const analysis = await analyzeWebsite(url, 'analyze');
  const total = analysis.pillars.access + analysis.pillars.trust + analysis.pillars.clarity + analysis.pillars.alignment;

  const bandText = (score) => {
    if (score >= 85) return "Rank: Highly Visible ★★★★☆";
    if (score >= 70) return "Rank: Partially Visible ★★★☆☆";
    if (score >= 55) return "Rank: Needs Work ★★☆☆☆";
    return "Rank: Low Visibility ★☆☆☆☆";
  };

  const highlights = [
    "Implement comprehensive schema markup across all page types for enhanced AI understanding.",
    "Develop FAQ sections targeting 'how-to' and comparison queries with concise answers.",
    "Strengthen content depth with detailed explanations and supporting data on key pages.",
    "Optimize internal linking strategy to guide crawlers to cornerstone content."
  ];

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

  const host = hostOf(url);
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

app.listen(PORT, () => console.log(`SnipeRank Backend v2.2.1 running on port ${PORT}`));
