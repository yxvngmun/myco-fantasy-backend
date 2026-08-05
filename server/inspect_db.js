import dotenv from "dotenv";
dotenv.config();
import { pool } from "./src/db.js";

async function inspect() {
  try {
    const { rows: partners } = await pool.query("SELECT id, name, subdomain, sports FROM partners");
    console.log("=== PARTNERS ===");
    console.dir(partners, { depth: null });

    const { rows: tournaments } = await pool.query("SELECT id, name, sport_key, status, partner_id, api_league_id, created_at FROM tournaments");
    console.log("=== TOURNAMENTS ===");
    console.dir(tournaments, { depth: null });

    const { rows: sdk } = await pool.query("SELECT id, partner_id, sport_key, tournament_id, status, sdk_token FROM partner_sports_sdk");
    console.log("=== PARTNER SPORTS SDK ===");
    console.dir(sdk, { depth: null });

    const { rows: players } = await pool.query("SELECT tournament_id, count(*) FROM players GROUP BY tournament_id");
    console.log("=== PLAYERS COUNT PER TOURNAMENT ===");
    console.dir(players, { depth: null });

  } catch (err) {
    console.error("Inspect error:", err);
  } finally {
    await pool.end();
  }
}

inspect();
