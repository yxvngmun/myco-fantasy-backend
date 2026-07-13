import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";
import { fetchFromFootballApi } from "../lib/footballApi.js";
import { recognizableName } from "../lib/naming.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEAGUE = 39;   // Premier League
const SEASON = 2023; // 2023/2024 season

const CLUB_COLORS = {
  Arsenal: "#EF0107", "Aston Villa": "#670E36", Bournemouth: "#DA291C", Brentford: "#E30613",
  Brighton: "#0057B8", Burnley: "#6C1D45", Chelsea: "#034694", "Crystal Palace": "#1B458F",
  Everton: "#003399", Fulham: "#000000", Liverpool: "#C8102E", Luton: "#FB4E11",
  "Manchester City": "#6CABDD", "Manchester United": "#DA291C", Newcastle: "#241F20",
  "Nottingham Forest": "#DD0000", "Sheffield Utd": "#EE2737", Tottenham: "#132257",
  "West Ham": "#7A263A", Wolves: "#FDB913",
};

const POS = { Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Attacker: "FWD" };

function hash(n) {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

const PRICE = { GK: [4, 3], DEF: [4, 4], MID: [5, 8], FWD: [5, 9] };
function priceFor(pos, id) {
  const [base, spread] = PRICE[pos] || [5, 5];
  return base + (hash(id) % spread);
}

function fmtDate(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${wd} ${hh}:${mm}`;
}

async function runFallbackSeeding() {
  console.log("⚠️ No API_FOOTBALL_KEY found in .env. Running fallback seeding from static frontend JSON files...");
  
  const frontendDataDir = path.join(__dirname, "..", "..", "..", "..", "fantasy-app-frontend", "src", "data");
  const poolJsonPath = path.join(frontendDataDir, "pool.json");
  const fixturesJsonPath = path.join(frontendDataDir, "fixtures.json");
  
  if (!fs.existsSync(poolJsonPath) || !fs.existsSync(fixturesJsonPath)) {
    throw new Error(`Fallback files not found at:\n${poolJsonPath}\n${fixturesJsonPath}`);
  }
  
  const poolData = JSON.parse(fs.readFileSync(poolJsonPath, "utf8"));
  const fixturesData = JSON.parse(fs.readFileSync(fixturesJsonPath, "utf8"));
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Seed Players
    console.log(`Seeding ${poolData.length} players to database...`);
    for (const p of poolData) {
      await client.query(
        `INSERT INTO players (id, name, club, short, color, jersey_number, pos, val, pts, total_pts, matches, status, opp, fixture_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           club = EXCLUDED.club,
           short = EXCLUDED.short,
           color = EXCLUDED.color,
           jersey_number = EXCLUDED.jersey_number,
           pos = EXCLUDED.pos,
           val = EXCLUDED.val,
           status = EXCLUDED.status,
           opp = EXCLUDED.opp,
           fixture_date = EXCLUDED.fixture_date,
           updated_at = now()`,
        [p.id, p.name, p.club, p.short, p.color, String(p.n ?? ""), p.pos, p.val, p.pts || 0, p.totalPts || 0, p.matches || 0, p.status || "available", p.opp || "", p.date || ""]
      );
    }
    
    // Seed Fixtures
    console.log(`Seeding ${fixturesData.length} fixtures to database...`);
    // Clear old fixtures first
    await client.query("TRUNCATE TABLE fixtures RESTART IDENTITY");
    for (const f of fixturesData) {
      await client.query(
        `INSERT INTO fixtures (round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [f.round, f.date, f.dateLabel, f.home.name, f.home.code, f.home.color, f.away.name, f.away.code, f.away.color, f.status]
      );
    }
    
    await client.query("COMMIT");
    console.log("✅ Fallback seeding completed successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function runLiveSync() {
  console.log("⚽ API_FOOTBALL_KEY detected. Starting live sync from API-Football...");
  
  console.log("Fetching teams...");
  const teamsData = await fetchFromFootballApi(`/teams?league=${LEAGUE}&season=${SEASON}`);
  if (teamsData.errors && Object.keys(teamsData.errors).length) {
    throw new Error("API-Football teams error: " + JSON.stringify(teamsData.errors));
  }
  
  const teamById = {};
  for (const t of teamsData.response) {
    teamById[t.team.id] = {
      name: t.team.name,
      code: t.team.code || t.team.name.slice(0, 3).toUpperCase(),
      color: CLUB_COLORS[t.team.name] || "#555555",
    };
  }

  console.log("Fetching fixtures...");
  const fxData = await fetchFromFootballApi(`/fixtures?league=${LEAGUE}&season=${SEASON}`);
  const fixtureByClub = {};
  const fixturesToInsert = [];
  
  for (const f of fxData.response) {
    const home = teamById[f.teams.home.id];
    const away = teamById[f.teams.away.id];
    
    fixturesToInsert.push({
      round: f.league.round,
      date: f.fixture.date,
      dateLabel: fmtDate(f.fixture.date),
      homeName: f.teams.home.name,
      homeCode: home?.code || "TBD",
      homeColor: home?.color || "#555555",
      awayName: f.teams.away.name,
      awayCode: away?.code || "TBD",
      awayColor: away?.color || "#555555",
      status: f.fixture.status.short,
    });
    
    for (const side of ["home", "away"]) {
      const id = f.teams[side].id;
      if (fixtureByClub[id]) continue;
      const oppId = side === "home" ? f.teams.away.id : f.teams.home.id;
      fixtureByClub[id] = {
        opp: `${teamById[oppId]?.code || "TBD"} (${side === "home" ? "H" : "A"})`,
        date: fmtDate(f.fixture.date)
      };
    }
  }

  console.log("Fetching injuries/suspensions...");
  const injData = await fetchFromFootballApi(`/injuries?league=${LEAGUE}&season=${SEASON}`);
  const statusById = {};
  for (const rec of injData.response || []) {
    const reason = (rec.player.reason || "").toLowerCase();
    statusById[rec.player.id] = reason.includes("suspen") || reason.includes("card") ? "suspended" : "injured";
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Sync Fixtures
    console.log(`Inserting ${fixturesToInsert.length} fixtures...`);
    await client.query("TRUNCATE TABLE fixtures RESTART IDENTITY");
    for (const f of fixturesToInsert) {
      await client.query(
        `INSERT INTO fixtures (round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [f.round, f.date, f.dateLabel, f.homeName, f.homeCode, f.homeColor, f.awayName, f.awayCode, f.awayColor, f.status]
      );
    }

    // Sync Players
    console.log("Fetching and inserting squads for all clubs...");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    
    for (const [teamId, club] of Object.entries(teamById)) {
      console.log(`  Syncing ${club.code} squad...`);
      const sq = await fetchFromFootballApi(`/players/squads?team=${teamId}`);
      const fx = fixtureByClub[teamId] || { opp: "TBD", date: "TBD" };
      const players = sq.response?.[0]?.players || [];
      
      for (const p of players) {
        const pos = POS[p.position];
        if (!pos) continue;
        
        const anonymizedName = recognizableName(p.name.split(" ").pop());
        const val = priceFor(pos, p.id);
        const status = statusById[p.id] || "available";

        await client.query(
          `INSERT INTO players (id, name, club, short, color, jersey_number, pos, val, status, opp, fixture_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             club = EXCLUDED.club,
             short = EXCLUDED.short,
             color = EXCLUDED.color,
             jersey_number = EXCLUDED.jersey_number,
             pos = EXCLUDED.pos,
             val = EXCLUDED.val,
             status = EXCLUDED.status,
             opp = EXCLUDED.opp,
             fixture_date = EXCLUDED.fixture_date,
             updated_at = now()`,
          [p.id, anonymizedName, club.name, club.code, club.color, String(p.number ?? ""), pos, val, status, fx.opp, fx.date]
        );
      }
      
      // Sleep to stay under the free-tier rate limits (~9 calls per minute)
      await sleep(6500);
    }

    await client.query("COMMIT");
    console.log("✅ Live sync from API-Football completed successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function run() {
  try {
    if (!process.env.API_FOOTBALL_KEY) {
      await runFallbackSeeding();
    } else {
      await runLiveSync();
    }
    process.exit(0);
  } catch (err) {
    console.error("❌ Data sync failed:", err.message || err);
    process.exit(1);
  }
}

run();
