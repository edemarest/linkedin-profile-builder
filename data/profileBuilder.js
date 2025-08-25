// Aggregates and processes raw API data into a structured profile object
function buildProfile(rawData) {
  // New API response structure: data is usually at root, not under .data
  // Handle missing/null gracefully
  const profile = rawData.profile || {};
  // Name
  const name = (profile.firstName && profile.lastName)
    ? `${profile.firstName} ${profile.lastName}`
    : (profile.multiLocaleFirstName?.en && profile.multiLocaleLastName?.en)
      ? `${profile.multiLocaleFirstName.en} ${profile.multiLocaleLastName.en}`
      : profile.username || '';

  // Affiliation and department from position
  const positions = Array.isArray(profile.position) ? profile.position : [];
  const affiliation = positions[0]?.companyName || '';
  const department = positions[0]?.title || '';

  // Work interests: skills
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  let workInterests = skills.map(s => s.name || s).filter(Boolean);

  // Personal interests: activities, geo, etc.
  let personalInterests = [];
  if (profile.geo?.full) personalInterests.push(profile.geo.full);
  if (profile.isTopVoice) personalInterests.push('Top Voice');
  if (profile.isCreator) personalInterests.push('Creator');

  // Education
  const educations = Array.isArray(profile.educations) ? profile.educations : [];
  let educationArr = educations.map(e => e.schoolName || e.degree || e.fieldOfStudy || '').filter(Boolean);

  // Honors (not always present)
  let honorsArr = [];
  if (profile.isPremium) honorsArr.push('LinkedIn Premium');

  // Bio
  const bio = profile.headline || profile.summary || (profile.multiLocaleHeadline?.en || '');

  return {
    name,
    affiliation,
    department,
    workInterests,
    personalInterests,
    education: educationArr,
    honors: honorsArr,
    bio,
    rawData // keep for debugging or future use
  };
}

module.exports = { buildProfile };
