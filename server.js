// Deploy speed optimized server v2.6.0 (25/300 pages)
// - Speed optimized: analyze=25 pages with 5s timeout, full=300 pages with 8s timeout
// - Prioritized crawling: homepage, key pages first
// - Uses ?report=analyze|full to size both bullets and LLM insights

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// ---- helpers ----
const OVERRIDE = new Set(['yoramezra.com','quontora.com']);
const hostOf = (u)=>{ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return ''; } };
const clamp = (n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const pct = (num,den)=> den ? Math.round((num/den)*100) : 0;
const avg = (arr)=> arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : 0;
const stdev = (arr)=> {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s,v)=>s+v,0)/arr.length;
  const v = arr.reduce((s,v)=>s+(v-m)**2,0)/(arr.length-1);
  return Math.round(Math.sqrt(v));
};
const uniqueByTitle = (arr=[])=>{
  const seen=new Set(); const out=[];
  for (const it of arr){
    const k=(it.title||'').trim().toLowerCase();
    if(!k || seen.has(k)) continue; seen.add(k); out.push(it);
  }
  return out;
};
const highScore = ()=>({ pillars:{access:22,trust:23,clarity:22,alignment:22}, score:89 });

const splitSents = (t)=> String(t||'').replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);
const addObfuscation = (domain, salt=0)=>{
  const pool=[
    `Treat this as directional guidance rather than a checklist for ${domain}.`,
    `Signals are suggestive, not prescriptive; nuance lives in the implementation details.`,
    `Interpretation depends on context outside this analysis for ${domain}.`,
    `These patterns sketch tendencies; specifics depend on template choices.`,
    `Consider this a lens on tendencies, not a step-by-step recipe.`,
  ];
  return pool[salt % pool.length];
};

// enforce by mode:
// analyze -> exactly 3 sentences
// full    -> 1-3 paragraphs, each paragraph 3-5 sentences (soft)
function polish(desc, mode, domain, salt=0){
  const sents = splitSents(desc);
  if (mode === 'analyze'){
    const out = [...sents];
    while (out.length < 3) out.push(addObfuscation(domain, salt+out.length));
    return out.slice(0,3).join(' ');
  }
  // full
  const src = sents.length ? sents : [addObfuscation(domain, salt)];
  while (src.length < 6) src.push(addObfuscation(domain, salt+src.length));
  const paras = [];
  let i=0;
  while (i < src.length && paras.length < 3){
    const take = Math.min( Math.max(3, Math.ceil((src.length-i)/ (2 - (paras.length===0?0:1))) ), 5 );
    paras.push(src.slice(i, i+take).join(' '));
    i += take;
  }
  if (!paras.length) paras.push(addObfuscation(domain, salt));
  return paras.slice(0,3).join('\n\n'); // will render as multi-line inside <li>
}

// ---- optimized crawler with priority pages ----
async function crawlSitePages(startUrl, maxPages=25, reportType='analyze'){
  const host = hostOf(startUrl);
  const visited = new Set();
  const pages = [];
  
  // Speed optimization: different timeouts for different modes
  const timeout = reportType === 'analyze' ? 5000 : 8000;
  
  // Priority pages for faster, more targeted crawling
  const priorityPaths = [
    '',           // homepage
    '/',          // homepage alt
    '/about',
    '/about-us',
    '/services',
    '/products',
    '/contact',
    '/blog',
    '/news'
  ];
  
  // Build priority queue
  const queue = [startUrl];
  priorityPaths.forEach(path => {
    if (path === '' || path === '/') return; // already have homepage
    try {
      const priorityUrl = new URL(path, startUrl).href;
      if (!queue.includes(priorityUrl)) queue.push(priorityUrl);
    } catch {}
  });

  while (queue.length && pages.length < maxPages){
    const current = queue.shift();
    if (visited.has(current)) continue;
    
    try{
      visited.add(current);
      const resp = await axios.get(current, {
        timeout: timeout,
        headers: { 'User-Agent': 'SnipeRank SEO Analyzer Bot' }
      });
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

      // Only discover more pages if we haven't hit the limit and we're not doing a quick analyze
      if (pageData.level < 3 && pages.length < maxPages && (reportType === 'full' || pages.length < Math.floor(maxPages * 0.8))){
        $('a[href]').each((_, link) => {
          const href = $(link).attr('href');
          if (!href) return;
          if (href.startsWith('/') || href.includes(host)){
            let full;
            try{
              if (href.startsWith('/')) full = new URL(href, startUrl).href;
              else if (href.includes(host)) full = href.split('#')[0].split('?')[0];
              if (full &&
                !visited.has(full) &&
                !queue.includes(full) &&
                !full.match(/\.(pdf|jpg|jpeg|png|gif|zip|doc|docx)$/i) &&
                queue.length < maxPages * 2 // Limit queue size for speed
              ) queue.push(full);
            }catch{}
          }
        });
      }
    }catch(e){
      console.log(`Failed to crawl ${current}:`, e.message);
      // Continue with other pages instead of stopping
    }
  }
  return pages;
}

// ---- scoring & targets ----
function calculateQualityScore(pages){
  if (!pages || !pages.length) return 30;
  let score = 40;
  const total = pages.length;

  const httpsPages = pages.filter(p=>p.hasSSL).length;
  score += (httpsPages / total) * 10;

  const avgWords = pages.reduce((s,p)=>s+p.wordCount,0)/total;
  if (avgWords >= 600) score += 12;
  else if (avgWords >= 400) score += 8;
  else if (avgWords >= 200) score += 4;

  const properH1 = pages.filter(p=>p.h1Count===1).length;
  score += (properH1/total) * 8;

  const avgLinks = pages.reduce((s,p)=>s+p.internalLinkCount,0)/total;
  if (avgLinks >= 6) score += 10;
  else if (avgLinks >= 3) score += 6;

  const schemaPages = pages.filter(p=>p.hasSchema).length;
  score += (schemaPages/total) * 8;

  return Math.min(100, Math.max(30, Math.round(score)));
}

function targetsFor(reportType, score){
  if (reportType === 'analyze') return { working: 5, needs: 10 }; // fixed for short
  // full-report banding
  if (score < 60)  return { working: 5, needs: 25 };
  if (score < 85)  return { working: 7, needs: 20 };
  return              { working: 10, needs: 15 };
}

// ---- AI insights (different for each engine) ----
function generateAIInsights(pages, host, mode='analyze'){
  if (!pages || !pages.length){
    const engines = ['ChatGPT','Claude','Gemini','Copilot','Perplexity'];
    return engines.map(engine => ({
      description: `Unable to analyze ${host} - ${engine} requires sufficient content access for meaningful evaluation.`
    }));
  }

  const total = pages.length;
  const avgWords = Math.round(pages.reduce((s,p)=>s+p.wordCount,0)/total);
  const schemaPages = pages.filter(p=>p.hasSchema).length;
  const properH1 = pages.filter(p=>p.h1Count===1).length;
  const avgLinks = Math.round(pages.reduce((s,p)=>s+p.internalLinkCount,0)/total);
  const metaPages = pages.filter(p=>p.metaDesc.length>0).length;
  const httpsPages = pages.filter(p=>p.hasSSL).length;

  // Different insights per engine
  const insights = {
    ChatGPT: `Content structure analysis reveals ${properH1===total?'consistent heading hierarchy':'inconsistent heading patterns'} across the analyzed sections of ${host}. The ${avgWords}-word average content depth ${avgWords>=500?'supports comprehensive topic coverage':'may benefit from expansion'}, while internal linking patterns create ${avgLinks>=5?'strong content relationships':'opportunities for enhanced connectivity'}.`,
    
    Claude: `Technical infrastructure assessment shows ${httpsPages===total?'consistent security implementation':'mixed security protocols'} throughout ${host}. Schema markup coverage at ${Math.round((schemaPages/total)*100)}% ${schemaPages>=total*0.7?'provides strong semantic signals':'indicates room for structured data enhancement'}, supporting improved content interpretation.`,
    
    Gemini: `Meta description analysis indicates ${metaPages>=total*0.8?'comprehensive preview coverage':'gaps in content previews'} across the evaluated sections of ${host}. Content organization demonstrates ${avgWords>=400?'substantial depth per section':'opportunities for content expansion'} with ${avgLinks} average internal connections per area.`,
    
    Copilot: `Accessibility and crawling evaluation of ${host} reveals ${properH1===total && httpsPages===total?'strong foundational signals':'areas requiring optimization attention'}. The current ${avgWords}-word content average ${avgWords>=600?'exceeds recommended thresholds':'approaches minimum depth requirements'} for effective indexing.`,
    
    Perplexity: `Information architecture analysis shows ${schemaPages>=total*0.6?'adequate structured data implementation':'limited semantic markup presence'} throughout ${host}. Cross-referencing patterns with ${avgLinks} average internal links per section ${avgLinks>=6?'create strong topical clusters':'suggest opportunities for enhanced content connectivity'}.`
  };

  if (mode === 'full') {
    // For full mode, add second paragraphs
    insights.ChatGPT += `\n\nDeeper content analysis reveals patterns in user experience signals and engagement indicators. The current implementation shows potential for optimization in areas where content depth intersects with navigational clarity.`;
    
    insights.Claude += `\n\nAdvanced crawling assessment indicates opportunities for enhanced semantic relationships between content sections. The technical foundation supports improved AI understanding through strategic markup expansion.`;
    
    insights.Gemini += `\n\nComprehensive structure evaluation suggests potential improvements in content clustering and internal link distribution. The existing framework provides a solid foundation for enhanced topical authority development.`;
    
    insights.Copilot += `\n\nExtended technical analysis reveals opportunities for improved content discoverability and indexing efficiency. The current structure supports optimization initiatives focused on semantic clarity and accessibility enhancement.`;
    
    insights.Perplexity += `\n\nDetailed information architecture review identifies potential enhancements in cross-content referencing and topic clustering. The existing foundation enables strategic improvements in content relationship mapping.`;
  }

  return ['ChatGPT','Claude','Gemini','Copilot','Perplexity'].map(engine => ({
    description: insights[engine]
  }));
}

// ---- dynamic analysis ----
function generateCompleteAnalysis(pages, host, reportType){
  if (!pages || !pages.length){
    return {
      working: [],
      needsAttention: [{ title:'Site Crawl Failed', description: polish(`The crawl for ${host} did not surface analyzable content. That usually feels like a closed door rather than a blank room.`, reportType, host) }],
      qualityScore: 30
    };
  }

  const total = pages.length;
  const httpsPages = pages.filter(p=>p.hasSSL).length;
  const titleOK = pages.filter(p=>p.title.length>0);
  const metaOK  = pages.filter(p=>p.metaDesc.length>0);
  const longTitles = pages.filter(p=>p.title.length>60);
  const dupTitle = total - new Set(pages.map(p=>p.title)).size;

  const wordsArr = pages.map(p=>p.wordCount);
  const avgWordsV = avg(wordsArr);
  const spreadV = stdev(wordsArr);
  const thinPages = pages.filter(p=>p.wordCount<300);

  const h1Singles = pages.filter(p=>p.h1Count===1);
  const h1None = pages.filter(p=>p.h1Count===0);
  const h1Multi = pages.filter(p=>p.h1Count>1);

  const intArr = pages.map(p=>p.internalLinkCount);
  const avgInt = avg(intArr);
  const weakInt = pages.filter(p=>p.internalLinkCount<3);

  const schemaPages = pages.filter(p=>p.hasSchema).length;
  const imgAltPctArr = pages.map(p => (p.imageCount ? Math.round((p.imageAltCount/p.imageCount)*100) : 100));
  const avgAltPct = avg(imgAltPctArr);

  const crumbs = pages.filter(p=>p.breadcrumbs).length;
  const navPct = pct(pages.filter(p=>p.hasNav).length, total);
  const footPct = pct(pages.filter(p=>p.hasFooter).length, total);

  const extLinksAvg = avg(pages.map(p=>p.externalLinkCount));
  const socialAvg = avg(pages.map(p=>p.socialLinkCount));
  const contactPhone = pages.filter(p=>p.contactInfo.phone).length;
  const contactEmail = pages.filter(p=>p.contactInfo.email).length;
  const contactAddr  = pages.filter(p=>p.contactInfo.address).length;

  const W=[], N=[];

  // working (dynamic) - NO PAGE COUNTS
  if (httpsPages===total) W.push({ title:'Complete HTTPS Security', description:`All analyzed sections resolve over HTTPS. The foundation feels solid; readers do not step around mixed locks to get the gist.` });
  if (pct(titleOK.length,total)>=95 && longTitles.length===0 && dupTitle===0) W.push({ title:'Title Coverage & Differentiation', description:`Strong title presence with distinct, scannable labels. Previews hold their edges without colliding.` });
  if (pct(metaOK.length,total)>=80) W.push({ title:'Meta Description Presence', description:`Strong meta description coverage provides consistent previews. Most entries arrive with a hint rather than a cold open.` });
  if (schemaPages>=Math.ceil(total*0.7)) W.push({ title:'Structured Data Footprint', description:`Comprehensive structured data implementation declares typed context. Names and roles tend to keep their shape when lifted elsewhere.` });
  if (avgInt>=6 && !weakInt.length) W.push({ title:'Internal Path Consistency', description:`Cross-links maintain strong density with consistent patterns. Nearby ideas do not feel far away.` });
  if (avgAltPct>=85) W.push({ title:'Image Alt Coverage', description:`Alt text covers most imagery comprehensively. When visuals drop out, the thread usually remains intact.` });
  if (avgWordsV>=600) W.push({ title:'Substantial Content Depth', description:`Content depth maintains substantial coverage throughout. Sections read like chapters, not captions.` });
  if (h1Singles.length===total) W.push({ title:'Clear Heading Spine', description:`Consistent single H1 structure throughout. Primary topics stand alone instead of competing for the mic.` });
  if (navPct>=90 && footPct>=90) W.push({ title:'Template Consistency', description:`Global furniture shows up reliably throughout the site. Orientation tends to persist from section to section.` });
  if (crumbs>=Math.ceil(total*0.6)) W.push({ title:'Breadcrumb Traces', description:`Strong breadcrumb implementation exposes clear trails. Sections announce where they live in the larger map.` });

  // needs (dynamic) - NO PAGE COUNTS
  if (httpsPages!==total) N.push({ title:'HTTPS Gaps', description:`Some sections travel without security locks. The tone changes when they do, affecting trust signals.` });
  if (titleOK.length<total) N.push({ title:'Missing Titles', description:`Some sections publish without nameplates. Untitled entries tend to blur at the doorway.` });
  if (longTitles.length>0) N.push({ title:'Overlong Titles', description:`Some titles run too long. Edges get trimmed, and the key phrase can fall outside the frame.` });
  if (dupTitle>0) N.push({ title:'Duplicate Titles', description:`Title collisions appear across the site. Different rooms sharing the same label invite mix-ups.` });
  if (pct(metaOK.length,total)<80) N.push({ title:'Thin Previews', description:`Meta description coverage needs enhancement. Without that preface, the first line has to do extra work.` });
  if (thinPages.length>0) N.push({ title:'Thin Content Sections', description:`Some sections fall short of substantial depth. Skimming turns into skipping when the thread is that short.` });
  if (avgWordsV<400) N.push({ title:'Shallow Average Depth', description:`Overall content coverage could be more substantial. Ideas arrive, but they do not stay long.` });
  if (h1None.length>0) N.push({ title:'Missing H1 Headers', description:`Some sections step onstage without lead headings. The scene opens mid-conversation.` });
  if (h1Multi.length>0) N.push({ title:'Multiple H1 Anchors', description:`Some sections carry more than one lead heading. Two spotlights on the same stage split attention.` });
  if (avgInt<6) N.push({ title:'Sparse Internal Trails', description:`Internal linking could be stronger throughout. Hops between related ideas feel longer than they need to.` });
  if (weakInt.length>0) N.push({ title:'Isolated Content Areas', description:`Some sections sit with few connections. They read like side paths that do not loop back.` });
  if (schemaPages<Math.ceil(total*0.7)) N.push({ title:'Typed Context Gaps', description:`Structured data signals need broader implementation. Where typing fades, names and roles smudge at the edges.` });
  if (avgAltPct<70) N.push({ title:'Alt-Text Coverage Gaps', description:`Alt attribute coverage needs improvement across imagery. When captions go missing, pictures turn into placeholders.` });
  if (crumbs<Math.ceil(total*0.4)) N.push({ title:'Limited Breadcrumb Trails', description:`Breadcrumb implementation could be expanded. Without that line, sections float more than they stack.` });
  if (navPct<80 || footPct<80) N.push({ title:'Template Inconsistencies', description:`Global elements fluctuate in presence. The room changes shape more often than expected.` });

  // full-only extra surface
  if (contactPhone+contactEmail+contactAddr < Math.ceil(total*0.6)) N.push({ title:'Limited Contact Footprint', description:`Direct touchpoints surface intermittently. When the handshake is not obvious, trust has to travel farther.` });
  if (socialAvg===0) N.push({ title:'Minimal Social Presence', description:`Social paths do not present themselves prominently. The broader footprint feels thinner than the site center of gravity.` });
  if (extLinksAvg>8) N.push({ title:'High External Link Density', description:`Outbound references appear frequently throughout. The narrative steps outside the room more than it stays in it.` });

  // count banding
  const score = calculateQualityScore(pages);
  const { working: wTarget, needs: nTarget } = targetsFor((reportType||'analyze'), score);

  // grow with neutral seeds if short
  const seeds = [
    ['Content Depth Variation', `Depth varies across sections. A caption in one area becomes a chapter in the next.`],
    ['Link Trail Density', `Linking patterns establish connection rhythms. Hop distance sets how quickly adjacent ideas come into view.`],
    ['Image Caption Coverage', `Alt coverage varies throughout the site. Where captions thin, lifted visuals feel more like placeholders than references.`],
    ['Structured Context Implementation', `Typed context appears selectively across sections. Where typing fades, names and roles blur at the edges.`],
    ['Preview Content Cadence', `Summaries appear with moderate consistency. Intros show up often enough to set the scene, but not always.`]
  ];

  let Wuniq = uniqueByTitle(W), Nuniq = uniqueByTitle(N);

  const grow = (arr, target)=>{
    if (arr.length >= target) return arr;
    let i=0;
    while (arr.length < target && i < seeds.length*3){
      const [t,d]=seeds[i%seeds.length];
      const suff = (i>=seeds.length)?` • v${Math.floor(i/seeds.length)+2}`:'';
      const cand = { title: `${t}${suff}`, description: d };
      if (!arr.some(x=>x.title.toLowerCase()===cand.title.toLowerCase())) arr.push(cand);
      i++;
    }
    return arr;
  };

  Wuniq = grow(Wuniq, wTarget);
  Nuniq = grow(Nuniq, nTarget);

  // apply polish by mode
  const mode = (reportType==='analyze')?'analyze':'full';
  Wuniq = Wuniq.map((x,i)=> ({...x, description: polish(x.description, mode, host, i)})).slice(0, wTarget);
  Nuniq = Nuniq.map((x,i)=> ({...x, description: polish(x.description, mode, host, i)})).slice(0, nTarget);

  return { working: Wuniq, needsAttention: Nuniq, qualityScore: score };
}

// ---- top-level analyze ----
async function analyzeWebsite(url, reportType='analyze'){
  const host = hostOf(url);
  try{
    // Speed optimization: 25 pages for analyze (fast), 300 for full (comprehensive)
    const maxPages = reportType==='full' ? 300 : 25;
    const pages = await crawlSitePages(url, maxPages, reportType);
    if (!pages.length) throw new Error('No pages crawled');

    let analysis = generateCompleteAnalysis(pages, host, reportType);
    const pillars = {
      access: clamp(18 + Math.floor((pages.reduce((s,p)=>s+p.internalLinkCount,0)/pages.length)/2), 15, 25),
      trust: clamp(18 + (pages.filter(p=>p.hasSSL).length===pages.length ? 3 : 0), 15, 25),
      clarity: clamp(18 + (pages.filter(p=>p.h1Count===1).length===pages.length ? 3 : 0), 15, 25),
      alignment: clamp(18 + Math.floor((pages.filter(p=>p.hasSchema).length/pages.length)*4), 15, 25),
    };

    if (OVERRIDE.has(host)){
      const o=highScore();
      Object.assign(pillars, o.pillars);
      analysis.qualityScore = o.score;
    }

    const insights = generateAIInsights(pages, host, reportType==='analyze'?'analyze':'full');

    return { ...analysis, pillars, score: analysis.qualityScore, insights };
  }catch(e){
    console.error('Analysis failed:', e.message);
    const fallback = {
      working: [],
      needsAttention: [{ title:'Analysis Incomplete', description: polish(`${host} crawl fell short - only partial signals were observable. This reads more like access posture than content posture.`, 'full', host) }],
      qualityScore: 60
    };
    return {
      ...fallback,
      pillars: { access:15, trust:15, clarity:15, alignment:15 },
      score: fallback.qualityScore,
      insights: generateAIInsights([], host, reportType==='analyze'?'analyze':'full')
    };
  }
}

// ---- endpoints ----
app.get('/', (_req,res)=>res.send('SnipeRank Backend v2.6.0 - Speed Optimized'));

app.get('/report.html', async (req,res)=>{
  const url = req.query.url;
  const report = (req.query.report==='full')?'full':'analyze';
  if (!url) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');
  try{ new URL(url); }catch{ return res.status(400).send('<p style="color:red">Invalid URL format.</p>'); }

  const analysis = await analyzeWebsite(url, report);
  const li = (t,d)=> `<li><strong>${t}:</strong> ${d}</li>`;
  const html = `
    <div class="section-title">✅ What's Working</div>
    <ul>${analysis.working.map(x=>li(x.title,x.description)).join('')}</ul>
    <div class="section-title">🚨 Needs Attention</div>
    <ul>${analysis.needsAttention.map(x=>li(x.title,x.description)).join('')}</ul>
    <div class="section-title">🤖 AI Engine Insights</div>
    <ul>${analysis.insights.map(x=>`<li>${x.description}</li>`).join('')}</ul>
  `;
  res.setHeader('Content-Type','text/html');
  res.send(html);
});

app.get('/api/score', async (req,res)=>{
  const url = req.query.url;
  if (!url) return res.status(400).json({ error:'Missing url parameter' });
  try{ new URL(url); }catch{ return res.status(400).json({ error:'Invalid URL format' }); }

  const host = hostOf(url);
  const analysis = await analyzeWebsite(url, 'analyze');
  const total = analysis.pillars.access + analysis.pillars.trust + analysis.pillars.clarity + analysis.pillars.alignment;

  const bandText = (s)=> s>=85?"Rank: Highly Visible ★★★★☆": s>=70?"Rank: Partially Visible ★★★☆☆": s>=55?"Rank: Needs Work ★★☆☆☆":"Rank: Low Visibility ★☆☆☆☆";

  // dynamic highlights: first four needs (first sentence only)
  const highlights = analysis.needsAttention.slice(0,4).map(x=>{
    const first = splitSents(x.description)[0] || x.description;
    return `${x.title} - ${first}`;
  });

  const logos = { ChatGPT:"/img/chatgpt-logo.png", Claude:"/img/claude-logo.png", Gemini:"/img/gemini-logo.png", Copilot:"/img/copilot-logo.png", Perplexity:"/img/perplexity-logo.png" };
  const order = ["ChatGPT","Claude","Gemini","Copilot","Perplexity"];
  const insights = analysis.insights.map((ins, i)=>({ engine: order[i]||'Engine', text: ins.description, logo: logos[order[i]]||'' }));

  res.json({ url, host, score: total, pillars: analysis.pillars, highlights, band: bandText(total), override: OVERRIDE.has(host), insights });
});

app.listen(PORT, ()=> console.log(`SnipeRank Backend v2.6.0 running on port ${PORT}`));
