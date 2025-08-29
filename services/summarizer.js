// Summarizer service: embed posts/about, cluster them, and synthesize compact summaries
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
require('dotenv').config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const fs = require('fs');
const WRITE_DEBUG_OUTPUTS = process.env.WRITE_DEBUG_OUTPUTS === 'true';

// Minimal k-means implementation to avoid adding heavy deps
function kmeans(items, k, maxIter = 50) {
  if (items.length <= k) return items.map((_, i) => [i]);
  const dim = items[0].length;
  // init centroids: pick k distinct items
  const centroids = [];
  const used = new Set();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * items.length);
    if (!used.has(idx)) { used.add(idx); centroids.push(items[idx].slice()); }
  }

  let clusters = new Array(k).fill(0).map(() => []);
  for (let iter = 0; iter < maxIter; iter++) {
    clusters = new Array(k).fill(0).map(() => []);
    // assign
    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      let best = 0; let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclidean(v, centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      clusters[best].push(i);
    }
    // recompute
    let moved = false;
    for (let c = 0; c < k; c++) {
      if (clusters[c].length === 0) continue;
      const mean = new Array(dim).fill(0);
      for (const idx of clusters[c]) for (let j = 0; j < dim; j++) mean[j] += items[idx][j];
      for (let j = 0; j < dim; j++) mean[j] /= clusters[c].length;
      if (!arraysEqual(mean, centroids[c])) moved = true;
      centroids[c] = mean;
    }
    if (!moved) break;
  }
  return clusters;
}

function arraysEqual(a, b) { if (a.length !== b.length) return false; for (let i=0;i<a.length;i++) if (a[i] !== b[i]) return false; return true; }
function euclidean(a, b) { let s = 0; for (let i=0;i<a.length;i++) s += (a[i]-b[i])*(a[i]-b[i]); return Math.sqrt(s); }

async function getEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const body = { model: 'text-embedding-3-small', input: texts };
  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map(d => d.embedding || []);
}

async function summarizeWithModel(prompt, options = {}) {
  const body = {
    model: options.model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.max_tokens || 256,
    temperature: options.temperature ?? 0.2
  };
  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Chat HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Main exported function: accepts array of items {id, text, created_at, engagement, url}
// Returns { personalSummary, personalInterests, evidence }
async function synthesizePersonalProfile(items, opts = {}) {
  try {
    if (!Array.isArray(items) || items.length === 0) return { personalSummary: '', personalInterests: [], evidence: [], provenance: { count: 0 } };

    // Normalize and trim text; accept sourceType and default to 'post'
    const normalized = items.map(i => ({ id: i.id || '', sourceType: i.sourceType || i.type || 'post', text: (i.text || '').trim().slice(0, 1200), created_at: i.created_at || i.date || null, engagement: Number(i.engagement || 0), url: i.url || '' })).filter(i => i.text && i.text.length > 20);
    if (normalized.length === 0) return { personalSummary: '', personalInterests: [], evidence: [], provenance: { count: items.length } };

    // Per-type caps and weights
    const typeConfig = Object.assign({ post: { cap: 50, weight: 1.0 }, comment: { cap: 150, weight: 0.5 }, reply: { cap: 150, weight: 0.4 }, recommendation: { cap: 40, weight: 1.0 }, media: { cap: 60, weight: 0.9 }, event: { cap: 50, weight: 0.8 } }, opts.typeConfig || {});

    // Group by type and apply caps
    const grouped = {};
    for (const it of normalized) {
      const t = (it.sourceType || 'post').toLowerCase();
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(it);
    }
    let selected = [];
    for (const [t, arr] of Object.entries(grouped)) {
      arr.sort((a,b) => ((b.engagement||0) - (a.engagement||0)) || (new Date(b.created_at || 0) - new Date(a.created_at || 0)));
      const cap = (typeConfig[t] && typeConfig[t].cap) || 20;
      selected = selected.concat(arr.slice(0, cap));
    }

    // Global cap
    const globalCap = opts.limit || 250;
    selected = selected.slice(0, globalCap);

    // Deduplicate by simple text equality then by cosine similarity threshold
    const seen = new Set();
    const deduped = [];
    for (const s of selected) {
      const key = s.text.slice(0,200);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(s);
    }

    const texts = deduped.map(d => `[${d.sourceType}] ${d.text}`);
    const embeddings = await getEmbeddings(texts);

    // simple dedupe by cosine similarity > 0.92
    const keep = [];
    for (let i=0;i<embeddings.length;i++) {
      let dup = false;
      for (const j of keep) {
        const cos = cosineSimilarity(embeddings[i], embeddings[j]);
        if (cos > 0.92) { dup = true; break; }
      }
      if (!dup) keep.push(i);
    }
    const finalItems = keep.map(i => deduped[i]);
    const finalEmbeddings = keep.map(i => embeddings[i]);

    // Determine number of clusters
    const k = Math.min(8, Math.max(1, Math.floor(Math.sqrt(finalItems.length))));
    const clusters = kmeans(finalEmbeddings, k);

    // For each cluster, pick representative items preferring high-weight sourceTypes
    const clusterSummaries = [];
    for (const cl of clusters) {
      if (!cl || cl.length === 0) continue;
      // sort cluster indices by (engagement * typeWeight)
      const scored = cl.map(idx => ({ idx, score: (finalItems[idx].engagement || 0) * ((typeConfig[finalItems[idx].sourceType] && typeConfig[finalItems[idx].sourceType].weight) || 0.5) }));
      scored.sort((a,b) => b.score - a.score);
      const reps = scored.slice(0,2).map(s => ({ id: finalItems[s.idx].id, text: finalItems[s.idx].text, url: finalItems[s.idx].url, sourceType: finalItems[s.idx].sourceType }));
      const prompt = `Summarize the following user posts/comments into a single concise sentence that captures the author's personal interests, activities, or hobbies. Be succinct and conversational.\n\n` + reps.map(r => `- [${r.sourceType}] ${r.text.replace(/\n/g,' ')}\n`).join('');
      const summary = await summarizeWithModel(prompt, { max_tokens: 60, model: 'gpt-3.5-turbo' });
      clusterSummaries.push({ summary: summary.trim(), reps });
    }

    // Combine cluster summaries into a single text used for deterministic extraction and final synthesis
    const combined = clusterSummaries.map(c => c.summary).join('\n');

    // When debugging is enabled, write a compact cluster artifact for inspection.
    try {
      if (WRITE_DEBUG_OUTPUTS) {
        // helper: shrink vectors to limited dims and precision
        function shrinkVector(v, maxDims = 64, precision = 4) {
          if (!Array.isArray(v)) return [];
          return v.slice(0, maxDims).map(x => Number(Number(x).toFixed(precision)));
        }

        const clusterArtifacts = [];
        for (let ci = 0; ci < clusters.length; ci++) {
          const memIdx = Array.isArray(clusters[ci]) ? clusters[ci].slice(0, 10) : [];
          // compute centroid for this cluster from finalEmbeddings
          let centroid = [];
          if (memIdx.length > 0) {
            const dim = finalEmbeddings[0] ? finalEmbeddings[0].length : 0;
            centroid = new Array(dim).fill(0);
            for (const mi of memIdx) {
              const e = finalEmbeddings[mi] || [];
              for (let d = 0; d < dim; d++) centroid[d] += (e[d] || 0);
            }
            for (let d = 0; d < centroid.length; d++) centroid[d] = centroid[d] / memIdx.length;
          }

          const members = memIdx.map(mi => {
            const it = finalItems[mi] || {};
            return { id: it.id || '', sourceType: it.sourceType || '', excerpt: (it.text || '').slice(0, 200), url: it.url || '' };
          });

          clusterArtifacts.push({
            clusterIndex: ci,
            summary: clusterSummaries[ci] ? clusterSummaries[ci].summary : (clusterSummaries[ci] || {}).summary || '',
            centroid: shrinkVector(centroid, 64, 4),
            members
          });
        }

        const artifact = {
          timestamp: new Date().toISOString(),
          itemCount: items.length,
          selectedCount: finalItems.length,
          seedInterests: seedInterests || [],
          clusters: clusterArtifacts.slice(0, 12)
        };

        try {
          if (!fs.existsSync('./output')) fs.mkdirSync('./output', { recursive: true });
          fs.writeFileSync('./output/cluster_artifacts.json', JSON.stringify(artifact, null, 2));
        } catch (e) {
          // swallow write errors; debug output should not break pipeline
        }
      }
    } catch (e) {
      // ignore
    }

    // Before final synthesis: try to extract deterministic seed interests from cluster summaries
    let seedInterests = [];
    try {
      const seedPrompt = `From the following short cluster summaries (one per line), extract up to 6 concise human-friendly interest labels (no programming languages, no frameworks, only human activities or interests). Return strict JSON: {"seedInterests": ["...","..."]}.\n\n${combined}`;
      const seedText = await summarizeWithModel(seedPrompt, { max_tokens: 120, model: 'gpt-3.5-turbo', temperature: 0.0 });
      const seedMatch = seedText.match(/\{[\s\S]*\}/m);
      if (seedMatch) {
        try { const parsedSeed = JSON.parse(seedMatch[0]); seedInterests = parsedSeed.seedInterests || []; } catch (e) { seedInterests = []; }
      }
    } catch (e) {
      seedInterests = [];
    }
    // Fallback heuristic: simple token frequency from combined text
    if (!seedInterests || seedInterests.length === 0) {
      const stop = new Set(['the','and','a','an','in','on','with','for','of','to','by','from','my','we','i','is','are','this','that','be','as','at','about']);
      const tokens = combined.split(/[^A-Za-z\-]+/).map(t => t.trim()).filter(t => t && t.length>2).map(t => t.toLowerCase());
      const counts = {};
      for (const tk of tokens) if (!stop.has(tk)) counts[tk] = (counts[tk] || 0) + 1;
      const top = Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,6).map(s => s.split('-').map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' '));
      seedInterests = top;
    }

    // Synthesize final JSON from cluster summaries
    const finalPrompt = `You are given short cluster summaries of a user's posts/comments (one per line):\n${combined}\n\nReturn strict JSON: { "personalSummary": "...", "personalInterests": ["..."], "evidence": [{"id":"...","sourceType":"...","excerpt":"...","url":"..."}], "provenance": {"count": ${items.length}} } . personalSummary: 1-2 short sentences (<=200 chars). personalInterests: up to 6 human-friendly interests. evidence: up to 3 representative excerpts (<=200 chars each).`;
    const finalText = await summarizeWithModel(finalPrompt, { max_tokens: 220, model: 'gpt-3.5-turbo' });
    const rawFinalText = typeof finalText === 'string' ? finalText : '';

    // Helper: attempt to extract JSON substring and sanitize common JSON formatting issues
    function sanitizeJsonString(s) {
      if (!s || typeof s !== 'string') return null;
      // extract first {...} block
      const m = s.match(/\{[\s\S]*\}/m);
      let candidate = m ? m[0] : s;
      // common fixes
      // remove backticks
      candidate = candidate.replace(/`/g, '');
      // replace smart quotes with standard quotes
      candidate = candidate.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      // remove trailing commas in objects/arrays
      candidate = candidate.replace(/,\s*\]/g, ']');
      candidate = candidate.replace(/,\s*\}/g, '}');
      // remove unexpected control chars
      candidate = candidate.replace(/[\x00-\x1F\x7F]/g, '');
      // ensure property names are double-quoted (best-effort): replace 'key': or key: at line-start/after { or ,
      candidate = candidate.replace(/([\{,\s])(\s*)([A-Za-z0-9_\-]+)\s*\:/g, '$1"$3":');
      // convert single quotes around values to double quotes when safe (heuristic)
      candidate = candidate.replace(/:\s*'([^']*)'/g, ': "$1"');
      return candidate;
    }

    let parsed = null;
    let parseError = null;
    const match = rawFinalText.match(/\{[\s\S]*\}/m);
    if (match) {
      const rawJson = match[0];
      try {
        parsed = JSON.parse(rawJson);
      } catch (e1) {
        // try sanitizing
        try {
          const cleaned = sanitizeJsonString(rawFinalText);
          parsed = JSON.parse(cleaned);
        } catch (e2) {
          parseError = e2.message || e1.message || 'JSON parse failed';
          parsed = null;
        }
      }
    } else {
      // If no {} block, try sanitizing whole text
      try {
        const cleaned = sanitizeJsonString(rawFinalText);
        parsed = cleaned ? JSON.parse(cleaned) : null;
      } catch (e) {
        parseError = e.message || 'No JSON found';
        parsed = null;
      }
    }

    if (!parsed) {
      // deterministic fallback: build artifact from cluster summaries and seed interests
      const fallbackSummary = clusterSummaries.slice(0,3).map(c => c.summary).filter(Boolean).join(' ');
      const fallbackInterests = (seedInterests && seedInterests.length) ? seedInterests : (function(){
        // token-frequency fallback from combined
        const stop = new Set(['the','and','a','an','in','on','with','for','of','to','by','from','my','we','i','is','are','this','that','be','as','at','about']);
        const tokens = combined.split(/[^A-Za-z\-]+/).map(t => t.trim()).filter(t => t && t.length>2).map(t => t.toLowerCase());
        const counts = {};
        for (const tk of tokens) if (!stop.has(tk)) counts[tk] = (counts[tk] || 0) + 1;
        return Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,6).map(s => s.split('-').map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' '));
      })();
      const fallbackEvidence = finalItems.slice(0,3).map(s => ({ id: s.id, sourceType: s.sourceType, excerpt: (s.text || '').slice(0,200), url: s.url }));
      return { personalSummary: fallbackSummary || '', personalInterests: fallbackInterests || [], seedInterests: seedInterests || [], evidence: fallbackEvidence, provenance: { count: items.length, parsed: false }, rawFinalText, error: parseError || 'Failed to parse JSON from model' };
    }

    // If parsed successfully, normalize and return with seedInterests and provenance
    return { personalSummary: parsed.personalSummary || '', personalInterests: parsed.personalInterests || [], seedInterests: seedInterests || [], evidence: parsed.evidence || [], provenance: parsed.provenance || { count: items.length }, rawFinalText };
  } catch (err) {
    // graceful fallback
    return { personalSummary: '', personalInterests: [], evidence: [], provenance: { count: Array.isArray(items) ? items.length : 0 }, error: err.message };
  }
}

function dot(a,b) { let s=0; for (let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
function norm(a) { let s=0; for (let i=0;i<a.length;i++) s+=a[i]*a[i]; return Math.sqrt(s); }
function cosineSimilarity(a,b) { return dot(a,b) / (norm(a)*norm(b) + 1e-10); }

module.exports = { synthesizePersonalProfile };
