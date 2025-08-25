
// Entry point: orchestrates data collection and profile generation
const { callLinkedInApi } = require('./api/linkedinApi');
const { buildProfile } = require('./data/profileBuilder');
const { makeProfilePrompt } = require('./data/prompts');
const { getOpenAiCompletion } = require('./openai/openaiClient');
const fs = require('fs');

require('dotenv').config();

async function main(username) {
  // Use the correct endpoint for scraping all profile data by URL
  const rawData = {};
  const profileUrl = 'https://www.linkedin.com/in/ella-demarest-b48553189/';
  try {
    // Endpoint: get-profile-data-by-url
    const result = await callLinkedInApi('/get-profile-data-by-url', { url: profileUrl });
    rawData.profile = result;
    console.log('DEBUG: profile response:', result);
  } catch (err) {
    console.log('ERROR: Failed to fetch profile:', err.message);
    rawData.profile = null;
  }

  // Build structured profile object
  const profile = buildProfile(rawData);

  // Prepare prompt and get OpenAI completion
  const prompt = makeProfilePrompt(profile);
  const avatarBio = await getOpenAiCompletion(prompt);

  // Save output
  const output = { ...profile, avatarBio };
  fs.writeFileSync('./output/avatarProfile.json', JSON.stringify(output, null, 2));
  console.log('Avatar profile saved to output/avatarProfile.json');

  // Save a .txt file with key profile fields
  const txt = `Name: ${output.name || '[Not found]'}\nAffiliation: ${output.affiliation || '[Not found]'}\nDepartment: ${output.department || '[Not found]'}\n\nWork Skills: ${Array.isArray(output.workInterests) ? output.workInterests.join(', ') : '[None]'}\nPersonal Skills: ${Array.isArray(output.personalInterests) ? output.personalInterests.join(', ') : '[None]'}\n\nBio:\n${output.avatarBio || '[No bio generated]'}\n`;
  fs.writeFileSync('./output/avatarProfile.txt', txt);
  console.log('Avatar profile saved to output/avatarProfile.txt');
}

// Example usage: replace with actual username and urn
main('ella-demarest-b48553189').catch(console.error);
