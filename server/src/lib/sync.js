import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";
import { fetchFromFootballApi } from "./footballApi.js";
import { recognizableName } from "./naming.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export async function syncTournamentData(tournamentId, leagueId, season) {
  console.log(`[Sync] Starting sync for Tournament ${tournamentId} (League: ${leagueId}, Season: ${season})`);

  if (!process.env.API_FOOTBALL_KEY) {
    console.log("[Sync] No API_FOOTBALL_KEY found. Running fallback static seeding...");
    await runFallbackSeeding(tournamentId);
  } else {
    console.log("[Sync] API_FOOTBALL_KEY detected. Running live sync...");
    await runLiveSync(tournamentId, leagueId, season);
  }
}

async function runFallbackSeeding(tournamentId) {
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
    
    // Seed Players for this tournament
    console.log(`[Sync] Seeding ${poolData.length} players for tournament ${tournamentId}...`);
    for (const p of poolData) {
      const val = Number(p.val || 5.0);
      const priceHistory = JSON.stringify([
        Number((val - 0.2).toFixed(1)),
        Number((val - 0.1).toFixed(1)),
        Number(val.toFixed(1))
      ]);
      const pos = p.pos || "MID";
      const pts1 = pos === "GK" || pos === "DEF" ? 6 : pos === "FWD" ? 4 : 3;
      const pts2 = pos === "FWD" ? 6 : pos === "MID" ? 5 : 2;
      const pts3 = 2;
      const pts4 = p.pts || 3;
      const statsBreakdown = JSON.stringify([
        { gw: 1, mins: 90, goals: pos === "FWD" ? 1 : 0, assists: pos === "MID" ? 1 : 0, cleanSheet: pos === "DEF" || pos === "GK", yellowCards: 0, redCards: 0, pts: pts1 },
        { gw: 2, mins: 90, goals: pos === "MID" ? 1 : 0, assists: 0, cleanSheet: false, yellowCards: 1, redCards: 0, pts: pts2 },
        { gw: 3, mins: 75, goals: 0, assists: 0, cleanSheet: pos === "DEF" || pos === "GK", yellowCards: 0, redCards: 0, pts: pts3 },
        { gw: 4, mins: 90, goals: pos === "FWD" ? 1 : 0, assists: pos === "MID" || pos === "FWD" ? 1 : 0, cleanSheet: false, yellowCards: 0, redCards: 0, pts: pts4 }
      ]);

      await client.query(
        `INSERT INTO players (tournament_id, id, name, club, short, color, jersey_number, pos, val, pts, total_pts, matches, status, opp, fixture_date, stats_breakdown, price_history)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (tournament_id, id) DO UPDATE SET
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
           stats_breakdown = EXCLUDED.stats_breakdown,
           price_history = EXCLUDED.price_history,
           updated_at = now()`,
        [tournamentId, p.id, p.name, p.club, p.short, p.color, String(p.n ?? ""), p.pos, p.val, p.pts || 0, p.totalPts || 0, p.matches || 0, p.status || "available", p.opp || "", p.date || "", statsBreakdown, priceHistory]
      );
    }
    
    // Seed Fixtures for this tournament
    console.log(`[Sync] Seeding ${fixturesData.length} fixtures for tournament ${tournamentId}...`);
    for (const f of fixturesData) {
      await client.query(
        `INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [tournamentId, f.round, f.date, f.dateLabel, f.home.name, f.home.code, f.home.color, f.away.name, f.away.code, f.away.color, f.status]
      );
    }
    
    await client.query("COMMIT");
    console.log(`[Sync] Fallback seeding for Tournament ${tournamentId} completed successfully!`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function runLiveSync(tournamentId, leagueId, season) {
  console.log(`[Sync] Fetching teams for league ${leagueId}, season ${season}...`);
  const teamsData = await fetchFromFootballApi(`/teams?league=${leagueId}&season=${season}`);
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

  console.log(`[Sync] Fetching fixtures for league ${leagueId}, season ${season}...`);
  const fxData = await fetchFromFootballApi(`/fixtures?league=${leagueId}&season=${season}`);
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

  console.log(`[Sync] Fetching injuries for league ${leagueId}, season ${season}...`);
  const injData = await fetchFromFootballApi(`/injuries?league=${leagueId}&season=${season}`);
  const statusById = {};
  for (const rec of injData.response || []) {
    const reason = (rec.player.reason || "").toLowerCase();
    statusById[rec.player.id] = reason.includes("suspen") || reason.includes("card") ? "suspended" : "injured";
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Sync Fixtures
    console.log(`[Sync] Inserting ${fixturesToInsert.length} fixtures for tournament ${tournamentId}...`);
    for (const f of fixturesToInsert) {
      await client.query(
        `INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [tournamentId, f.round, f.date, f.dateLabel, f.homeName, f.homeCode, f.homeColor, f.awayName, f.awayCode, f.awayColor, f.status]
      );
    }

    // Sync Players
    console.log(`[Sync] Fetching and inserting squads for ${Object.keys(teamById).length} clubs...`);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    
    for (const [teamId, club] of Object.entries(teamById)) {
      console.log(`  Syncing ${club.code} squad...`);
      const sq = await fetchFromFootballApi(`/players/squads?team=${teamId}`);
      const fx = fixtureByClub[teamId] || { opp: "TBD", date: "TBD" };
      const players = sq.response?.[0]?.players || [];
      
      for (const p of players) {
        const pos = POS[p.position];
        if (!pos) continue;
        
        // Pass through recognizableName vowel-twisting parser to tackle copyright issues
        const anonymizedName = recognizableName(p.name.split(" ").pop());
        const val = priceFor(pos, p.id);
        const status = statusById[p.id] || "available";

        const priceHistory = JSON.stringify([
          Number((val - 0.2).toFixed(1)),
          Number((val - 0.1).toFixed(1)),
          Number(val.toFixed(1))
        ]);
        const pts1 = pos === "GK" || pos === "DEF" ? 6 : pos === "FWD" ? 4 : 3;
        const pts2 = pos === "FWD" ? 6 : pos === "MID" ? 5 : 2;
        const pts3 = 2;
        const pts4 = 3;
        const statsBreakdown = JSON.stringify([
          { gw: 1, mins: 90, goals: pos === "FWD" ? 1 : 0, assists: pos === "MID" ? 1 : 0, cleanSheet: pos === "DEF" || pos === "GK", yellowCards: 0, redCards: 0, pts: pts1 },
          { gw: 2, mins: 90, goals: pos === "MID" ? 1 : 0, assists: 0, cleanSheet: false, yellowCards: 1, redCards: 0, pts: pts2 },
          { gw: 3, mins: 75, goals: 0, assists: 0, cleanSheet: pos === "DEF" || pos === "GK", yellowCards: 0, redCards: 0, pts: pts3 },
          { gw: 4, mins: 90, goals: pos === "FWD" ? 1 : 0, assists: pos === "MID" || pos === "FWD" ? 1 : 0, cleanSheet: false, yellowCards: 0, redCards: 0, pts: pts4 }
        ]);

        await client.query(
          `INSERT INTO players (tournament_id, id, name, club, short, color, jersey_number, pos, val, status, opp, fixture_date, stats_breakdown, price_history)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (tournament_id, id) DO UPDATE SET
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
             stats_breakdown = EXCLUDED.stats_breakdown,
             price_history = EXCLUDED.price_history,
             updated_at = now()`,
          [tournamentId, p.id, anonymizedName, club.name, club.code, club.color, String(p.number ?? ""), pos, val, status, fx.opp, fx.date, statsBreakdown, priceHistory]
        );
      }
      
      // Rate-limiting throttle
      await sleep(6500);
    }

    await client.query("COMMIT");
    console.log(`[Sync] Live sync for tournament ${tournamentId} completed successfully!`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
