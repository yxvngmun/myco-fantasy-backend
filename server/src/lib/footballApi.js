import "dotenv/config";

const KEY = process.env.API_FOOTBALL_KEY;
const BASE = "https://v3.football.api-sports.io";
const H = { headers: { "x-apisports-key": KEY } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasErr = (d) => (Array.isArray(d.errors) ? d.errors.length : Object.keys(d.errors || {}).length) > 0;

export async function fetchFromFootballApi(path, tries = 4) {
  if (!KEY) {
    throw new Error("API_FOOTBALL_KEY is not defined in backend .env");
  }

  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(BASE + path, H);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const rateLimited = hasErr(data) && JSON.stringify(data.errors).toLowerCase().includes("rate");
      if (!rateLimited) return data;
      
      console.log("⏳ API-Football Rate limit hit, sleeping for 65s...");
      await sleep(65000);
    } catch (error) {
      console.error(`Attempt ${i + 1} failed for ${path}:`, error.message);
      if (i === tries - 1) throw error;
      await sleep(2000);
    }
  }
  return { response: [], errors: ["gave up after retries"] };
}
