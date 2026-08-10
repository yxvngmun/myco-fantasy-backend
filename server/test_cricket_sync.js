import dotenv from "dotenv";
dotenv.config();
import { syncTournamentData } from "./src/lib/sync.js";

async function testSync() {
  const tournamentId = '6b8cf2ff-e3f4-4a71-8285-11d93bfdec84'; // FP Cric Bash (sportKey: cricket)
  try {
    await syncTournamentData(tournamentId, 50, '2026');
    console.log("SUCCESS");
  } catch (e) {
    console.error("FAILED:", e);
  } finally {
    process.exit(0);
  }
}
testSync();
