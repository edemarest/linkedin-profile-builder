// Prepares and formats prompts for OpenAI
function makeProfilePrompt(profile) {
  return `You are an AI that writes bios for people. Here is the user's data:\n\nName: ${profile.name}\nAffiliation: ${profile.affiliation}\nDepartment: ${profile.department}\nWork Interests: ${profile.workInterests.join(', ')}\nPersonal Interests: ${profile.personalInterests.join(', ')}\nEducation: ${Array.isArray(profile.education) ? profile.education.join(', ') : ''}\nHonors: ${profile.honors ? profile.honors.join(', ') : ''}\nBio: ${profile.bio}\n\nWrite a short, casual but professional 2-3 sentence bio for this person. Avoid hashtags, emoji, and social media slang. Do not sound like a job application or self-promotion. Instead, highlight their interests, personality, and what makes them unique, while mentioning relevant work context. The tone should be friendly, confident, and authentic. If relevant, mention their education, certifications, or languages.`;
}

module.exports = { makeProfilePrompt };
