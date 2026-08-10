import dotenv from "dotenv";
dotenv.config();
import { pool } from "./src/db.js";

async function test() {
  const partnerId = '3d3487c2-7981-49db-b3e0-9ad78c34e292';
  
  console.log("=== ALL TOURNAMENTS ===");
  const { rows: allT } = await pool.query(
    `SELECT id, name, sport_key, status, created_at FROM tournaments WHERE partner_id = $1 ORDER BY created_at DESC`,
    [partnerId]
  );
  console.table(allT);

  console.log("\n=== ACTIVE TOURNAMENTS (returned by GET /public/tournaments) ===");
  const { rows: activeT } = await pool.query(
    `SELECT t.id, t.name, t.sport_key, t.status, t.api_league_id, s.name as sport_name
     FROM tournaments t
     JOIN partners p ON t.partner_id = p.id
     JOIN sports_config s ON t.sport_key = s.key
     WHERE t.partner_id = $1 AND t.status = 'Active' 
     ORDER BY t.created_at DESC`,
    [partnerId]
  );
  console.table(activeT);

  console.log("\n=== PARTNER SDK ROWS ===");
  const { rows: sdkRows } = await pool.query(
    `SELECT id, partner_id, sport_key, sdk_token, status, tournament_id FROM partner_sports_sdk WHERE partner_id = $1`,
    [partnerId]
  );
  console.table(sdkRows);

  console.log("\n=== PLAYER COUNTS PER TOURNAMENT ===");
  for (const t of activeT) {
    const { rows: [{ count }] } = await pool.query(
      `SELECT count(*) FROM players WHERE tournament_id = $1`,
      [t.id]
    );
    console.log(`  ${t.name} (${t.id}): ${count} players`);
  }

  await pool.end();
}

test();
