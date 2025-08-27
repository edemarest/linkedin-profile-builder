
// Entry point: orchestrates data collection and profile generation
const { callLinkedInApi } = require('./api/linkedinApi');
const { buildProfile } = require('./data/profileBuilder');
const { makeProfilePrompt } = require('./data/prompts');
const { getOpenAiCompletion } = require('./openai/openaiClient');
const { synthesizePersonalProfile } = require('./services/summarizer');
const fs = require('fs');

require('dotenv').config();

async function main(username) {
  // Fetch and aggregate data from all relevant endpoints with graceful error handling
  const rawData = {};
  const endpoints = [
    { key: 'experience', path: '/api/v1/user/experience' },
    { key: 'educations', path: '/api/v1/user/educations' },
    { key: 'contact', path: '/api/v1/user/contact' },
    { key: 'publications', path: '/api/v1/user/publications' },
    { key: 'volunteers', path: '/api/v1/user/volunteers' },
    { key: 'skills', path: '/api/v1/user/skills' },
    // personal-content endpoints (optional, may be empty)
  { key: 'posts', path: '/api/v1/user/posts' },
  { key: 'comments', path: '/api/v1/user/comments' },
  { key: 'replies', path: '/api/v1/user/replies' },
  { key: 'recommendations', path: '/api/v1/user/recommendations' },
  { key: 'images', path: '/api/v1/user/images' },
  { key: 'videos', path: '/api/v1/user/videos' },
  { key: 'reactions', path: '/api/v1/user/reactions' }
  ];
  for (const endpoint of endpoints) {
    try {
      const result = await callLinkedInApi(endpoint.path, { username: username });
      // contact endpoint returns an object, others return { data: [] }
      if (endpoint.key === 'contact') rawData[endpoint.key] = result?.data || result || {};
      else rawData[endpoint.key] = result?.data || [];
      console.log(`INFO: fetched ${endpoint.key} (${Array.isArray(rawData[endpoint.key]) ? rawData[endpoint.key].length : Object.keys(rawData[endpoint.key] || {}).length} items)`);
    } catch (err) {
      console.log(`WARN: Failed to fetch ${endpoint.key}:`, err.message);
      rawData[endpoint.key] = endpoint.key === 'contact' ? {} : [];
    }
  }

  // Build structured profile object
  const profile = buildProfile(rawData);

  // Summarize personal-content (about, posts) into a compact artifact
  let personalSummaryArtifact = { personalSummary: '', personalInterests: [], evidence: [], provenance: {} };
  try {
    const items = [];
    // Posts
    if (Array.isArray(rawData.posts)) {
      for (const p of rawData.posts) items.push({ id: p.id || p.post_id || '', sourceType: 'post', text: p.text || p.content || p.body || '', created_at: p.created_at || p.date, engagement: p.likes || p.reactions || p.engagement || 0, url: p.url || '' });
    }
    // Comments and replies
    if (Array.isArray(rawData.comments)) {
      for (const c of rawData.comments) items.push({ id: c.id || '', sourceType: 'comment', text: c.text || c.comment || c.body || '', created_at: c.created_at || c.date, engagement: c.likes || c.reactions || 0, url: c.url || '' });
    }
    if (Array.isArray(rawData.replies)) {
      for (const r of rawData.replies) items.push({ id: r.id || '', sourceType: 'reply', text: r.text || r.body || '', created_at: r.created_at || r.date, engagement: r.likes || r.reactions || 0, url: r.url || '' });
    }
    // Recommendations / testimonials
    if (Array.isArray(rawData.recommendations)) {
      for (const rec of rawData.recommendations) items.push({ id: rec.id || '', sourceType: 'recommendation', text: rec.text || rec.recommendation || rec.body || '', created_at: rec.created_at || rec.date, engagement: 0, url: rec.url || '' });
    }
    // Images (captions)
    if (Array.isArray(rawData.images)) {
      for (const m of rawData.images) items.push({ id: m.id || '', sourceType: 'media', text: m.caption || m.description || m.title || '', created_at: m.created_at || m.date, engagement: m.likes || 0, url: m.url || '' });
    }
    // Videos (captions)
    if (Array.isArray(rawData.videos)) {
      for (const m of rawData.videos) items.push({ id: m.id || '', sourceType: 'media', text: m.caption || m.description || m.title || '', created_at: m.created_at || m.date, engagement: m.likes || 0, url: m.url || '' });
    }
    // Reactions: include short text if available (e.g., reactions with comments)
    if (Array.isArray(rawData.reactions)) {
      for (const r of rawData.reactions) items.push({ id: r.id || '', sourceType: 'reaction', text: r.text || r.comment || '', created_at: r.created_at || r.date, engagement: r.count || 0, url: r.url || '' });
    }
    if (items.length > 0) {
      console.log(`INFO: synthesizing personal summary from ${items.length} items`);
      personalSummaryArtifact = await synthesizePersonalProfile(items, { limit: 200 });
      console.log('INFO: personal summary synthesized');
    } else {
      console.log('INFO: no personal posts/about to summarize');
    }
  } catch (err) {
    console.log('WARN: personal summarization failed:', err.message);
  }

  // Attach compact summary into profile for prompt construction
  profile.personalSummary = personalSummaryArtifact.personalSummary || '';
  profile.personalSummaryInterests = personalSummaryArtifact.personalInterests || [];
  profile.personalSeedInterests = personalSummaryArtifact.seedInterests || [];
  profile.personalEvidence = personalSummaryArtifact.evidence || [];

  // Prepare prompt
  const prompt = makeProfilePrompt(profile);
  console.log('INFO: prepared prompt (redacted)');

  // Helper: try to extract first JSON object from text
  function extractJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/\{[\s\S]*\}$/m) || text.match(/\{[\s\S]*?\}/m);
    if (!match) return null;
    const candidate = match[0];
    try {
      return JSON.parse(candidate);
    } catch (e) {
      return null;
    }
  }

  // Helper: validate minimal schema and normalize arrays
  function validateAndNormalize(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const out = {};
    out.Name = typeof obj.Name === 'string' ? obj.Name : '[Unknown]';
    out.Affiliation = typeof obj.Affiliation === 'string' ? obj.Affiliation : profile.affiliation || '[Unknown]';
    out.JobTitle = typeof obj.JobTitle === 'string' ? obj.JobTitle : profile.department || '[Unknown]';

    const normalizeArray = (arr, max) => {
      if (!Array.isArray(arr)) return [];
      const cleaned = arr
        .filter(Boolean)
        .map(s => String(s).replace(/\s*\([^)]*\)/g, '').trim())
        .map(s => s.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' '))
        .filter(Boolean);
      // dedupe preserving order
      return [...new Set(cleaned)].slice(0, max);
    };

  out.WorkInterests = normalizeArray(Array.isArray(obj.WorkInterests) ? obj.WorkInterests : [], 12);
  out.PersonalInterests = normalizeArray(Array.isArray(obj.PersonalInterests) ? obj.PersonalInterests : [], 8);

    out.Bio = typeof obj.Bio === 'string' ? obj.Bio.trim() : '';
    out.FunFact = typeof obj.FunFact === 'string' ? obj.FunFact.trim() : '';

    return out;
  }

  // Attempt to get a valid JSON response from the model, with limited retries
  let aiText = '';
  let aiJson = null;
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    aiText = await getOpenAiCompletion(prompt);
    // try direct parse first
    try {
      aiJson = typeof aiText === 'string' ? JSON.parse(aiText) : null;
    } catch (e) {
      aiJson = extractJsonObject(aiText);
    }

    if (aiJson) {
      const validated = validateAndNormalize(aiJson);
      if (validated && (validated.Bio || validated.WorkInterests.length || validated.PersonalInterests.length)) {
        aiJson = validated;
        break;
      }
      // invalid content, continue to retry
      aiJson = null;
    }

    // If we reach here, try once more with a stricter clarification prompt appended
    console.log(`WARNING: OpenAI response was not valid JSON on attempt ${attempt + 1}. Retrying...`);
    const clarification = '\n\nPLEASE RESPOND WITH ONLY THE SINGLE JSON OBJECT FOLLOWING THE SCHEMA EXACTLY. DO NOT PROVIDE ANY EXTRA TEXT.';
    // small follow-up prompt: append clarification to original prompt
    // Note: we intentionally reuse the same prompt variable here for simplicity
    await new Promise(r => setTimeout(r, 500));
    // On retry, call the model again (loop continues)
  }

  // If still null, fallback: build a minimal object from collected profile
  if (!aiJson) {
    console.log('ERROR: Failed to parse JSON from OpenAI after retries. Falling back to best-effort merge.');
    aiJson = {
      Name: profile.name || '[Unknown]',
      Affiliation: profile.affiliation || '[Unknown]',
      JobTitle: profile.department || '[Unknown]',
      WorkInterests: profile.topSkills || profile.workInterests || [],
      PersonalInterests: profile.personalInterests || [],
      Bio: profile.bio || '',
      FunFact: ''
    };
  }

  // Merge AI JSON with profile, preferring source-truth (contact/api) for name and affiliation
  const finalProfile = {
    name: profile.name || aiJson.Name || '[Unknown]',
    affiliation: profile.affiliation || aiJson.Affiliation || '[Unknown]',
    department: profile.department || aiJson.JobTitle || '[Unknown]',
    workInterests: Array.isArray(aiJson.WorkInterests) && aiJson.WorkInterests.length ? aiJson.WorkInterests : (profile.topSkills || profile.workInterests || []),
    personalInterests: Array.isArray(aiJson.PersonalInterests) && aiJson.PersonalInterests.length ? aiJson.PersonalInterests : (profile.personalInterests || []),
    bio: aiJson.Bio || profile.bio || '',
    funFact: aiJson.FunFact || '' ,
    rawData: rawData,
    aiRaw: aiText
  };

  // Build provenance object describing where key fields came from
  const provenance = { personalInterests: 'none', funFact: 'none' };
  if (Array.isArray(aiJson.PersonalInterests) && aiJson.PersonalInterests.length) provenance.personalInterests = 'ai';
  else if (Array.isArray(profile.personalSeedInterests) && profile.personalSeedInterests.length) provenance.personalInterests = 'seed';

  // If PersonalInterests are empty but we have seed interests from summarizer, use them
  if ((!finalProfile.personalInterests || finalProfile.personalInterests.length === 0) && Array.isArray(profile.personalSeedInterests) && profile.personalSeedInterests.length > 0) {
    finalProfile.personalInterests = profile.personalSeedInterests;
  }

  // FunFact inference heuristic: scan evidence and recent posts for hobby keywords
  const hobbyKeywords = ['cycling','biking','running','hiking','photography','travel','cooking','gardening','piano','guitar','music','coffee','sailing','skiing','kayaking','reading','film','movies','tennis','yoga','meditation','surfing','running'];
  function capitalizeFirst(s){ if(!s) return s; return s.charAt(0).toUpperCase()+s.slice(1); }
  function inferFunFact(evidenceArr, postsArr){
    const texts = [];
    if (Array.isArray(evidenceArr)) for (const e of evidenceArr) if (e && (e.excerpt || e.text)) texts.push(e.excerpt || e.text);
    if (Array.isArray(postsArr)) for (const p of postsArr) if (p && p.text) texts.push(p.text);
    const hay = texts.join(' ').toLowerCase();
    for (const kw of hobbyKeywords) {
      if (hay.includes(kw)) return capitalizeFirst(`enjoys ${kw}`);
    }
    return '';
  }

  // If AI provided a funFact, mark provenance as ai, otherwise try to infer
  if (finalProfile.funFact && finalProfile.funFact.length) provenance.funFact = 'ai';
  else {
    const inferred = inferFunFact(profile.personalEvidence || [], Array.isArray(rawData.posts) ? rawData.posts.slice(0,20) : []);
    if (inferred) {
      finalProfile.funFact = inferred;
      provenance.funFact = 'inferred';
    }
  }

  finalProfile.provenance = provenance;

  // If PersonalInterests are empty but we have seed interests from summarizer, use them
  if ((!finalProfile.personalInterests || finalProfile.personalInterests.length === 0) && Array.isArray(profile.personalSeedInterests) && profile.personalSeedInterests.length > 0) {
    finalProfile.personalInterests = profile.personalSeedInterests;
  }

  // Normalize workInterests: merge obvious synonyms
  const normalizeWork = (arr) => {
    if (!Array.isArray(arr)) return [];
    const map = { 'Business Strategy': 'Strategy', 'Data Analysis': 'Analytics', 'Econometrics': 'Analytics' };
    const out = [];
    for (const s of arr) {
      const key = map[s] || s;
      if (!out.includes(key)) out.push(key);
    }
    return out;
  };
  finalProfile.workInterests = normalizeWork(finalProfile.workInterests || []);

  // Ensure the bio does not include the person's name (remove occurrences if present)
  if (finalProfile.name && finalProfile.bio) {
    const nameRegex = new RegExp(finalProfile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    finalProfile.bio = finalProfile.bio.replace(nameRegex, '').replace(/\s{2,}/g, ' ').trim();
    // If bio starts with a stray comma or 'is', clean it
    finalProfile.bio = finalProfile.bio.replace(/^,\s*/, '');
  }

  // Save output
  fs.writeFileSync('./output/avatarProfile.json', JSON.stringify(finalProfile, null, 2));
  console.log('Avatar profile saved to output/avatarProfile.json');

  // Save a .txt file with key profile fields
  const txt = `Name: ${finalProfile.name || '[Not found]'}\nAffiliation: ${finalProfile.affiliation || '[Not found]'}\nDepartment: ${finalProfile.department || '[Not found]'}\n\nWork Skills: ${Array.isArray(finalProfile.workInterests) ? finalProfile.workInterests.join(', ') : '[None]'}\nPersonal Skills: ${Array.isArray(finalProfile.personalInterests) ? finalProfile.personalInterests.join(', ') : '[None]'}\n\nBio:\n${finalProfile.bio || '[No bio generated]'}\n`;
  fs.writeFileSync('./output/avatarProfile.txt', txt);
  console.log('Avatar profile saved to output/avatarProfile.txt');
}

// Example usage: replace with actual username or public identifier
main('kevin-b-707b29').catch(console.error);
