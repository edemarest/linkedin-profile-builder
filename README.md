# LinkedIn Profile Builder — README

## Overview
This repository fetches a public LinkedIn user's scraped data, summarizes personal content, extracts work and personal interests, rewrites a short first-person bio, and assembles a compact, structured profile JSON and a human-readable summary. The pipeline emphasizes reliability and deterministic fallbacks when any model output is malformed or missing.

Intended audience: a developer or reviewer who is new to the project and wants a clear, step-by-step explanation of how the profile is constructed and what technologies are used at each step.

---

## Quick start

1. Install dependencies:
   - node.js (v18+ recommended)
   - npm install
2. Create and populate `.env` in the project root with the following variables (example names only):
   - `OPENAI_API_KEY` — OpenAI API key for embeddings + chat
   - `RAPIDAPI_KEY` — RapidAPI key used by the LinkedIn scraper
   - `RAPIDAPI_HOST` and `BASE_URL` — host/base URL for the RapidAPI LinkedIn scraper
   - `TARGET_PROFILE` — LinkedIn username to fetch (e.g., `stephen-demarest-76020a2`)
   - `WRITE_DEBUG_OUTPUTS=true|false` — enable debug output files in `output/`

   Note: `.gitignore` already excludes `.env` and the `output/` directory.

3. Run the pipeline:
   - node main.js
   - Output files (when `WRITE_DEBUG_OUTPUTS=true`) will appear under `./output/` and the final profile will be saved to `output/avatarProfile.json` and `output/avatarProfile.txt`.

---

## High-level pipeline (flowchart)

The pipeline runs sequentially and is divided into clearly named stages. Below is a compact ASCII flowchart and an accompanying table describing each step.

Flowchart:

Raw LinkedIn Data --> Profile Builder --> Summarizer (embeddings + clustering + LLM) --> 4 LLM calls (work, personal, bio, final) --> Validation & deterministic fallbacks --> Final Profile


Table: step-by-step

| Step | Sub-steps / files | Purpose & technology |
|------|-------------------|----------------------|
| 0. Fetch raw data | `api/linkedinApi.js` -> `callLinkedInApi()` | Calls the configured RapidAPI LinkedIn scraper endpoints to collect `experience`, `educations`, `contact`, `posts`, `comments`, `skills`, etc. Result stored in memory as `rawData` and optionally saved (redacted) to `output/raw_linkedin_data.json` when debug is enabled. |
| 1. Build profile object | `data/profileBuilder.js` -> `buildProfile(rawData)` | Normalizes rawData into a compact `profile` with fields like `name`, `affiliation`, `jobTitleOrMajor`, `topSkills`, `workInterests` (preliminary), `personalInterests` (raw harvest), `bio` (candidate), and `personalEvidence`. Key change: prefer experience.title for Job Title; fallback to education degree/major. |
| 2. Personal summarizer | `services/summarizer.js` -> `synthesizePersonalProfile(items)` | This module: 
- Deduplicates post/comment/media texts and filters them.
- Calls OpenAI embeddings (`text-embedding-3-small`) to embed content.
- Deduplicates by cosine similarity (>0.92 threshold).
- Runs a small k-means clustering on embeddings to produce clusters of similar content.
- For each cluster, picks representative excerpts and asks the LLM to summarize the cluster into 1 sentence.
- Uses the cluster summaries to request from the LLM up to 6 seed interests (strict JSON). 
- If the LLM output is malformed or missing, a deterministic token-frequency fallback is used to produce seed interests.
- Finally synthesizes a compact JSON artifact with `personalSummary`, `personalInterests`, `seedInterests`, `evidence`, `provenance` and always returns a valid artifact even if parsing fails (it will include `rawFinalText` and `error` fields). 

  Why embeddings + clustering? Embeddings group semantically similar posts and comments so that a small set of cluster summaries captures distinct themes (e.g., cycling, mentoring, community talks). Clustering reduces noise and helps the LLM focus on representative excerpts. |
| 3. Save summarizer artifact | `output/summarizer_artifact.json` (debug) | Contains `personalSummary`, `seedInterests`, `personalInterests` (if produced), `evidence`, and parse metadata. The summarizer also writes `output/cluster_artifacts.json` when debugging is enabled. That artifact contains compact centroids (truncated) and representative excerpts for each cluster for offline inspection. |
| 4. 4-call LLM orchestration | `main.js` using prompts in `data/prompts.js` | The pipeline splits LLM work into up to 4 focused calls to improve reliability: 
  - a) Work interests call (`makeWorkPrompt`) — low temperature, returns JSON `{"WorkInterests":[...]}`. Prefer skills and experience to generate title-cased professional interest labels. 
  - b) Personal seeds/interests call (`makePersonalPrompt`) — uses summarizer artifact as input and returns `personalSummary`, `seedInterests`, `personalInterests`. 
  - c) Bio rewrite call (`makeBioPrompt`) — reformats an existing bio or personal summary into exactly 2–3 short first-person sentences beginning with an activity phrase. The prompt explicitly forbids mentioning company names or job titles. A retry is attempted if the model fails to return 2–3 sentences. 
  - d) Final merge call (`makeFinalMergePrompt`) — assembles a single JSON object with the target schema, combining work interests, personal interests, bio, fun fact, and provenance. 

  Splitting work into focused calls increases reliability, keeps prompts small, and localizes parsing logic. Each LLM response is saved (e.g., `output/work_raw.txt`, `output/personal_raw.txt`, `output/bio_raw.txt`, `output/final_ai_raw.txt`) when debug is enabled. |
| 5. Parse & sanitize LLM outputs | `main.js`, `services/summarizer.js` | The code tries to parse direct JSON, then extracts the first JSON object from text, then runs sanitization routines (e.g., replacing smart quotes, removing trailing commas). The summarizer contains layered parsing attempts and deterministic fallbacks. This ensures the pipeline always receives a valid artifact or a deterministic substitute. |
| 6. Validation and normalization | `main.js` validateAndNormalize() | Normalize arrays (title-case, strip parentheses), dedupe lists, enforce Bio length and style. If the final JSON is invalid or missing, a deterministic merge fallback constructs a minimal profile from collected fields. |
| 7. Bio post-processing | `main.js` | Even after the LLM bio rewrite, the pipeline removes occurrences of `profile.name`, `profile.affiliation` and `profile.jobTitleOrMajor` from the bio (post-process sanitization). The bio must remain 2–3 first-person sentences; a deterministic rewrite will be used if necessary. Debug files saved: `bio_cleaned_before.txt`, `bio_deterministic_fallback.txt`. |
| 8. Final assembly | `main.js` -> `output/avatarProfile.json` & `.txt` and `output/final_profile.json` (debug) | Merge AI output and source profile, preferring source `name` and `affiliation`. Filter personal interests to exclude items that are the same as work interests/title. Infer a `funFact` (hobby) heuristically from evidence and recent posts if the AI did not provide one. |

---

## Detailed technical notes

### Embeddings and deduplication
- Model: `text-embedding-3-small` (OpenAI). Each selected text is embedded.
- Deduplication: pairwise cosine similarity; if similarity > 0.92 an item is considered a near-duplicate and dropped.
- Why dedupe before clustering? Reduces computation and avoids clusters dominated by repeated content.

### Clustering (k-means)
- A small, in-repo k-means implementation groups the remaining item embeddings into k clusters (k derived from sqrt(N) clamped to [1,8]).
- For each cluster, we select high-engagement representative posts/comments and ask the LLM to summarize that cluster into a single sentence.
- Cluster summaries provide compact signals to the LLM so it can extract human-friendly personal interests at a higher signal-to-noise ratio.

Trade-offs:
- K-means is lightweight and deterministic only up to random initial centroids. The summarizer stores compact cluster artifacts (centroids truncated to a fixed dimension) for debugging.
- Alternative approaches (e.g., hierarchical clustering, UMAP+t-SNE reduction) were intentionally avoided to keep the repo dependency-free.

### Seed extraction and deterministic fallback
- After cluster summaries are produced, the code asks the LLM to return strict JSON `{"seedInterests": [...]}`.
- If the LLM response is malformed or empty, a deterministic token-frequency heuristic is used as a fallback: tokenize cluster summaries, drop common stop words, select the top tokens as human-friendly labels.
- Seed interests are important because the main profile synthesis rules require non-empty `PersonalInterests` when seeds exist.

### LLM prompt design and splitting
- The pipeline uses 4 focused prompts:
  1. Work interests: convert raw skills and experience snippets into sanitized professional interest labels.
  2. Personal interests: use summarizer artifact to extract personal seeds and interests.
  3. Bio rewrite: rewrite into exactly 2–3 short first-person sentences; prompt explicitly forbids repeating company names or job titles.
  4. Final merge: return a single JSON object following the schema.

- Each LLM call uses conservative settings (low temperature) and limited token counts to reduce hallucination and encourage parseable outputs.

### Robust JSON parsing and sanitization
- The code attempts these parsing strategies (in order):
  1. JSON.parse of the whole text.
  2. Extract the first { ... } block using regex and JSON.parse.
  3. Sanitization routines: replace smart quotes, remove trailing commas, add missing quotes for keys heuristically, convert single quotes around values to double quotes.
  4. If parsing still fails, return deterministic fallback (from cluster summaries and token frequencies) and include `rawFinalText` and `error` fields in the artifact.

This makes the summarizer and overall pipeline resilient to malformed LLM responses.

### Bio handling and sanitization
- Prompt instructs the LLM not to include names, job titles, or employer names.
- Post-processing removes any remaining occurrences of the `name`, `affiliation`, and `jobTitleOrMajor` strings and common company suffixes (`Inc.`, `LLC`, etc.).
- The pipeline enforces 2–3 sentences; if the model cannot comply after retry, a deterministic 2-sentence fallback is used.

---

## Important files and where to look
- `main.js` — orchestrator: fetches data, runs summarizer, performs 4 LLM calls, validates/normalizes, writes final outputs.
- `api/linkedinApi.js` — the wrapper calling the RapidAPI LinkedIn scraper endpoints.
- `data/profileBuilder.js` — constructs the normalized `profile` object and harvests personal interest candidates.
- `data/prompts.js` — all the LLM prompt templates (work/personal/bio/final). Update these to change prompt behavior.
- `services/summarizer.js` — embeddings, clustering, seed extraction, and cluster-based summarization logic. Writes `output/cluster_artifacts.json` when debug is enabled.
- `openai/openaiClient.js` — wrapper for calling the OpenAI Chat/Embeddings endpoints.
- `output/` (debug files) — many helpful artifacts when `WRITE_DEBUG_OUTPUTS=true`:
  - `raw_linkedin_data.json` (redacted)
  - `summarizer_artifact.json`
  - `cluster_artifacts.json` (compact cluster centroids + excerpts)
  - `work_raw.txt`, `personal_raw.txt`, `bio_raw.txt`, `final_ai_raw.txt` (LLM raw outputs)
  - `final_prompt.txt`, `final_merge_prompt.txt` (exact prompts sent)
  - `ai_raw_response.txt`, `final_profile.json`, `avatarProfile.json`, `avatarProfile.txt`

---

## Running & debugging tips
- To see full debug outputs, set `WRITE_DEBUG_OUTPUTS=true` in `.env` and re-run `node main.js`.
- Inspect `output/cluster_artifacts.json` to verify clusters, representative excerpts, and the seed interests chosen.
- If the bio includes a company name, check `output/bio_raw.txt` (model output) and `output/bio_cleaned_before.txt` (before/after cleaning) to see where the pipeline stripped content.
- If the final merge JSON fails or is malformed, check `output/final_ai_raw.txt` and `output/final_merge_prompt.txt` to debug exact LLM exchanges.

---

## Safety & privacy
- `.env` is ignored by `.gitignore` to avoid committing secrets.
- `raw_linkedin_data.json` is redacted before writing: known sensitive keys (token, key, secret, password, access, refresh) and raw embedding arrays are replaced with placeholders.
- Only enable `WRITE_DEBUG_OUTPUTS` on trusted machines; debug artifacts include excerpts of posts and summaries that might contain personal text.

---

## Limitations & recommended improvements
- Clustering uses a simple k-means with random centroid initialization. Results may vary between runs. Consider a deterministic initialization (kmeans++ or seeded RNG) or HDBSCAN for better cluster quality.
- Centroid storage currently truncates embeddings to reduce artifact size. For advanced inspection you might want to store full embeddings offsite with proper access controls.
- The bio validator uses a single retry and a deterministic fallback. For stricter enforcement, add a small validation loop that re-prompts the LLM with a clarified minimal example until satisfied.
- Add unit tests for `validateAndNormalize`, summarizer token-frequency fallback, and the 4-call orchestration.

---

## Next steps
- Add developer scripts (npm run debug) that run the pipeline against a small sample and assert output schema.
- Add a `--profile` CLI flag to override `TARGET_PROFILE` from the command line.
- Add improved PII redaction heuristics before writing excerpts to debug files.

---

If you want, I can:
- Add a Makefile or npm script to run common workflows.
- Add unit tests for the summarizer and validate functions.
- Produce an SVG flowchart and embed it into this README.

