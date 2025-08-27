// Prepares and formats prompts for OpenAI
function makeProfilePrompt(profile) {
  return `You are an AI that creates a short personal profile for someone using their LinkedIn data.

Known name (from contact): ${profile.name || '[Unknown]'}
Affiliation: ${profile.affiliation || ''}
Department / Title: ${profile.department || ''}
Top Skills: ${Array.isArray(profile.topSkills) ? profile.topSkills.join(', ') : (profile.workInterests || []).join(', ')}
Other Skills: ${(profile.workInterests || []).join(', ')}
Personal Interests (raw): ${(profile.personalInterests || []).join(', ')}
Education: ${Array.isArray(profile.education) ? profile.education.join('; ') : ''}

Compact personal summary (from user's posts/about): ${profile.personalSummary ? `"${profile.personalSummary.replace(/"/g, '\\"')}"` : '[none]'}
Compact personal interests (from summarizer): ${Array.isArray(profile.personalSummaryInterests) ? profile.personalSummaryInterests.join(', ') : '[none]'}
Seed interests (deterministic candidates from content): ${Array.isArray(profile.personalSeedInterests) ? profile.personalSeedInterests.join(', ') : '[none]'}
Evidence excerpts: ${Array.isArray(profile.personalEvidence) ? profile.personalEvidence.map(e => e.excerpt || '').slice(0,3).join(' || ') : ''}

INSTRUCTIONS (IMPORTANT):
- Return ONLY a single JSON object and nothing else.
- Use this exact schema (keys and types):
{
  "Name": string,
  "Affiliation": string,
  "JobTitle": string,
  "WorkInterests": [string],
  "PersonalInterests": [string],
  "Bio": string,
  "FunFact": string,
  "Provenance": { "PersonalInterests": string, "FunFact": string }
}

  - Rules:
  - If Known name is provided above, use it exactly for "Name". Otherwise use "[Unknown]".
  - Prefer the Compact personal summary and Evidence excerpts when synthesizing PersonalInterests and FunFact; only use raw volunteer/publication/education fields if the compact summary is not available.
  - Synthesize WorkInterests by grouping Top Skills and Other Skills into human-friendly, title-cased interest labels (e.g., "Data Science", "Business Strategy"). Do NOT list raw languages, frameworks, libraries, company names, or job titles as interests. Merge obvious synonyms (e.g., "Business Strategy" -> "Strategy").
  - Choose up to 6 concise WorkInterests that summarize the person's professional focus.
  - Synthesize up to 6 PersonalInterests using the compact personal summary, seed interests, and evidence. If 'Seed interests' are present, prefer them — PersonalInterests must NOT be an empty array when seeds exist; instead, include the top 3-6 seed interests (normalized) and label any low-confidence items as inferred.
  - When evidence is weak but seeds exist, include seeds and set provenance to indicate they came from deterministic extraction.
  - Bio must be 1-2 short sentences in the first person ("I ..."), casual and social-media friendly. Do NOT include the person's name. Avoid lists of tools, libraries, or long technical stacks. Start with an activity phrase ("I research...", "I build...", "I teach...").
  - Do NOT start the bio by restating the job title or company. Mention job focus only if it supports a human-friendly activity phrase.
  - FunFact: Provide a short (<=12 words) personal detail suitable for a social post (hobby, surprising preference, or non-work passion). If no direct evidence is available, prefer a concise, plausible hobby inferred from posts (e.g., "enjoys cycling") and mark it as "inferred" in Provenance. If absolutely no hobby inference is possible, return an empty string.

  - Provenance: Include a small object describing where key fields came from. Use values: "ai" (synthesized from the AI), "seed" (deterministic candidate from content), "inferred" (heuristic inference), or "none". Example: "Provenance": {"PersonalInterests":"seed","FunFact":"inferred"}.

Examples (guidance only):
- Skills: [Python, pysam, Nextflow, AWS] -> WorkInterests: ["Bioinformatics", "Data science"]
- Skills: [React.js, HTML, CSS] -> WorkInterests: ["Web development", "Front-end engineering"]
- Skills: [Figma, Photoshop] -> WorkInterests: ["Design", "UX"]

Return ONLY the JSON object that follows the schema above. Strictly return JSON — no explanatory text, no backticks, no markdown.`;
}

module.exports = { makeProfilePrompt };
