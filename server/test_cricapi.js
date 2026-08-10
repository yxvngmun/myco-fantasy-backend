import { fetchFromCricketApi } from "./src/lib/cricketApi.js";

async function test() {
  const seriesId = '87c62aac-bc3c-4738-ab93-19da0690488f';
  const infoData = await fetchFromCricketApi('/series_info?id=' + seriesId);
  console.log("INFO DATA:", infoData);
  
  const squadData = await fetchFromCricketApi('/series_squad?id=' + seriesId);
  console.log("SQUAD DATA length:", squadData.data ? squadData.data.length : 0);
  if (squadData.status !== "success") {
    console.log("SQUAD DATA FAILED:", squadData);
  }
}
test();
