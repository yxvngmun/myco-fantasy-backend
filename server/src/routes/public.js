import { Router } from "express";
import { pool } from "../db.js";
import { requirePartnerAuth, requireUserAuth } from "../middleware/requirePartnerAuth.js";

const router = Router();

// All public routes require partner tenant verification (via subdomain)
router.use(requirePartnerAuth);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolvePosName(playerPos, sportConfig) {
  if (!sportConfig || sportConfig.key === "football") return playerPos;
  
  const pLower = (playerPos || "").toLowerCase().trim();
  
  const exactMatch = sportConfig.positions?.find(p => p.name.toLowerCase() === pLower);
  if (exactMatch) return exactMatch.name;

  const match = sportConfig.positions?.find(p => {
    const configName = p.name.toLowerCase();
    const configNorm = configName.replace(/[^a-z]/g, "");
    const pNorm = pLower.replace(/[^a-z]/g, "");

    if (configNorm && pNorm && (pNorm.includes(configNorm) || configNorm.includes(pNorm))) return true;
    
    // Cricket specific heuristics & abbreviations
    if (configName.includes("all") || configName === "ar") {
      if (pLower === "ar" || pLower.includes("allrounder") || pLower.includes("all-rounder") || pLower.includes("all rounder")) return true;
    }
    if (configName.includes("wicket") || configName === "wk") {
      if (pLower === "wk" || pLower.includes("wk") || pLower.includes("keeper")) return true;
    }
    if (configName.includes("bat") || configName === "bat") {
      if ((pLower === "bat" || pLower.includes("bat")) && !pLower.includes("wk") && !pLower.includes("all")) return true;
    }
    if (configName.includes("bowl") || configName === "bowl") {
      if (pLower === "bowl" || pLower.includes("bowl")) return true;
    }
    
    return false;
  });

  return match ? match.name : playerPos;
}

// Middleware to verify that the requested tournament (and its associated sport config) are active
router.use(async (req, res, next) => {
  // Only apply to routes that take tournament parameter and are not the config/status/list routes
  if (
    req.path === "/sdk-status" || 
    req.path === "/tournaments/configure" || 
    req.path === "/tournaments"
  ) {
    return next();
  }

  const tournamentId = req.query.tournament || req.body.tournamentId || req.body.tournament;
  if (!tournamentId) {
    return next();
  }

  if (!UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "Invalid tournament ID format" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT t.status as tourn_status, s.status as sport_status 
       FROM tournaments t 
       JOIN sports_config s ON t.sport_key = s.key 
       WHERE t.id = $1`,
      [tournamentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Tournament or sport configuration not found" });
    }

    const { tourn_status, sport_status } = rows[0];
    if (tourn_status !== "Active") {
      return res.status(403).json({ error: `Tournament is not currently active` });
    }

    if (sport_status !== "Active") {
      return res.status(403).json({ error: `The sport for this tournament is currently inactive` });
    }

    next();
  } catch (err) {
    console.error("Tournament verification middleware error:", err.message);
    res.status(500).json({ error: "Failed to verify tournament status" });
  }
});

// Deterministically generate randomized matchday metrics (goals, assists, mins, clean sheets, cards, saves)
function generatePlayerGameweekStats(playerId, pos, gameweek) {
  // Round 4 (and beyond) has not started yet — return 0 points and 0 minutes
  if (gameweek >= 4) {
    return {
      gw: gameweek,
      mins: 0,
      goals: 0,
      assists: 0,
      cleanSheet: false,
      yellowCards: 0,
      redCards: 0,
      saves: 0,
      pts: 0,
    };
  }

  const seed = Math.abs(Math.sin(Number(playerId || 1) * 997 + gameweek * 37) * 10000);
  const intSeed = Math.floor(seed) % 100;

  // Minutes: 10% unplayed (0 mins), 15% sub (20-60 mins), 75% starter (70-90 mins)
  let mins = 90;
  if (intSeed < 10) {
    mins = 0; // Did not play (0 mins) -> candidate for bench auto-substitution
  } else if (intSeed < 25) {
    mins = 20 + ((intSeed * 3) % 41);
  } else {
    mins = 70 + ((intSeed * 2) % 21);
  }

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
      if (intSeed > 97) goals = 3; // Hat-trick
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

  // Calculate Fantasy Points
  let pts = 0;
  if (mins >= 60) pts += 2;
  else if (mins > 0) pts += 1;

  pts += goals * 6;
  pts += assists * 3;
  if (cleanSheet) {
    if (pos === "GK" || pos === "DEF") pts += 4;
    if (pos === "MID") pts += 1;
  }
  if (saves >= 3) pts += Math.floor(saves / 3);

  pts -= yellowCards * 1;
  pts -= redCards * 3;

  if (mins > 0 && pts < 1 && redCards === 0) {
    pts = 1;
  }

  return {
    gw: gameweek,
    mins,
    goals,
    assists,
    cleanSheet,
    yellowCards,
    redCards,
    saves,
    pts,
  };
}

// Ensures the starting 11 (first 11 elements) has EXACTLY 1 Goalkeeper
function ensureValidStartingXI(playersList) {
  if (!Array.isArray(playersList) || playersList.length < 11) return playersList;

  const starters = [...playersList.slice(0, 11)];
  const bench = [...playersList.slice(11)];

  const gkIndexesInStarters = starters
    .map((p, idx) => (p && p.pos === "GK" ? idx : -1))
    .filter((idx) => idx !== -1);

  if (gkIndexesInStarters.length === 0) {
    // Swap first GK found on bench into 11th starter slot
    const benchGkIdx = bench.findIndex((p) => p && p.pos === "GK");
    if (benchGkIdx !== -1) {
      const gk = bench[benchGkIdx];
      const outfield = starters[10];
      starters[10] = gk;
      bench[benchGkIdx] = outfield;
    }
  } else if (gkIndexesInStarters.length > 1) {
    // Keep 1 GK in starters, swap extra GK with an outfield player on bench
    const extraGkIdx = gkIndexesInStarters[1];
    const benchOutfieldIdx = bench.findIndex((p) => p && p.pos !== "GK");
    if (benchOutfieldIdx !== -1) {
      const extraGk = starters[extraGkIdx];
      const benchOutfield = bench[benchOutfieldIdx];
      starters[extraGkIdx] = benchOutfield;
      bench[benchOutfieldIdx] = extraGk;
    }
  }

  return [...starters, ...bench];
}

// Helper: Maps database player row to frontend pool.json format
function serializePlayer(p) {
  const breakdown = (p.stats_breakdown && p.stats_breakdown.length > 0)
    ? p.stats_breakdown
    : [1, 2, 3, 4].map((gw) => generatePlayerGameweekStats(p.id, p.pos, gw));

  const totalPoints = breakdown.reduce((sum, row) => sum + row.pts, 0);

  // Filter completed/played gameweeks (GW1-3) to find latest played points
  const playedRows = breakdown.filter((b) => b.mins > 0 || (b.gw < 4 && b.pts > 0));
  const latestPlayed = playedRows[playedRows.length - 1];

  return {
    id: p.id,
    name: p.name,
    club: p.club,
    short: p.short,
    color: p.color,
    n: p.jersey_number ? Number(p.jersey_number) || p.jersey_number : "",
    pos: p.pos,
    val: Number(p.val),
    pts: latestPlayed ? latestPlayed.pts : 0,
    totalPts: totalPoints || p.total_pts || 0,
    matches: breakdown.filter((b) => b.mins > 0).length,
    status: p.status,
    opp: p.opp,
    date: p.fixture_date,
    ownership: Number(p.ownership_percent || 0),
    statsBreakdown: breakdown,
    priceHistory: p.price_history || [],
  };
}

// XSS Sanitization helper for user inputs (e.g. teamName)
function sanitizeInput(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/<[^>]*>?/gm, "")
    .replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;"
    }[m]))
    .trim();
}

// 1. Get Players catalog
router.get("/players", async (req, res) => {
  const tournamentId = req.query.tournament;
  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT 
         p.*,
         COALESCE(
           (SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM user_squads WHERE tournament_id = p.tournament_id), 0) * 100
            FROM user_squads 
            WHERE tournament_id = p.tournament_id AND player_ids @> JSONB_BUILD_ARRAY(p.id)), 
           0
         )::numeric(5,1) AS ownership_percent
       FROM players p 
       WHERE p.tournament_id = $1 
       ORDER BY p.val DESC`,
      [tournamentId]
    );
    res.json(rows.map(serializePlayer));
  } catch (err) {
    console.error("GET /players failed:", err.message);
    res.status(500).json({ error: "Failed to load players" });
  }
});

// Deterministic fixture scores for completed matchdays 1, 2, 3
function getDeterministicFixtureScore(homeCode, awayCode, roundStr) {
  const roundNum = parseInt(roundStr.replace(/\D/g, "")) || 1;
  if (roundNum >= 4) {
    return { status: "NS", homeScore: null, awayScore: null };
  }
  const seed = (homeCode.charCodeAt(0) * 13 + awayCode.charCodeAt(0) * 17 + roundNum * 31) % 100;
  const homeScore = (seed + roundNum * 3) % 4;
  const awayScore = (seed + roundNum * 7) % 3;
  return { status: "FT", homeScore, awayScore };
}

// 2. Get Fixtures schedule
router.get("/fixtures", async (req, res) => {
  const tournamentId = req.query.tournament;
  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM fixtures WHERE tournament_id = $1 ORDER BY event_date ASC", [tournamentId]);
    res.json(
      rows.map((f) => {
        const roundNum = parseInt(String(f.round).replace(/\D/g, "")) || 1;
        const scoreInfo = getDeterministicFixtureScore(f.home_code, f.away_code, String(f.round));
        return {
          round: f.round,
          date: f.event_date.toISOString(),
          dateLabel: roundNum >= 4 ? "31 July 19:00" : f.date_label,
          home: { name: f.home_name, code: f.home_code, color: f.home_color },
          away: { name: f.away_name, code: f.away_code, color: f.away_color },
          status: scoreInfo.status,
          homeScore: scoreInfo.homeScore,
          awayScore: scoreInfo.awayScore,
        };
      })
    );
  } catch (err) {
    console.error("GET /fixtures failed:", err.message);
    res.status(500).json({ error: "Failed to load fixtures" });
  }
});

// 3. Get User Squad (Requires User Auth)
router.get("/squad", requireUserAuth, async (req, res) => {
  const tournamentId = req.query.tournament;
  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }
  try {
    console.log("DEBUG: GET /squad req.user:", req.user);
    const { rows } = await pool.query(
      "SELECT * FROM user_squads WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3",
      [req.partner.id, req.user.id, tournamentId]
    );

    const squadRow = rows[0];
    if (!squadRow) {
      return res.json({ squad: null, country: req.user.country });
    }

    // Automatically sync token-verified country to database squad record if it differs
    if (req.user.country && req.user.country !== squadRow.country) {
      await pool.query(
        "UPDATE user_squads SET country = $1, updated_at = now() WHERE partner_id = $2 AND user_identifier = $3 AND tournament_id = $4",
        [req.user.country, req.partner.id, req.user.id, tournamentId]
      );
      squadRow.country = req.user.country;
    }

    // Seed mock history for user if none exists
    const { rows: existingHistory } = await pool.query(
      "SELECT COUNT(*) FROM user_gameweek_history WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3",
      [req.partner.id, req.user.id, tournamentId]
    );
    if (Number(existingHistory[0].count) === 0 && squadRow.player_ids && squadRow.player_ids.length > 0) {
      const mockHistory = [
        { gw: 1, points: 52, rank: 4, chip: null },
        { gw: 2, points: 45, rank: 3, chip: "wildcard" },
        { gw: 3, points: 61, rank: 2, chip: null }
      ];
      for (const h of mockHistory) {
        await pool.query(
          `INSERT INTO user_gameweek_history (partner_id, user_identifier, tournament_id, gameweek, player_ids, captain_id, chip_used, points, rank)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (partner_id, user_identifier, tournament_id, gameweek) DO NOTHING`,
          [req.partner.id, req.user.id, tournamentId, h.gw, JSON.stringify(squadRow.player_ids), squadRow.captain_id, h.chip, h.points, h.rank]
        );
      }
    }

    const playerIds = squadRow.player_ids;
    if (!playerIds || playerIds.length === 0) {
      return res.json({ squad: [], bank: Number(squadRow.bank_remaining), captainId: squadRow.captain_id });
    }

    const { rows: players } = await pool.query(
      "SELECT * FROM players WHERE tournament_id = $1 AND id = ANY($2)",
      [tournamentId, playerIds]
    );

    // Order players to match initial selection order and ensure 1 GK in starting 11
    let squadList = playerIds
      .map((id) => players.find((p) => p.id === id))
      .filter(Boolean);

    squadList = ensureValidStartingXI(squadList);

    const formattedSquad = squadList.map((p, index) => {
      const playerObj = serializePlayer(p);
      // Attach captain status
      if (playerObj.id === squadRow.captain_id) {
        playerObj.c = true;
      }
      // Set onPitch value based on database order (first 11 are starters)
      playerObj.onPitch = index < 11; 
      return playerObj;
    });

    res.json({
      squad: formattedSquad,
      bank: Number(squadRow.bank_remaining),
      captainId: squadRow.captain_id,
      teamName: squadRow.team_name,
      country: (req.user.country && req.user.country !== "United Kingdom") ? req.user.country : (squadRow.country || req.user.country),
      userName: squadRow.user_name,
      chipsUsed: squadRow.chips_used || [],
      activeChip: squadRow.active_chip || null,
    });
  } catch (err) {
    console.error("GET /squad failed:", err.message);
    res.status(500).json({ error: "Failed to load squad" });
  }
});

// Get Another User's Squad by User Identifier (Public)
router.get("/squads/:userIdentifier", async (req, res) => {
  const { userIdentifier } = req.params;
  const tournamentId = req.query.tournament;
  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM user_squads WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3",
      [req.partner.id, userIdentifier, tournamentId]
    );

    const squadRow = rows[0];
    if (!squadRow) {
      return res.status(404).json({ error: "User squad not found" });
    }

    const playerIds = squadRow.player_ids;
    if (!playerIds || playerIds.length === 0) {
      return res.json({ squad: [], bank: Number(squadRow.bank_remaining), captainId: squadRow.captain_id });
    }

    const { rows: players } = await pool.query(
      "SELECT * FROM players WHERE tournament_id = $1 AND id = ANY($2)",
      [tournamentId, playerIds]
    );

    let squadList = playerIds
      .map((id) => players.find((p) => p.id === id))
      .filter(Boolean);

    squadList = ensureValidStartingXI(squadList);

    const formattedSquad = squadList.map((p, index) => {
      const playerObj = serializePlayer(p);
      if (playerObj.id === squadRow.captain_id) {
        playerObj.c = true;
      }
      playerObj.onPitch = index < 11; 
      return playerObj;
    });

    res.json({
      squad: formattedSquad,
      bank: Number(squadRow.bank_remaining),
      captainId: squadRow.captain_id,
      teamName: squadRow.team_name,
      country: squadRow.country || "United Kingdom",
      userName: squadRow.user_name,
      chipsUsed: squadRow.chips_used || [],
      activeChip: squadRow.active_chip || null,
    });
  } catch (err) {
    console.error("GET /squads/:userIdentifier failed:", err.message);
    res.status(500).json({ error: "Failed to load user squad" });
  }
});


// 4. Create / Update User Squad (Requires User Auth)
router.post("/squad", requireUserAuth, async (req, res) => {
  const { playerIds, captainId, tournamentId, teamName, country, activeChip } = req.body || {};
  if (!tournamentId) return res.status(400).json({ error: "tournamentId is required" });

  try {
    // Fetch the tournament to get sport_key
    const { rows: tournRows } = await pool.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId]);
    const tournament = tournRows[0];
    if (!tournament) return res.status(404).json({ error: "Tournament not found" });

    // Fetch the sport config
    const { rows: sportRows } = await pool.query("SELECT * FROM sports_config WHERE key = $1", [tournament.sport_key]);
    const sportConfig = sportRows[0];
    if (!sportConfig) return res.status(500).json({ error: "Sport configuration not found" });

    const expectedSquadSize = sportConfig.squad_size;

    if (!Array.isArray(playerIds) || playerIds.length !== expectedSquadSize) {
      return res.status(400).json({ error: `Squad must contain exactly ${expectedSquadSize} players` });
    }

    // Fetch all selected players from database
    const { rows: players } = await pool.query(
      "SELECT * FROM players WHERE tournament_id = $1 AND id = ANY($2)",
      [tournamentId, playerIds]
    );

    if (players.length !== expectedSquadSize) {
      return res.status(400).json({ error: "Some players selected are invalid or not found" });
    }

    // Validate squad budget & rules
    let totalCost = 0;
    const clubCounts = {};
    const posCounts = {};

    for (const p of players) {
      totalCost += Number(p.val);
      clubCounts[p.club] = (clubCounts[p.club] || 0) + 1;
      const normalizedPos = resolvePosName(p.pos, sportConfig);
      posCounts[normalizedPos] = (posCounts[normalizedPos] || 0) + 1;
    }

    if (totalCost > 100) {
      return res.status(400).json({ error: `Squad value (£${totalCost}m) exceeds budget of £100m` });
    }

    const overLimitClub = Object.entries(clubCounts).find(([_, count]) => count > 3);
    if (overLimitClub) {
      return res.status(400).json({ error: `Cannot select more than 3 players from ${overLimitClub[0]}` });
    }

    if (sportConfig.key === "football") {
      if (
        (posCounts.GK || 0) !== 2 ||
        (posCounts.DEF || 0) !== 5 ||
        (posCounts.MID || 0) !== 5 ||
        (posCounts.FWD || 0) !== 3
      ) {
        return res.status(400).json({
          error: "Football squad must contain exactly 2 Goalkeepers, 5 Defenders, 5 Midfielders, and 3 Forwards",
        });
      }
    } else {
      // Dynamic validation matching positions bounds
      for (const posConfig of sportConfig.positions) {
        const count = posCounts[posConfig.name] || 0;
        if (count < posConfig.min || count > posConfig.max) {
          return res.status(400).json({
            error: `${sportConfig.name} squad must contain between ${posConfig.min} and ${posConfig.max} ${posConfig.name}s (found ${count})`,
          });
        }
      }
    }

    const numCaptainId = captainId ? Number(captainId) : null;
    if (numCaptainId && !playerIds.map(Number).includes(numCaptainId)) {
      return res.status(400).json({ error: "Captain must be a player in your squad" });
    }

    const bankRemaining = 100 - totalCost;

    const userName = req.user.name || "Manager";

    // Read existing active_chip from DB
    const { rows: existingSquad } = await pool.query(
      "SELECT active_chip FROM user_squads WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3",
      [req.partner.id, req.user.id, tournamentId]
    );
    let currentActiveChip = existingSquad[0]?.active_chip || null;

    // Fetch past used chips from history
    const { rows: historyRows } = await pool.query(
      "SELECT DISTINCT chip_used FROM user_gameweek_history WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3 AND chip_used IS NOT NULL",
      [req.partner.id, req.user.id, tournamentId]
    );
    const pastChipsUsed = historyRows.map(r => r.chip_used);

    if (activeChip !== undefined) {
      if (activeChip && activeChip !== "none") {
        if (pastChipsUsed.includes(activeChip)) {
          return res.status(400).json({ error: `Chip ${activeChip} has already been used in a past gameweek` });
        }
        currentActiveChip = activeChip;
      } else {
        currentActiveChip = null;
      }
    }

    const chipsUsed = [...new Set([...pastChipsUsed, ...(currentActiveChip ? [currentActiveChip] : [])])];

    const sanitizedTeamName = sanitizeInput(teamName || "");
    const sanitizedUserName = sanitizeInput(userName || "Manager");

    const playerObjs = playerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    const validOrderedList = ensureValidStartingXI(playerObjs);
    const validPlayerIds = validOrderedList.map((p) => p.id);

    // Insert or update user squad
    const { rows } = await pool.query(
      `INSERT INTO user_squads (partner_id, user_identifier, tournament_id, player_ids, captain_id, bank_remaining, team_name, country, user_name, chips_used, active_chip, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (partner_id, user_identifier, tournament_id)
       DO UPDATE SET
         player_ids = EXCLUDED.player_ids,
         captain_id = EXCLUDED.captain_id,
         bank_remaining = EXCLUDED.bank_remaining,
         team_name = COALESCE(NULLIF(EXCLUDED.team_name, ''), user_squads.team_name),
         country = COALESCE(NULLIF(EXCLUDED.country, ''), user_squads.country),
         user_name = COALESCE(NULLIF(EXCLUDED.user_name, ''), user_squads.user_name),
         chips_used = EXCLUDED.chips_used,
         active_chip = EXCLUDED.active_chip,
         updated_at = now()
       RETURNING *`,
      [
        req.partner.id,
        req.user.id,
        tournamentId,
        JSON.stringify(validPlayerIds),
        numCaptainId,
        bankRemaining,
        sanitizedTeamName,
        country || req.user.country || "United Kingdom",
        sanitizedUserName,
        JSON.stringify(chipsUsed),
        currentActiveChip
      ]
    );

    // Update partner users and contests counts in the partners table
    await pool.query(
      `UPDATE partners SET 
         users = (SELECT COUNT(DISTINCT user_identifier) FROM user_squads WHERE partner_id = $1),
         contests = (SELECT COUNT(DISTINCT tournament_id) FROM user_squads WHERE partner_id = $1)
       WHERE id = $1`,
      [req.partner.id]
    );

    // Update user's contests count in the partner_users table
    await pool.query(
      `UPDATE partner_users SET
         total_contests_joined = (SELECT COUNT(DISTINCT tournament_id) FROM user_squads WHERE partner_id = $1 AND user_identifier = $2)
       WHERE partner_id = $1 AND user_identifier = $2`,
      [req.partner.id, req.user.id]
    );

    res.json({
      success: true,
      squad: players.map(serializePlayer),
      bank: bankRemaining,
      captainId: rows[0].captain_id,
      teamName: rows[0].team_name,
      country: rows[0].country,
      userName: rows[0].user_name,
      chipsUsed: rows[0].chips_used || [],
      activeChip: rows[0].active_chip || null,
    });
  } catch (err) {
    console.error("POST /squad failed:", err.message);
    res.status(500).json({ error: "Failed to save squad" });
  }
});

// 5. Get Leaderboard
router.get("/leaderboard", async (req, res) => {
  const tournamentId = req.query.tournament;
  const countryFilter = req.query.country;

  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }

  try {
    let query = `
      SELECT 
        us.user_identifier,
        us.team_name,
        us.user_name,
        us.country,
        COALESCE((
          SELECT SUM(points) 
          FROM user_gameweek_history ugh 
          WHERE ugh.partner_id = us.partner_id 
            AND ugh.user_identifier = us.user_identifier 
            AND ugh.tournament_id = us.tournament_id
        ), 0)::int AS total_score
      FROM user_squads us
      WHERE us.tournament_id = $1 AND us.partner_id = $2
    `;

    const params = [tournamentId, req.partner.id];

    if (countryFilter && countryFilter !== "Global") {
      query += ` AND us.country = $3`;
      params.push(countryFilter);
    }

    query += ` ORDER BY total_score DESC`;

    const { rows } = await pool.query(query, params);

    // Add ranking
    const rankedRows = rows.map((row, idx) => ({
      rank: idx + 1,
      userIdentifier: row.user_identifier,
      teamName: row.team_name || "Anonymous FC",
      userName: row.user_name || "Anonymous Manager",
      country: row.country || "Global",
      totalScore: row.total_score,
    }));

    res.json(rankedRows);
  } catch (err) {
    console.error("GET /leaderboard failed:", err.message);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// 6. Get User Gameweek History (Requires User Auth)
router.get("/history", requireUserAuth, async (req, res) => {
  const tournamentId = req.query.tournament;
  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM user_gameweek_history WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3 ORDER BY gameweek ASC",
      [req.partner.id, req.user.id, tournamentId]
    );
    
    // For each gameweek entry, fetch the players details to populate the squad
    const historyList = [];
    for (const h of rows) {
      const playerIds = h.player_ids;
      if (!playerIds || playerIds.length === 0) {
        historyList.push({
          gameweek: h.gameweek,
          squad: [],
          points: h.points,
          rank: h.rank,
          chipUsed: h.chip_used,
          captainId: h.captain_id
        });
        continue;
      }

      const { rows: players } = await pool.query(
        "SELECT * FROM players WHERE tournament_id = $1 AND id = ANY($2)",
        [tournamentId, playerIds]
      );

      let rawSquad = playerIds
        .map((id) => players.find((p) => p.id === id))
        .filter(Boolean);

      rawSquad = ensureValidStartingXI(rawSquad);

      const squadList = rawSquad.map((p, index) => {
        const playerObj = serializePlayer(p);
        if (String(playerObj.id) === String(h.captain_id)) {
          playerObj.c = true;
        }
        // Set onPitch value based on database order (first 11 are starters)
        playerObj.onPitch = index < 11;

        // Generate dynamic player matchday stats for this gameweek
        const matchStats = generatePlayerGameweekStats(p.id, p.pos, h.gameweek);
        playerObj.pts = matchStats.pts;
        playerObj.mins = matchStats.mins;
        playerObj.goals = matchStats.goals;
        playerObj.assists = matchStats.assists;
        playerObj.cleanSheet = matchStats.cleanSheet;
        playerObj.yellowCards = matchStats.yellowCards;
        playerObj.redCards = matchStats.redCards;
        playerObj.saves = matchStats.saves;

        return playerObj;
      });

      // Automatic Bench Substitutions for 0-minute Starters according to official Fantasy Rules
      const substitutions = [];
      const starters = squadList.filter((p) => p.onPitch);
      const bench = squadList.filter((p) => !p.onPitch);

      for (const starter of starters) {
        if (starter.mins === 0) {
          starter.autoSubbed = "OUT"; // Mark 0-min starter as Subbed OUT
          let subIn = null;

          if (starter.pos === "GK") {
            // Goalkeeper can ONLY be replaced by the bench Goalkeeper
            subIn = bench.find((b) => b.pos === "GK" && b.mins > 0 && !b.usedAsSub);
          } else {
            // Outfield players can ONLY be replaced by bench Outfielders (non-GK)
            subIn = bench.find((b) => b.pos !== "GK" && b.mins > 0 && !b.usedAsSub);
          }

          if (subIn) {
            starter.onPitch = false;
            subIn.onPitch = true;
            subIn.autoSubbed = "IN";
            subIn.usedAsSub = true;
            substitutions.push({
              outPlayer: starter.name,
              inPlayer: subIn.name,
              pos: starter.pos,
              gw: h.gameweek,
            });
          }
        }
      }

      // If captain did not play (0 mins), reassign captain multiplier to first active starter
      let activeCaptainId = h.captain_id;
      const captainPlayer = squadList.find((p) => String(p.id) === String(h.captain_id));
      if (captainPlayer && captainPlayer.mins === 0) {
        const viceCaptain = squadList.find((p) => p.onPitch && String(p.id) !== String(h.captain_id) && p.mins > 0);
        if (viceCaptain) {
          activeCaptainId = viceCaptain.id;
          viceCaptain.isViceCaptainUsed = true;
        }
      }

      // Calculate total matchday points dynamically from starter player points (including captain multiplier)
      const mult = (p) => String(p.id) === String(activeCaptainId) ? (h.chip_used === "triple_captain" ? 3 : 2) : 1;
      const calculatedTotal = squadList
        .filter((p) => h.chip_used === "bench_boost" || p.onPitch)
        .reduce((sum, p) => sum + (p.pts * mult(p)), 0);

      historyList.push({
        gameweek: h.gameweek,
        squad: squadList,
        points: calculatedTotal || h.points,
        rank: h.rank,
        chipUsed: h.chip_used,
        captainId: activeCaptainId,
        substitutions,
      });
    }

    res.json(historyList);
  } catch (err) {
    console.error("GET /history failed:", err.message);
    res.status(500).json({ error: "Failed to load history" });
  }
});

router.get("/tournaments", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         t.*, 
         p.name as partner_name,
         p.logo as partner_logo,
         p.primary_color as partner_primary_color,
         p.secondary_color as partner_secondary_color,
         p.subdomain as partner_subdomain,
         s.name as sport_name, 
         s.squad_size, 
         s.positions as sport_positions, 
         s.default_scoring as sport_default_scoring
       FROM tournaments t
       JOIN partners p ON t.partner_id = p.id
       JOIN sports_config s ON t.sport_key = s.key
       WHERE t.partner_id = $1 AND t.status = 'Active' 
       ORDER BY t.created_at DESC`,
      [req.partner.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /tournaments failed:", err.message);
    res.status(500).json({ error: "Failed to load tournaments" });
  }
});

router.get("/tournaments/:id/contests", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM contests WHERE tournament_id = $1 AND partner_id = $2 AND status != 'Draft' ORDER BY created_at DESC",
      [id, req.partner.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(`GET /tournaments/${id}/contests failed:`, err.message);
    res.status(500).json({ error: "Failed to load contests" });
  }
});

/**
 * GET /api/public/sdk-status
 * Checks if SDK is UNCONFIGURED or PUBLISHED for the current partner tenant
 */
router.get("/sdk-status", async (req, res) => {
  const { sportKey, sdkToken } = req.query;
  const targetSport = sportKey || "football";

  try {
    let query = "SELECT * FROM partner_sports_sdk WHERE partner_id = $1";
    let params = [req.partner.id];

    if (sdkToken) {
      query = "SELECT * FROM partner_sports_sdk WHERE sdk_token = $1";
      params = [sdkToken];
    } else {
      query += " AND sport_key = $2";
      params.push(targetSport);
    }

    const { rows } = await pool.query(query, params);
    if (rows.length === 0) {
      // Check if sport is Active
      const sportCheck = await pool.query("SELECT status FROM sports_config WHERE key = $1", [targetSport]);
      if (sportCheck.rows.length === 0 || sportCheck.rows[0].status !== "Active") {
        return res.json({ status: "UNCONFIGURED", configuration: {}, tournamentId: null });
      }

      // Fallback: Check if there are active tournaments for this partner and sport
      const tournRes = await pool.query(
        "SELECT id FROM tournaments WHERE partner_id = $1 AND sport_key = $2 AND status = 'Active'",
        [req.partner.id, targetSport]
      );
      if (tournRes.rows.length > 0) {
        return res.json({
          status: "PUBLISHED",
          configuration: {},
          tournamentId: tournRes.rows[0].id,
          sdkToken: null,
        });
      }
      return res.json({ status: "UNCONFIGURED", configuration: {}, tournamentId: null });
    }

    const sdkRow = rows[0];

    // Check if the sport of this SDK is active
    const sportCheck = await pool.query("SELECT status FROM sports_config WHERE key = $1", [sdkRow.sport_key]);
    if (sportCheck.rows.length === 0 || sportCheck.rows[0].status !== "Active") {
      return res.json({ status: "UNCONFIGURED", configuration: {}, tournamentId: null });
    }

    // Check if the tournament of this SDK is active
    if (sdkRow.tournament_id) {
      const tournCheck = await pool.query("SELECT status FROM tournaments WHERE id = $1", [sdkRow.tournament_id]);
      if (tournCheck.rows.length === 0 || tournCheck.rows[0].status !== "Active") {
        return res.json({ status: "UNCONFIGURED", configuration: {}, tournamentId: null });
      }
    }

    res.json({
      status: sdkRow.status,
      configuration: sdkRow.configuration || {},
      tournamentId: sdkRow.tournament_id,
      sdkToken: sdkRow.sdk_token,
    });
  } catch (err) {
    console.error("GET /sdk-status error:", err.message);
    res.status(500).json({ error: "Failed to fetch SDK status" });
  }
});

/**
 * POST /api/public/tournaments/configure
 * In-widget Tournament Configurator endpoint for runtime state transition (UNCONFIGURED -> PUBLISHED)
 */
router.post("/tournaments/configure", async (req, res) => {
  const {
    tournamentName,
    sportKey,
    source,
    budgetCap,
    squadSize,
    transfersPerMatch,
    captainMultiplier,
    scoringMatrix,
    splashTitle,
  } = req.body || {};

  const name = tournamentName || `${req.partner.name} Tournament`;
  const sKey = sportKey || "football";

  try {
    let apiLeagueId = null;
    let apiSeason = null;
    if (source === "epl") {
      apiLeagueId = 39;
      apiSeason = 2026;
    } else if (source === "ucl") {
      apiLeagueId = 2;
      apiSeason = 2026;
    } else if (source === "wc") {
      apiLeagueId = 1;
      apiSeason = 2026;
    }

    // 1. Create or activate tournament
    const tournRes = await pool.query(
      `INSERT INTO tournaments (
         partner_id, name, sport_key, status, api_league_id, api_season, splash_title
       )
       VALUES ($1, $2, $3, 'Active', $4, $5, $6)
       RETURNING *`,
      [
        req.partner.id,
        name,
        sKey,
        apiLeagueId,
        apiSeason,
        splashTitle || `${req.partner.name} Fantasy`,
      ]
    );

    const tournament = tournRes.rows[0];

    // 2. Update partner_sports_sdk status to PUBLISHED
    const configData = {
      tournamentName: name,
      source: source || "static",
      budgetCap: budgetCap || 100,
      squadSize: squadSize || 11,
      transfersPerMatch: transfersPerMatch || 1,
      captainMultiplier: captainMultiplier || 2,
      scoringMatrix: scoringMatrix || [],
    };

    const sdkToken = `sdk_${req.partner.subdomain}_${sKey}_${Date.now()}`;

    await pool.query(
      `INSERT INTO partner_sports_sdk (partner_id, sport_key, sdk_token, status, configuration, tournament_id)
       VALUES ($1, $2, $3, 'PUBLISHED', $4, $5)
       ON CONFLICT (partner_id, sport_key)
       DO UPDATE SET status = 'PUBLISHED', configuration = EXCLUDED.configuration, tournament_id = EXCLUDED.tournament_id, updated_at = now()`,
      [req.partner.id, sKey, sdkToken, JSON.stringify(configData), tournament.id]
    );

    // Update live_tournaments count on partner
    await pool.query(
      "UPDATE partners SET live_tournaments = (SELECT COUNT(*) FROM tournaments WHERE partner_id = $1 AND status = 'Active') WHERE id = $1",
      [req.partner.id]
    );

    res.json({
      success: true,
      status: "PUBLISHED",
      tournament,
      configuration: configData,
    });
  } catch (err) {
    console.error("POST /tournaments/configure error:", err.message);
    res.status(500).json({ error: "Failed to save and publish tournament configuration." });
  }
});

export default router;

