import { fetchFromCricketApi } from "./src/lib/cricketApi.js";

async function test() {
  const seriesId = '87c62aac-bc3c-4738-ab93-19da0690488f';
  const squadData = await fetchFromCricketApi('/series_squad?id=' + seriesId);
  if (squadData.data && squadData.data.length > 0) {
    const players = squadData.data[0].players;
    console.log("Player ID example:", players[0].id, typeof players[0].id);
  }
}
test();
