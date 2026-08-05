import "dotenv/config";

const KEY = process.env.CRICAPI_KEY || "564a9dca-7072-4673-9688-f26188641d66";
const BASE = "https://api.cricapi.com/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasErr = (d) => d.status !== "success" || d.data === undefined;

export async function fetchFromCricketApi(path, tries = 4) {
  const apiKey = KEY || "564a9dca-7072-4673-9688-f26188641d66";

  for (let i = 0; i < tries; i++) {
    try {
      const sep = path.includes("?") ? "&" : "?";
      const url = `${BASE}${path}${sep}apikey=${apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      
      // Checking for rate limit based on CricAPI's info object
      const rateLimited = data.info && data.info.hitsUsed >= data.info.hitsLimit;
      if (!rateLimited) return data;
      
      console.log("⏳ CricAPI Rate limit hit, sleeping for 65s...");
      await sleep(65000);
    } catch (error) {
      console.error(`Attempt ${i + 1} failed for ${path}:`, error.message);
      if (i === tries - 1) throw error;
      await sleep(2000);
    }
  }
  return { data: [], status: "error" };
}
