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
  
  // Affiliation and department from first experience
  let affiliation = '';
  let department = '';
  if (rawData.experience && rawData.experience.length > 0) {
    affiliation = rawData.experience[0].company?.name || '';
    department = rawData.experience[0].title || '';
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
    personalInterests = personalInterests.concat(rawData.educations.map(e => e.activities || ''));
  }
  personalInterests = [...new Set(personalInterests)].filter(Boolean);
  // Education: degree and school
  let educationArr = [];
  if (Array.isArray(rawData.educations)) {
    educationArr = rawData.educations.map(e => `${e.degree || ''}${e.degree && e.school ? ' at ' : ''}${e.school || ''}`.trim()).filter(Boolean);
  }
  // Honors: not available, leave blank
  let honorsArr = [];
  // Bio: use description from first experience or education
  let bio = '';
  if (rawData.experience && rawData.experience.length > 0) {
    bio = rawData.experience[0].description || '';
  } else if (rawData.educations && rawData.educations.length > 0) {
    bio = rawData.educations[0].description || '';
  }
  return {
    name,
    affiliation,
    department,
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
