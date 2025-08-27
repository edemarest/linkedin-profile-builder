// Handles all LinkedIn scraper API calls
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
require('dotenv').config();

const BASE_URL = process.env.BASE_URL;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

async function callLinkedInApi(endpoint, params = {}) {
  const url = new URL(endpoint, BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    });
  } catch (err) {
    console.log(`ERROR: Network error for ${endpoint}:`, err.message);
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    console.log(`ERROR: API ${endpoint} failed (${res.status}):`, text);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  // fresh-linkedin-scraper-api returns JSON for all endpoints
  return await res.json();
}

module.exports = { callLinkedInApi };
