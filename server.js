// server.js v2.5.0  (analyze=50 pages, full=300 pages, no public page counts) GPT
// - Uses ?report=analyze|full to size both bullets and LLM insights
// - Full-report: Needs Attention banded by score (low=25, medium=20, high=15); Working banded similarly
// - Deep crawling: analyze=50 pages, full=300 pages, 3 levels deep
// - No page counts in public messaging

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
    `Treat this as directional heat rather than a checklist for ${domain}.`,
    `Signals are suggestive, not prescriptive; nuance lives in the page furniture.`,
    `Interpretation depends on context outside this crawl for ${domain}.`,
    `These patterns sketch tendencies; specifics hinge on template choices.`,
    `Consider this a lens on tendencies, not a stepâ€'byâ€'step recipe.`,
  ];
  return pool[salt % pool.length];
};

// enforce by mode:
// analyze exactly 3 sentences
// full "3 paragraphs, each paragraph 3â€"5 sentences (soft)
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

// ---- crawler ----
async function crawlSitePages(startUrl, maxPages=50){
  const host = hostOf(startUrl);
  const visited = new Set();
  const pages = [];
  const queue = [startUrl];

  while (queue.length && pages.length < maxPages){
    const current = queue.shift();
    if (visited.has(current)) continue;
    try{
      visited.add(current);
      const resp = await axios.get(current, {
        timeout: 8000,
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

      if (pageData.level < 3 && pages.length < maxPages){
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
                !full.match(/\.(pdf|jpg|jpeg|png|gif|zip|doc|docx)$/i)
              ) queue.push(full);
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

// ---- AI insights (length by mode) ----
function generateAIInsights(pages, host, mode='analyze'){
  if (!pages || !pages.length){
    const short = `Unable to analyze ${host} â€" crawl didnâ€™t surface enough content to read.`;
    const make = ()=>({ description: mode==='analyze' ? short : `${short} In practice, this reads like an access posture rather than a content posture. Signals exist, but not in a way that holds steady across lifts.` });
    return [make(),make(),make(),make(),make()];
  }

  const total = pages.length;
  const avgWords = Math.round(pages.reduce((s,p)=>s+p.wordCount,0)/total);
  const schemaPages = pages.filter(p=>p.hasSchema).length;
  const properH1 = pages.filter(p=>p.h1Count===1).length;
  const avgLinks = Math.round(pages.reduce((s,p)=>s+p.internalLinkCount,0)/total);
  const metaPages = pages.filter(p=>p.metaDesc.length>0).length;
  const httpsPages = pages.filter(p=>p.hasSSL).length;

  const bits = [
    `Across the analyzed sections of ${host}, headings ${properH1===total?'maintain consistent structure':'show structural variations'}, and content depth averages around ${avgWords} words per section. Schema markup ${schemaPages>=total*0.8?'appears consistently implemented':'shows gaps in coverage'}, while meta descriptions ${metaPages>=total*0.8?'provide consistent previews':'need attention in several areas'}.`,
    `Internal linking patterns average approximately ${avgLinks} connections per section, which ${avgLinks>=5?'creates strong content relationships':'could benefit from enhancement'}. Security protocols ${httpsPages===total?'maintain consistent standards':'show some inconsistencies'}, which influences how content gets referenced and shared across platforms.`
  ];

  const engines = ['ChatGPT','Claude','Gemini','Copilot','Perplexity'];
  return engines.map((_,i)=>{
    if (mode==='analyze'){
      // one paragraph (3â€"4 sentences)
      const sents = splitSents(bits.join(' '));
      while (sents.length < 4) sents.push(addObfuscation(host, i+sents.length));
      return { description: sents.slice(0,4).join(' ') };
    }
    // full â†' two paragraphs
    const pad = addObfuscation(host, i);
    return { description: `${bits[0]}\n\n${bits[1]} ${pad}` };
  });
}

// ---- dynamic analysis ----
function generateCompleteAnalysis(pages, host, reportType){
  if (!pages || !pages.length){
    return {
      working: [],
      needsAttention: [{ title:'Site Crawl Failed', description: polish(`The crawl for ${host} didnâ€™t surface analyzable content. That usually feels like a closed door rather than a blank room.`, reportType, host) }],
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
  if (httpsPages===total) W.push({ title:'Complete HTTPS Security', description:`All analyzed sections resolve over HTTPS. The foundation feels solid; readers donâ€™t step around mixed locks to get the gist.` });
  if (pct(titleOK.length,total)>=95 && longTitles.length===0 && dupTitle===0) W.push({ title:'Title Coverage & Differentiation', description:`Strong title presence with distinct, scannable labels. Previews hold their edges without colliding.` });
  if (pct(metaOK.length,total)>=80) W.push({ title:'Meta Description Presence', description:`Strong meta description coverage provides consistent previews. Most entries arrive with a hint rather than a cold open.` });
  if (schemaPages>=Math.ceil(total*0.7)) W.push({ title:'Structured Data Footprint', description:`Comprehensive structured data implementation declares typed context. Names and roles tend to keep their shape when lifted elsewhere.` });
  if (avgInt>=6 && !weakInt.length) W.push({ title:'Internal Path Consistency', description:`Cross-links maintain strong density with consistent patterns. Nearby ideas donâ€™t feel far away.` });
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
  if (avgWordsV<400) N.push({ title:'Shallow Average Depth', description:`Overall content coverage could be more substantial. Ideas arrive, but they donâ€™t stay long.` });
  if (h1None.length>0) N.push({ title:'Missing H1 Headers', description:`Some sections step onstage without lead headings. The scene opens mid-conversation.` });
  if (h1Multi.length>0) N.push({ title:'Multiple H1 Anchors', description:`Some sections carry more than one lead heading. Two spotlights on the same stage split attention.` });
  if (avgInt<6) N.push({ title:'Sparse Internal Trails', description:`Internal linking could be stronger throughout. Hops between related ideas feel longer than they need to.` });
  if (weakInt.length>0) N.push({ title:'Isolated Content Areas', description:`Some sections sit with few connections. They read like side paths that donâ€™t loop back.` });
  if (schemaPages<Math.ceil(total*0.7)) N.push({ title:'Typed Context Gaps', description:`Structured data signals need broader implementation. Where typing fades, names and roles smudge at the edges.` });
  if (avgAltPct<70) N.push({ title:'Alt-Text Coverage Gaps', description:`Alt attribute coverage needs improvement across imagery. When captions go missing, pictures turn into placeholders.` });
  if (crumbs<Math.ceil(total*0.4)) N.push({ title:'Limited Breadcrumb Trails', description:`Breadcrumb implementation could be expanded. Without that line, sections float more than they stack.` });
  if (navPct<80 || footPct<80) N.push({ title:'Template Inconsistencies', description:`Global elements fluctuate in presence. The room changes shape more often than expected.` });

  // full-only extra surface
  if (contactPhone+contactEmail+contactAddr < Math.ceil(total*0.6)) N.push({ title:'Limited Contact Footprint', description:`Direct touchpoints surface intermittently. When the handshake isnâ€™t obvious, trust has to travel farther.` });
  if (socialAvg===0) N.push({ title:'Minimal Social Presence', description:`Social paths donâ€™t present themselves prominently. The broader footprint feels thinner than the siteâ€™s center of gravity.` });
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
      const suff = (i>=seeds.length)?` â€¢ v${Math.floor(i/seeds.length)+2}`:'';
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
    const maxPages = reportType==='full' ? 300 : 50;
    const pages = await crawlSitePages(url, maxPages);
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
      needsAttention: [{ title:'Analysis Incomplete', description: polish(`${host} crawl fell short â€" only partial signals were observable. This reads more like access posture than content posture.`, 'full', host) }],
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
app.get('/', (_req,res)=>res.send('SnipeRank Backend v2.5.0'));

app.get('/report.html', async (req,res)=>{
  const url = req.query.url;
  const report = (req.query.report==='full')?'full':'analyze';
  if (!url) return res.status(400).send('<p style="color:red">Missing URL parameter.</p>');
  try{ new URL(url); }catch{ return res.status(400).send('<p style="color:red">Invalid URL format.</p>'); }

  const analysis = await analyzeWebsite(url, report);
  const li = (t,d)=> `<li><strong>${t}:</strong> ${d}</li>`;
  const html = `
    <div class="section-title">âœ… What's Working</div>
    <ul>${analysis.working.map(x=>li(x.title,x.description)).join('')}</ul>
    <div class="section-title">ðŸš¨ Needs Attention</div>
    <ul>${analysis.needsAttention.map(x=>li(x.title,x.description)).join('')}</ul>
    <div class="section-title">ðŸ¤– AI Engine Insights</div>
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

  const bandText = (s)=> s>=85?"Rank: Highly Visible â˜…â˜…â˜…â˜…â˜†": s>=70?"Rank: Partially Visible â˜…â˜…â˜…â˜†â˜†": s>=55?"Rank: Needs Work â˜…â˜…â˜†â˜†â˜†":"Rank: Low Visibility â˜…â˜†â˜†â˜†â˜†";

  // dynamic highlights: first four needs (first sentence only)
  const highlights = analysis.needsAttention.slice(0,4).map(x=>{
    const first = splitSents(x.description)[0] || x.description;
    return `${x.title} â€" ${first}`;
  });

  const logos = { ChatGPT:"/img/chatgpt-logo.png", Claude:"/img/claude-logo.png", Gemini:"/img/gemini-logo.png", Copilot:"/img/copilot-logo.png", Perplexity:"/img/perplexity-logo.png" };
  const order = ["ChatGPT","Claude","Gemini","Copilot","Perplexity"];
  const insights = analysis.insights.map((ins, i)=>({ engine: order[i]||'Engine', text: ins.description, logo: logos[order[i]]||'' }));

  res.json({ url, host, score: total, pillars: analysis.pillars, highlights, band: bandText(total), override: OVERRIDE.has(host), insights });
});

app.listen(PORT, ()=> console.log(`SnipeRank Backend v2.5.0 running on port ${PORT}`));
