// Prepares and formats prompts for OpenAI
function makeProfilePrompt(profile) {
  return `You are an AI that creates a short personal profile for someone using their LinkedIn data.

Known name (from contact): ${profile.name || '[Unknown]'}
Affiliation: ${profile.affiliation || ''}
Job Title or Major: ${profile.jobTitleOrMajor || profile.jobTitle || ''}
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
  - JobTitle should be the person's current job title OR, if no clear job is present, their degree and major (e.g., "BS in Computer Science").
  - Prefer the Compact personal summary and Evidence excerpts when synthesizing PersonalInterests and FunFact; only use raw volunteer/publication/education fields if the compact summary is not available.
  - If deterministic seed interests exist (profile.personalSeedInterests), PersonalInterests must NOT be an empty array — include the top 3-6 seed interests (normalized) and label any low-confidence items as inferred.
  - If no seeds exist, attempt to populate PersonalInterests from contact fields (headline, summary/about), education activities/extracurriculars, and publications before returning an empty array.
  - Synthesize WorkInterests by grouping Top Skills and Other Skills into human-friendly, title-cased interest labels (e.g., "Data Science", "Business Strategy"). Do NOT list raw languages, frameworks, libraries, company names, or job titles as interests. Merge obvious synonyms (e.g., "Business Strategy" -> "Strategy").
  - Choose up to 6 concise WorkInterests that summarize the person's professional focus.
  - Synthesize up to 6 PersonalInterests using the compact personal summary, seed interests, and evidence. If 'Seed interests' are present, prefer them — PersonalInterests must NOT be an empty array when seeds exist; instead, include the top 3-6 seed interests (normalized) and label any low-confidence items as inferred.
  - When evidence is weak but seeds exist, include seeds and set provenance to indicate they came from deterministic extraction.
  - Bio must be 2-3 short sentences in the first person ("I ..."), casual and social-media friendly. Do NOT include the person's name. Avoid lists of tools, libraries, or long technical stacks. Start with an activity phrase ("I research...", "I build...", "I teach...").
  - Do NOT start the bio by restating the job title or company. Mention job focus only if it supports a human-friendly activity phrase.
  - FunFact: Provide a short (<=12 words) personal detail suitable for a social post (hobby, surprising preference, or non-work passion). If no direct evidence is available, prefer a concise, plausible hobby inferred from posts (e.g., "enjoys cycling") and mark it as "inferred" in Provenance. If absolutely no hobby inference is possible, return an empty string.

  - Provenance: Include a small object describing where key fields came from. Use values: "ai" (synthesized from the AI), "seed" (deterministic candidate from content), "inferred" (heuristic inference), or "none". Example: "Provenance": {"PersonalInterests":"seed","FunFact":"inferred"}.

Examples (guidance only):
- Skills: [Python, pysam, Nextflow, AWS] -> WorkInterests: ["Bioinformatics", "Data science"]
- Skills: [React.js, HTML, CSS] -> WorkInterests: ["Web development", "Front-end engineering"]
- Skills: [Figma, Photoshop] -> WorkInterests: ["Design", "UX"]

Return ONLY the JSON object that follows the schema above. Strictly return JSON — no explanatory text, no backticks, no markdown.`;
}

function makeWorkPrompt(profile) {
  const skills = Array.isArray(profile.topSkills) ? profile.topSkills.join(', ') : (profile.workInterests || []).slice(0,8).join(', ');
  const snippets = (profile.rawData && Array.isArray(profile.rawData.experience) && profile.rawData.experience.length) ? profile.rawData.experience.slice(0,2).map(e => `- ${e.title || ''} at ${e.company?.name || e.company || ''}`) .join('\n') : '';
  return `You are an assistant that converts raw skill strings into up to 6 concise professional interest labels (e.g. "Bioinformatics", "Protein Engineering"). Input skills: ${skills}\n${snippets}\nReturn strict JSON: { "WorkInterests": ["...","..."] } . Do NOT return job titles, company names, programming languages, frameworks, or tool names. Title-case each interest.`;
}

function makePersonalPrompt(summarizerArtifact, profile) {
  const combined = (summarizerArtifact && summarizerArtifact.personalSummary) ? summarizerArtifact.personalSummary : (summarizerArtifact && summarizerArtifact.combined) || '';
  const seeds = (summarizerArtifact && Array.isArray(summarizerArtifact.seedInterests)) ? summarizerArtifact.seedInterests.join(', ') : '';
  const evidence = (summarizerArtifact && Array.isArray(summarizerArtifact.evidence)) ? summarizerArtifact.evidence.slice(0,3).map(e => `- ${e.excerpt || e.text || ''}`).join('\n') : '';
  return `You are an assistant that extracts up to 6 personal interests or hobbies from the following compact user content. Compact summary:\n${combined}\nSeed candidates: ${seeds}\nEvidence:\n${evidence}\nReturn strict JSON: { "personalSummary": "...", "seedInterests": ["..."], "personalInterests": ["..."] } . Prefer seeds if present; otherwise use summary and evidence to propose human-friendly personal interests (hobbies, community activities, non-work passions).`;
}

function makeBioPrompt(profile, personalSummary) {
  const bioSource = profile.bio || personalSummary || '';
  const job = profile.jobTitleOrMajor || profile.department || '';
  const affiliation = profile.affiliation || '';
  return `Rewrite the following into exactly 2-3 short, casual first-person sentences beginning with an activity phrase (e.g., "I research...", "I lead..."). Do NOT include the person's name, employer/company names, or job titles. Avoid lists or tool stacks. Focus on personal activities, motivations, and human-friendly framing. Return ONLY the rewritten bio text (no JSON, no explanation).

Original bio/source:
"${bioSource.replace(/"/g,'\\"')}"

Context (for reference only — DO NOT repeat in the bio): job/title: ${job}; affiliation: ${affiliation}`;
}

function makeFinalMergePrompt(profile, workInterests, personalInterests, bio, evidence) {
  return `You are an AI that assembles a final profile JSON using the following inputs. Return ONLY one JSON object matching the schema below.
Inputs:\nName: ${profile.name || '[Unknown]'}\nAffiliation: ${profile.affiliation || ''}\nJobTitle: ${profile.jobTitleOrMajor || profile.department || ''}\nWorkInterests (candidate): ${Array.isArray(workInterests) ? workInterests.join(', ') : ''}\nPersonalInterests (candidate): ${Array.isArray(personalInterests) ? personalInterests.join(', ') : ''}\nBio: ${bio || ''}\nEvidence excerpts:\n${(evidence || []).slice(0,3).map(e=>`- ${e.excerpt || e.text || ''}`).join('\n')}

Return JSON schema:
{ "Name": string, "Affiliation": string, "JobTitle": string, "WorkInterests": [string], "PersonalInterests": [string], "Bio": string, "FunFact": string, "Provenance": { "PersonalInterests": string, "FunFact": string } }

Rules: Use Name exactly if provided. Use provided WorkInterests and PersonalInterests candidates; normalize and pick up to 6 each. Bio must be 2-3 short first-person sentences. FunFact: provide a short hobby or empty string. Provenance values: 'ai','seed','inferred','none'.`;
}

module.exports = { makeProfilePrompt, makeWorkPrompt, makePersonalPrompt, makeBioPrompt, makeFinalMergePrompt };
