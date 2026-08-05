import dotenv from "dotenv";
dotenv.config();
import { fetchFromCricketApi } from "./src/lib/cricketApi.js";

async function test() {
  console.log("CRICAPI_KEY:", process.env.CRICAPI_KEY);
  try {
    const res1 = await fetchFromCricketApi("/series");
    console.log("=== /series response ===");
    console.dir(res1, { depth: 3 });

    const seriesId = "87c62aac-bc3c-4738-ab93-19da0690488f";
    const res2 = await fetchFromCricketApi("/series_info?id=" + seriesId);
    console.log("=== /series_info response ===");
    console.dir(res2, { depth: 3 });

    const res3 = await fetchFromCricketApi("/series_squad?id=" + seriesId);
    console.log("=== /series_squad response ===");
    console.dir(res3, { depth: 3 });
  } catch (err) {
    console.error("CricAPI test error:", err);
  }
}

test();
