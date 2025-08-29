// Aggregates and processes raw API data into a structured profile object
function buildProfile(rawData) {
  // New API response structure: data is usually at root, not under .data
  // Handle missing/null gracefully
    // Determine name from contact (handled below) — do not attempt to fabricate names here
  let name = '';
  // Prefer contact endpoint if available (support snake_case and camelCase keys)
  if (rawData.contact) {
    const c = rawData.contact;
    const full = c.fullName || c.full_name || c.fullname || c.name;
    const first = c.firstName || c.first_name || c.first;
    const last = c.lastName || c.last_name || c.last;
    if (full) name = full;
    else if (first || last) name = [first, last].filter(Boolean).join(' ');
  }
  
  // Job title or major: prefer current/most recent experience title, else try education major/degree
  let jobTitleOrMajor = '';
  if (rawData.experience && rawData.experience.length > 0) {
    jobTitleOrMajor = rawData.experience[0].title || rawData.experience[0].jobTitle || '';
  }
  // If no experience title, try to infer from education (major/fieldOfStudy/degree)
  if (!jobTitleOrMajor && Array.isArray(rawData.educations) && rawData.educations.length > 0) {
    const edu = rawData.educations[0];
    const major = edu.major || edu.fieldOfStudy || edu.field || edu.areaOfStudy || '';
    const degree = edu.degree || edu.degreeName || '';
    if (major && degree) jobTitleOrMajor = `${degree}${major ? ' in ' + major : ''}`;
    else if (major) jobTitleOrMajor = major;
    else if (degree) jobTitleOrMajor = degree;
  }
  
  // Affiliation from first experience company
  let affiliation = '';
  if (rawData.experience && rawData.experience.length > 0) {
    affiliation = rawData.experience[0].company?.name || rawData.experience[0].company || '';
  }
  // Work interests: skills from /skills and experience, normalized
  let workInterests = [];
  if (Array.isArray(rawData.skills)) {
    workInterests = rawData.skills.map(s => s.skill || s.name || s).filter(Boolean);
  }
  if (rawData.experience && rawData.experience.length > 0) {
    for (const exp of rawData.experience) {
      if (Array.isArray(exp.skills)) {
        workInterests = workInterests.concat(exp.skills.map(s => s));
      }
    }
  }
  // Normalize: deduplicate, clean parentheses, trim
  workInterests = [...new Set(workInterests)]
    .map(s => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().replace(/\s*\([^)]*\)/g, '') : s)
    .filter(s => s && typeof s === 'string' && s.length > 1)
    .map(s => s.split(' ').map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(' '));
  // topSkills: most frequent limited list
  const skillCounts = {};
  workInterests.forEach(s => { skillCounts[s] = (skillCounts[s] || 0) + 1; });
  const topSkills = Object.keys(skillCounts).sort((a,b) => skillCounts[b]-skillCounts[a]).slice(0, 12);
  // Note: we do not attempt to infer high-level interest themes here. The AI
  // prompt should synthesize broader interest labels from the Top Skills and
  // Other Skills. Keep this module focused on normalizing and deduping raw
  // skill strings for use in the prompt.
  // Personal interests: volunteers, publications, education activities (not degree/school)
  let personalInterests = [];
  if (Array.isArray(rawData.volunteers)) {
    personalInterests = personalInterests.concat(rawData.volunteers.map(v => v.cause || v.organization || v.title || v.description || v));
  }
  if (Array.isArray(rawData.publications)) {
    personalInterests = personalInterests.concat(rawData.publications.map(p => p.title || p.publication || p.description || p));
  }
  if (Array.isArray(rawData.educations)) {
    personalInterests = personalInterests.concat(rawData.educations.map(e => e.activities || e.extracurriculars || e.projects || ''));
  }
  // Also try to harvest interests from the contact record (headline, summary, interests)
  if (rawData.contact) {
    const c = rawData.contact;
    if (c.headline) personalInterests.push(c.headline);
    if (c.summary || c.about) personalInterests.push(c.summary || c.about);
    if (Array.isArray(c.interests)) personalInterests = personalInterests.concat(c.interests);
    if (typeof c.interests === 'string') personalInterests.push(c.interests);
  }
  // If posts are present, pull frequent hashtags or topics (simple heuristic)
  if (Array.isArray(rawData.posts)) {
    for (const p of rawData.posts.slice(0, 80)) {
      const text = (p.text || p.content || '').toString();
      const tags = (text.match(/#\w+/g) || []).map(t => t.replace('#',''));
      personalInterests = personalInterests.concat(tags);
    }
  }
  personalInterests = [...new Set(personalInterests)].filter(Boolean).map(s => typeof s === 'string' ? s.trim() : s);
  // Education: degree and school
  let educationArr = [];
  if (Array.isArray(rawData.educations)) {
    educationArr = rawData.educations.map(e => `${e.degree || ''}${e.degree && e.school ? ' at ' : ''}${e.school || ''}`.trim()).filter(Boolean);
  }
  // Honors: not available, leave blank
  let honorsArr = [];
  // Bio: use description from first experience or education or contact summary
  let bio = '';
  if (rawData.experience && rawData.experience.length > 0) {
    bio = rawData.experience[0].description || rawData.experience[0].summary || '';
  } else if (rawData.educations && rawData.educations.length > 0) {
    bio = rawData.educations[0].description || rawData.educations[0].summary || '';
  } else if (rawData.contact) {
    bio = rawData.contact.summary || rawData.contact.about || '';
  }
  return {
    name,
    affiliation,
    jobTitleOrMajor,
    workInterests,
    personalInterests,
    education: educationArr,
    honors: honorsArr,
    bio,
  topSkills,
    rawData // keep for debugging or future use
  };
}

module.exports = { buildProfile };
