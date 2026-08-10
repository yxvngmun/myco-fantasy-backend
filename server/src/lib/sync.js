import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";
import { fetchFromFootballApi } from "./footballApi.js";
import { fetchFromCricketApi } from "./cricketApi.js";
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

// Points calculation helper functions
async function getRulesForTournament(client, tournamentId) {
  const tournRes = await client.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId]);
  const tournament = tournRes.rows[0];
  if (!tournament) throw new Error("Tournament not found: " + tournamentId);
  const sportKey = tournament.sport_key;

  const sportRes = await client.query("SELECT default_scoring FROM sports_config WHERE key = $1", [sportKey]);
  const defaultScoring = sportRes.rows[0]?.default_scoring || [];

  const rules = {};
  const rulesList = (tournament.scoring_rules && tournament.scoring_rules.length > 0)
    ? tournament.scoring_rules
    : defaultScoring;

  for (const r of rulesList) {
    rules[r.event] = Number(r.points);
  }
  return { sportKey, rules };
}

function calculateFootballPoints(stats, pos, rules) {
  let pts = 0;
  
  if (stats.mins >= 60) {
    pts += rules["Playing 60+ mins"] !== undefined ? rules["Playing 60+ mins"] : 2;
  } else if (stats.mins > 0) {
    pts += rules["Playing < 60 mins"] !== undefined ? rules["Playing < 60 mins"] : 1;
  }
  
  if (stats.goals > 0) {
    let goalPoints = 6;
    if (pos === "FWD") goalPoints = rules["Goal (Forward)"] !== undefined ? rules["Goal (Forward)"] : 8;
    else if (pos === "MID") goalPoints = rules["Goal (Midfielder)"] !== undefined ? rules["Goal (Midfielder)"] : 9;
    else if (pos === "DEF") goalPoints = rules["Goal (Defender)"] !== undefined ? rules["Goal (Defender)"] : 10;
    else if (pos === "GK") goalPoints = rules["Goal (Goalkeeper)"] !== undefined ? rules["Goal (Goalkeeper)"] : 12;
    pts += stats.goals * goalPoints;
  }
  
  if (stats.assists > 0) {
    const assistPoints = rules["Assist"] !== undefined ? rules["Assist"] : 5;
    pts += stats.assists * assistPoints;
  }
  
  if (stats.cleanSheet) {
    if (pos === "GK" || pos === "DEF") {
      pts += rules["Clean Sheet (GK/Def)"] !== undefined ? rules["Clean Sheet (GK/Def)"] : 5;
    } else if (pos === "MID") {
      pts += rules["Clean Sheet (Mid)"] !== undefined ? rules["Clean Sheet (Mid)"] : 1;
    }
  }
  
  if (stats.saves >= 3 && pos === "GK") {
    const savesMultiplier = rules["Every 3 Saves (GK)"] !== undefined ? rules["Every 3 Saves (GK)"] : 1;
    pts += Math.floor(stats.saves / 3) * savesMultiplier;
  }
  
  if (stats.yellowCards > 0) {
    pts += stats.yellowCards * (rules["Yellow Card"] !== undefined ? rules["Yellow Card"] : -1);
  }
  if (stats.redCards > 0) {
    pts += stats.redCards * (rules["Red Card"] !== undefined ? rules["Red Card"] : -3);
  }
  
  if (stats.mins > 0 && pts < 1 && stats.redCards === 0) {
    pts = 1;
  }
  
  return pts;
}

function calculateCricketPoints(stats, pos, rules) {
  let pts = 0;
  pts += (stats.runs || 0) * (rules["Per Run"] !== undefined ? rules["Per Run"] : 1);
  if (stats.boundaries) pts += stats.boundaries * (rules["Boundary (4)"] !== undefined ? rules["Boundary (4)"] : 1);
  if (stats.sixes) pts += stats.sixes * (rules["Six"] !== undefined ? rules["Six"] : 2);
  if (stats.runs === 0 && stats.out && (pos === "Batsman" || pos === "All-Rounder" || pos === "Allround")) {
    pts += rules["Duck (Out for 0)"] !== undefined ? rules["Duck (Out for 0)"] : -2;
  }
  if (stats.wickets) pts += stats.wickets * (rules["Wicket (Bowler)"] !== undefined ? rules["Wicket (Bowler)"] : 25);
  if (stats.maidens) pts += stats.maidens * (rules["Maiden Over"] !== undefined ? rules["Maiden Over"] : 8);
  if (stats.catches) pts += stats.catches * (rules["Catch"] !== undefined ? rules["Catch"] : 8);
  if (stats.runOuts) pts += stats.runOuts * (rules["Run Out (Direct)"] !== undefined ? rules["Run Out (Direct)"] : 12);
  if (stats.stumpings) pts += stats.stumpings * (rules["Stumping"] !== undefined ? rules["Stumping"] : 12);
  
  if (stats.runs >= 100) pts += rules["100+ Runs"] !== undefined ? rules["100+ Runs"] : 16;
  else if (stats.runs >= 50) pts += rules["50+ Runs"] !== undefined ? rules["50+ Runs"] : 8;
  else if (stats.runs >= 30) pts += rules["30+ Runs"] !== undefined ? rules["30+ Runs"] : 4;
  
  if (stats.wickets >= 5) pts += rules["5 Wickets"] !== undefined ? rules["5 Wickets"] : 8;
  else if (stats.wickets >= 3) pts += rules["3 Wickets"] !== undefined ? rules["3 Wickets"] : 4;
  
  if (stats.overs >= 2 && stats.economy !== undefined) {
    if (stats.economy < 5) pts += rules["Economy < 5"] !== undefined ? rules["Economy < 5"] : 6;
    else if (stats.economy <= 6) pts += rules["Economy 5-6"] !== undefined ? rules["Economy 5-6"] : 4;
    else if (stats.economy > 10) pts += rules["Economy > 10"] !== undefined ? rules["Economy > 10"] : -2;
  }
  
  return pts;
}

function generateCricketMockStats(playerId, pos, gw, rules) {
  if (gw >= 4) {
    return { gw, runs: 0, wickets: 0, maidens: 0, catches: 0, runOuts: 0, stumpings: 0, overs: 0, economy: 0, pts: 0 };
  }
  const seed = Math.abs(Math.sin(Number(playerId || 1) * 997 + gw * 37) * 10000);
  const intSeed = Math.floor(seed) % 100;
  
  let runs = 0;
  let wickets = 0;
  let maidens = 0;
  let catches = 0;
  let runOuts = 0;
  let stumpings = 0;
  let overs = 0;
  let economy = 6.0;
  let out = false;
  let boundaries = 0;
  let sixes = 0;

  const isBatter = pos === "Batsman" || pos === "All-Rounder" || pos === "Wicket-Keeper" || pos === "Allround" || pos === "WK-Batsman";
  if (isBatter) {
    if (gw === 1) {
      runs = 20 + (intSeed % 35);
      boundaries = Math.floor(runs / 8);
      sixes = Math.floor(runs / 15);
      out = true;
    } else if (gw === 2) {
      runs = 5 + (intSeed % 15);
      boundaries = Math.floor(runs / 8);
      out = true;
    } else if (gw === 3) {
      if (intSeed < 10) {
        runs = 0;
        out = true;
      } else {
        runs = 35 + (intSeed % 70);
        boundaries = Math.floor(runs / 6);
        sixes = Math.floor(runs / 12);
        out = intSeed % 2 === 0;
      }
    }
  }

  const isBowler = pos === "Bowler" || pos === "All-Rounder" || pos === "Allround";
  if (isBowler) {
    overs = 4;
    if (gw === 1) {
      wickets = intSeed % 3;
      maidens = intSeed > 80 ? 1 : 0;
      economy = 5.0 + (intSeed % 5);
    } else if (gw === 2) {
      wickets = intSeed > 70 ? 2 : 1;
      economy = 7.0 + (intSeed % 4);
    } else if (gw === 3) {
      wickets = intSeed > 85 ? 5 : (intSeed > 50 ? 3 : 1);
      maidens = intSeed > 60 ? 1 : 0;
      economy = 4.0 + (intSeed % 3);
    }
  }

  if (pos === "Wicket-Keeper" || pos === "WK-Batsman") {
    catches = intSeed % 2;
    stumpings = intSeed > 70 ? 1 : 0;
  } else {
    catches = intSeed > 80 ? 1 : 0;
    runOuts = intSeed > 90 ? 1 : 0;
  }

  const pts = calculateCricketPoints({ runs, wickets, maidens, catches, runOuts, stumpings, overs, economy, out, boundaries, sixes }, pos, rules);
  return { gw, runs, wickets, maidens, catches, runOuts, stumpings, overs, economy, pts };
}

function generateFootballMockStats(playerId, pos, gw, rules) {
  if (gw >= 4) {
    return { gw, mins: 0, goals: 0, assists: 0, cleanSheet: false, yellowCards: 0, redCards: 0, saves: 0, pts: 0 };
  }
  const seed = Math.abs(Math.sin(Number(playerId || 1) * 997 + gw * 37) * 10000);
  const intSeed = Math.floor(seed) % 100;

  let mins = 90;
  if (intSeed < 10) mins = 0;
  else if (intSeed < 25) mins = 20 + ((intSeed * 3) % 41);
  else mins = 70 + ((intSeed * 2) % 21);

  let goals = 0;
  let assists = 0;
  let cleanSheet = false;
  let yellowCards = 0;
  let redCards = 0;
  let saves = 0;

  if (mins > 0) {
    if (pos === "FWD") {
      if (intSeed > 75) goals = 1;
      if (intSeed > 88) goals = 2;
      if (intSeed > 97) goals = 3;
      if ((intSeed + 17) % 100 > 70) assists = 1;
    } else if (pos === "MID") {
      if (intSeed > 80) goals = 1;
      if (intSeed > 94) goals = 2;
      if ((intSeed + 13) % 100 > 65) assists = 1;
      if ((intSeed + 13) % 100 > 92) assists = 2;
      if (mins >= 60 && intSeed % 100 > 60) cleanSheet = true;
    } else if (pos === "DEF") {
      if (intSeed > 90) goals = 1;
      if ((intSeed + 7) % 100 > 80) assists = 1;
      if (mins >= 60 && intSeed % 100 > 45) cleanSheet = true;
    } else if (pos === "GK") {
      if (mins >= 60 && intSeed % 100 > 45) cleanSheet = true;
      saves = 2 + (intSeed % 6);
    }

    if ((intSeed * 3) % 100 > 86) yellowCards = 1;
    if ((intSeed * 7) % 100 > 97) redCards = 1;
  }

  const pts = calculateFootballPoints({ mins, goals, assists, cleanSheet, yellowCards, redCards, saves }, pos, rules);
  return { gw, mins, goals, assists, cleanSheet, yellowCards, redCards, saves, pts };
}

function getStatsBreakdown(sportKey, playerId, pos, rules) {
  const breakdown = [];
  if (sportKey === "cricket") {
    for (let gw = 1; gw <= 4; gw++) {
      breakdown.push(generateCricketMockStats(playerId, pos, gw, rules));
    }
  } else {
    for (let gw = 1; gw <= 4; gw++) {
      breakdown.push(generateFootballMockStats(playerId, pos, gw, rules));
    }
  }
  return JSON.stringify(breakdown);
}

export async function syncTournamentData(tournamentId, leagueId, season) {
  console.log(`[Sync] Starting sync for Tournament ${tournamentId} (League: ${leagueId}, Season: ${season})`);

  const client = await pool.connect();
  let sportKey = "football";
  try {
    const { sportKey: dbSportKey } = await getRulesForTournament(client, tournamentId);
    sportKey = dbSportKey;
  } finally {
    client.release();
  }

  if (sportKey === "cricket") {
    try {
      console.log("[Sync] Running cricket sync...");
      await runCricketLiveSync(tournamentId, leagueId, season);
    } catch (e) {
      console.warn("[Sync] Live cricket sync failed, using fallback cricket roster:", e.message);
      await runCricketFallbackSeeding(tournamentId);
    }
  } else {
    if (!process.env.API_FOOTBALL_KEY) {
      console.log("[Sync] No API_FOOTBALL_KEY found. Running fallback static seeding...");
      await runFallbackSeeding(tournamentId);
    } else {
      console.log("[Sync] API_FOOTBALL_KEY detected. Running live football sync...");
      await runLiveSync(tournamentId, leagueId, season);
    }
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
    
    const { sportKey, rules } = await getRulesForTournament(client, tournamentId);

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
      const statsBreakdown = getStatsBreakdown(sportKey, p.id, pos, rules);
      const parsedBreakdown = JSON.parse(statsBreakdown);
      const totalPts = parsedBreakdown.reduce((sum, row) => sum + row.pts, 0);
      const latestPts = parsedBreakdown.filter(row => row.mins !== undefined ? (row.mins > 0 || (row.gw < 4 && row.pts > 0)) : (row.runs > 0 || row.wickets > 0 || (row.gw < 4 && row.pts > 0))).pop()?.pts || 0;
      const matches = parsedBreakdown.filter((b) => (b.mins !== undefined ? b.mins > 0 : b.runs > 0 || b.wickets > 0)).length;

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
           pts = EXCLUDED.pts,
           total_pts = EXCLUDED.total_pts,
           matches = EXCLUDED.matches,
           status = EXCLUDED.status,
           opp = EXCLUDED.opp,
           fixture_date = EXCLUDED.fixture_date,
           stats_breakdown = EXCLUDED.stats_breakdown,
           price_history = EXCLUDED.price_history,
           updated_at = now()`,
        [tournamentId, p.id, p.name, p.club, p.short, p.color, String(p.n ?? ""), p.pos, p.val, latestPts, totalPts, matches, p.status || "available", p.opp || "", p.date || "", statsBreakdown, priceHistory]
      );
    }
    
    // Seed Fixtures for this tournament
    console.log(`[Sync] Seeding ${fixturesData.length} fixtures for tournament ${tournamentId}...`);
    for (const f of fixturesData) {
      await client.query(
        `INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (tournament_id, round, home_name, away_name) DO UPDATE SET
           event_date = EXCLUDED.event_date,
           date_label = EXCLUDED.date_label,
           home_code = EXCLUDED.home_code,
           home_color = EXCLUDED.home_color,
           away_code = EXCLUDED.away_code,
           away_color = EXCLUDED.away_color,
           status = EXCLUDED.status`,
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
    
    const { sportKey, rules } = await getRulesForTournament(client, tournamentId);

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
        const statsBreakdown = getStatsBreakdown(sportKey, p.id, pos, rules);
        const parsedBreakdown = JSON.parse(statsBreakdown);
        const totalPts = parsedBreakdown.reduce((sum, row) => sum + row.pts, 0);
        const latestPts = parsedBreakdown.filter(row => row.mins !== undefined ? (row.mins > 0 || (row.gw < 4 && row.pts > 0)) : (row.runs > 0 || row.wickets > 0 || (row.gw < 4 && row.pts > 0))).pop()?.pts || 0;
        const matches = parsedBreakdown.filter((b) => (b.mins !== undefined ? b.mins > 0 : b.runs > 0 || b.wickets > 0)).length;

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
             pts = EXCLUDED.pts,
             total_pts = EXCLUDED.total_pts,
             matches = EXCLUDED.matches,
             status = EXCLUDED.status,
             opp = EXCLUDED.opp,
             fixture_date = EXCLUDED.fixture_date,
             stats_breakdown = EXCLUDED.stats_breakdown,
             price_history = EXCLUDED.price_history,
             updated_at = now()`,
          [tournamentId, p.id, anonymizedName, club.name, club.code, club.color, String(p.number ?? ""), pos, val, latestPts, totalPts, matches, status, fx.opp, fx.date, statsBreakdown, priceHistory]
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


async function runCricketLiveSync(tournamentId, leagueId, season) {
  console.log('[Sync] Fetching cricket series for tournament ' + tournamentId);
  const sourceMap = { 
    ipl: '87c62aac-bc3c-4738-ab93-19da0690488f', 
    t20_wc: '5021ebc1-c2a3-419d-9883-cb641c05fe72',
    50: '87c62aac-bc3c-4738-ab93-19da0690488f',
    '50': '87c62aac-bc3c-4738-ab93-19da0690488f',
    51: '5021ebc1-c2a3-419d-9883-cb641c05fe72',
    '51': '5021ebc1-c2a3-419d-9883-cb641c05fe72'
  };
  const seriesId = sourceMap[leagueId] || '87c62aac-bc3c-4738-ab93-19da0690488f';

  const infoData = await fetchFromCricketApi('/series_info?id=' + seriesId);
  const squadData = await fetchFromCricketApi('/series_squad?id=' + seriesId);

  const matchList = infoData.data?.matchList || [];
  const squads = squadData.data || [];

  console.log('[Sync] Found ' + matchList.length + ' matches and ' + squads.length + ' teams in squad data.');

  const fixturesToInsert = [];
  const playersToInsert = [];
  const teamById = {};

  for (const s of squads) {
    const tName = s.teamName;
    const tCode = tName.slice(0, 3).toUpperCase();
    teamById[tName] = tCode;
    if (s.players) {
      for (const p of s.players) {
        const pos = p.role ? p.role : 'Batsman';
        let numId = 0;
        if (typeof p.id === 'string') {
          for (let i = 0; i < p.id.length; i++) {
            numId = ((numId << 5) - numId) + p.id.charCodeAt(i);
            numId |= 0;
          }
          numId = Math.abs(numId);
        } else {
          numId = Number(p.id);
        }
        playersToInsert.push({
          id: numId,
          name: p.name,
          club: tName,
          short: p.name.split(' ').slice(-1)[0],
          pos: pos === 'Wicketkeeper' ? 'Wicket-Keeper' : pos,
          val: 5.0 + (numId % 5),
        });
      }
    }
  }

  for (const f of matchList) {
    const t1 = f.teams[0];
    const t2 = f.teams[1];
    fixturesToInsert.push({
      round: f.name.split(',')[1]?.trim() || f.name,
      date: f.date,
      dateLabel: fmtDate(f.dateTimeGMT),
      homeName: t1,
      homeCode: teamById[t1] || t1.slice(0, 3).toUpperCase(),
      homeColor: '#00E676',
      awayName: t2,
      awayCode: teamById[t2] || t2.slice(0, 3).toUpperCase(),
      awayColor: '#FF5252',
      status: f.status,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { sportKey, rules } = await getRulesForTournament(client, tournamentId);

    for (const f of fixturesToInsert) {
      await client.query(
        'INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [tournamentId, f.round, f.date, f.dateLabel, f.homeName, f.homeCode, f.homeColor, f.awayName, f.awayCode, f.awayColor, f.status]
      );
    }

    for (const p of playersToInsert) {
      const val = Number(p.val || 5.0);
      const priceHistory = JSON.stringify([Number((val - 0.2).toFixed(1)), Number((val - 0.1).toFixed(1)), Number(val.toFixed(1))]);
      const statsBreakdown = getStatsBreakdown(sportKey, p.id, p.pos, rules);
      const parsedBreakdown = JSON.parse(statsBreakdown);
      const totalPts = parsedBreakdown.reduce((sum, row) => sum + row.pts, 0);
      const latestPts = parsedBreakdown.filter(row => row.runs > 0 || row.wickets > 0 || (row.gw < 4 && row.pts > 0)).pop()?.pts || 0;
      const matches = parsedBreakdown.filter(b => b.runs > 0 || b.wickets > 0).length;

      await client.query(
        'INSERT INTO players (tournament_id, id, name, club, short, color, jersey_number, pos, val, pts, total_pts, matches, status, opp, fixture_date, stats_breakdown, price_history) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT (tournament_id, id) DO UPDATE SET name = EXCLUDED.name, club = EXCLUDED.club, short = EXCLUDED.short, pos = EXCLUDED.pos, val = EXCLUDED.val, pts = EXCLUDED.pts, total_pts = EXCLUDED.total_pts, matches = EXCLUDED.matches, stats_breakdown = EXCLUDED.stats_breakdown, price_history = EXCLUDED.price_history, updated_at = now()',
        [tournamentId, p.id, p.name, p.club, p.short, '#555555', '', p.pos, p.val, latestPts, totalPts, matches, 'available', '', '', statsBreakdown, priceHistory]
      );
    }

    await client.query('COMMIT');
    console.log('[Sync] Cricket live sync completed successfully for Tournament ' + tournamentId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function runCricketFallbackSeeding(tournamentId) {
  const cricketPlayers = [
    { id: 1001, name: "Virat Kohli", club: "RCB", short: "Kohli", pos: "Batsman", val: 10.5 },
    { id: 1002, name: "Rohit Sharma", club: "MI", short: "Sharma", pos: "Batsman", val: 10.0 },
    { id: 1003, name: "Jasprit Bumrah", club: "MI", short: "Bumrah", pos: "Bowler", val: 9.5 },
    { id: 1004, name: "Rashid Khan", club: "GT", short: "Rashid", pos: "Bowler", val: 9.0 },
    { id: 1005, name: "Hardik Pandya", club: "MI", short: "Pandya", pos: "All-Rounder", val: 8.5 },
    { id: 1006, name: "KL Rahul", club: "LSG", short: "Rahul", pos: "Wicket-Keeper", val: 9.0 },
    { id: 1007, name: "Rishabh Pant", club: "DC", short: "Pant", pos: "Wicket-Keeper", val: 8.5 },
    { id: 1008, name: "Suryakumar Yadav", club: "MI", short: "SKY", pos: "Batsman", val: 9.5 },
    { id: 1009, name: "Shubman Gill", club: "GT", short: "Gill", pos: "Batsman", val: 9.0 },
    { id: 1010, name: "Ravindra Jadeja", club: "CSK", short: "Jadeja", pos: "All-Rounder", val: 8.5 },
    { id: 1011, name: "Mohammed Shami", club: "GT", short: "Shami", pos: "Bowler", val: 8.5 },
    { id: 1012, name: "Yuzvendra Chahal", club: "RR", short: "Chahal", pos: "Bowler", val: 8.0 },
    { id: 1013, name: "Jos Buttler", club: "RR", short: "Buttler", pos: "Wicket-Keeper", val: 10.0 },
    { id: 1014, name: "Glenn Maxwell", club: "RCB", short: "Maxwell", pos: "All-Rounder", val: 8.5 },
    { id: 1015, name: "Trent Boult", club: "RR", short: "Boult", pos: "Bowler", val: 8.5 },
    { id: 1016, name: "Sanju Samson", club: "RR", short: "Samson", pos: "Wicket-Keeper", val: 8.5 },
    { id: 1017, name: "Rinku Singh", club: "KKR", short: "Rinku", pos: "Batsman", val: 7.5 },
    { id: 1018, name: "Yashasvi Jaiswal", club: "RR", short: "Jaiswal", pos: "Batsman", val: 8.5 },
    { id: 1019, name: "Axar Patel", club: "DC", short: "Axar", pos: "All-Rounder", val: 8.0 },
    { id: 1020, name: "Arshdeep Singh", club: "PBKS", short: "Arshdeep", pos: "Bowler", val: 8.0 },
    { id: 1021, name: "Babar Azam", club: "PZ", short: "Babar", pos: "Batsman", val: 9.5 },
    { id: 1022, name: "Shaheen Afridi", club: "LQ", short: "Shaheen", pos: "Bowler", val: 9.0 },
    { id: 1023, name: "Mohammad Rizwan", club: "MS", short: "Rizwan", pos: "Wicket-Keeper", val: 9.0 },
    { id: 1024, name: "Shadab Khan", club: "ISLU", short: "Shadab", pos: "All-Rounder", val: 8.5 }
  ];

  const cricketFixtures = [
    { round: "Match 1", date: "2026-08-10", dateLabel: "10 Aug 2026", homeName: "India", homeCode: "IND", homeColor: "#00E676", awayName: "Pakistan", awayCode: "PAK", awayColor: "#FF5252", status: "NS" },
    { round: "Match 2", date: "2026-08-12", dateLabel: "12 Aug 2026", homeName: "Australia", homeCode: "AUS", homeColor: "#FFD700", awayName: "England", awayCode: "ENG", awayColor: "#1E88E5", status: "NS" },
    { round: "Match 3", date: "2026-08-15", dateLabel: "15 Aug 2026", homeName: "South Africa", homeCode: "SA", homeColor: "#4CAF50", awayName: "New Zealand", awayCode: "NZ", awayColor: "#212121", status: "NS" }
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const f of cricketFixtures) {
      await client.query(
        `INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (tournament_id, round, home_name, away_name) DO NOTHING`,
        [tournamentId, f.round, f.date, f.dateLabel, f.homeName, f.homeCode, f.homeColor, f.awayName, f.awayCode, f.awayColor, f.status]
      );
    }

    for (const p of cricketPlayers) {
      const breakdown = JSON.stringify([
        { gw: 1, runs: 45, wickets: p.pos === "Bowler" ? 2 : 0, maidens: 0, catches: 1, runOuts: 0, stumpings: 0, overs: 4, economy: 6.5, pts: 65 },
        { gw: 2, runs: 28, wickets: p.pos === "Bowler" ? 1 : 0, maidens: 0, catches: 0, runOuts: 0, stumpings: 0, overs: 4, economy: 7.2, pts: 38 },
        { gw: 3, runs: 72, wickets: p.pos === "Bowler" ? 3 : 0, maidens: 1, catches: 2, runOuts: 0, stumpings: 0, overs: 4, economy: 5.0, pts: 110 }
      ]);
      const priceHistory = JSON.stringify([p.val - 0.2, p.val - 0.1, p.val]);

      await client.query(
        `INSERT INTO players (tournament_id, id, name, club, short, color, jersey_number, pos, val, pts, total_pts, matches, status, opp, fixture_date, stats_breakdown, price_history)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (tournament_id, id) DO UPDATE SET
           name = EXCLUDED.name, club = EXCLUDED.club, pos = EXCLUDED.pos, val = EXCLUDED.val, pts = EXCLUDED.pts, total_pts = EXCLUDED.total_pts, updated_at = now()`,
        [tournamentId, p.id, p.name, p.club, p.short, "#00E676", "18", p.pos, p.val, 65, 213, 3, "available", "PAK (H)", "10 Aug 2026", breakdown, priceHistory]
      );
    }

    await client.query("COMMIT");
    console.log("[Sync] Cricket fallback seeding completed for tournament " + tournamentId);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Sync] Cricket fallback error:", err);
  } finally {
    client.release();
  }
}
