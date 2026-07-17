import { Router } from "express";
import { pool } from "../db.js";
import { requirePartnerAuth, requireUserAuth } from "../middleware/requirePartnerAuth.js";

const router = Router();

// All public routes require partner tenant verification (via subdomain)
router.use(requirePartnerAuth);

// Helper: Maps database player row to frontend pool.json format
function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    club: p.club,
    short: p.short,
    color: p.color,
    n: p.jersey_number ? Number(p.jersey_number) || p.jersey_number : "",
    pos: p.pos,
    val: Number(p.val),
    pts: p.pts,
    totalPts: p.total_pts,
    matches: p.matches,
    status: p.status,
    opp: p.opp,
    date: p.fixture_date,
    ownership: Number(p.ownership_percent || 0),
    statsBreakdown: p.stats_breakdown || [],
    priceHistory: p.price_history || [],
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// 2. Get Fixtures schedule
router.get("/fixtures", async (req, res) => {
  const tournamentId = req.query.tournament;
  if (!tournamentId || !UUID_REGEX.test(tournamentId)) {
    return res.status(400).json({ error: "A valid UUID tournament parameter is required" });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM fixtures WHERE tournament_id = $1 ORDER BY event_date ASC", [tournamentId]);
    res.json(
      rows.map((f) => ({
        round: f.round,
        date: f.event_date.toISOString(),
        dateLabel: f.date_label,
        home: { name: f.home_name, code: f.home_code, color: f.home_color },
        away: { name: f.away_name, code: f.away_code, color: f.away_color },
        status: f.status,
      }))
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
    const { rows } = await pool.query(
      "SELECT * FROM user_squads WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3",
      [req.partner.id, req.user.id, tournamentId]
    );

    const squadRow = rows[0];
    if (!squadRow) {
      return res.json({ squad: null });
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

    // Order players to match initial selection order or group by position
    const squadList = playerIds
      .map((id) => players.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => {
        const playerObj = serializePlayer(p);
        // Attach captain status
        if (playerObj.id === squadRow.captain_id) {
          playerObj.c = true;
        }
        // Set default onPitch value
        // The frontend can swap them around, but initially we place the first 11 on the pitch
        // and the remaining 4 on the bench.
        playerObj.onPitch = false; 
        return playerObj;
      });

    // Simple default: first GK on pitch, first 3-5 DEFs on pitch, first 3-5 MIDs, and first 1-3 FWDs.
    // Let's mark players on pitch:
    const positionCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    const positionLimits = { GK: 1, DEF: 4, MID: 4, FWD: 2 }; // e.g. 4-4-2 standard starters
    
    for (const p of squadList) {
      if (positionCounts[p.pos] < positionLimits[p.pos]) {
        p.onPitch = true;
        positionCounts[p.pos]++;
      }
    }

    res.json({
      squad: squadList,
      bank: Number(squadRow.bank_remaining),
      captainId: squadRow.captain_id,
      teamName: squadRow.team_name,
      country: squadRow.country,
      userName: squadRow.user_name,
      chipsUsed: squadRow.chips_used || [],
      activeChip: squadRow.active_chip || null,
    });
  } catch (err) {
    console.error("GET /squad failed:", err.message);
    res.status(500).json({ error: "Failed to load squad" });
  }
});

// 4. Create / Update User Squad (Requires User Auth)
router.post("/squad", requireUserAuth, async (req, res) => {
  const { playerIds, captainId, tournamentId, teamName, country, activeChip } = req.body || {};
  if (!tournamentId) return res.status(400).json({ error: "tournamentId is required" });

  if (!Array.isArray(playerIds) || playerIds.length !== 15) {
    return res.status(400).json({ error: "Squad must contain exactly 15 players" });
  }

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
      posCounts[p.pos] = (posCounts[p.pos] || 0) + 1;
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

    if (captainId && !playerIds.includes(Number(captainId))) {
      return res.status(400).json({ error: "Captain must be a player in your squad" });
    }

    const bankRemaining = 100 - totalCost;

    const userName = req.user.name || "Manager";

    // Read existing chips_used and active_chip from DB
    const { rows: existingSquad } = await pool.query(
      "SELECT chips_used, active_chip FROM user_squads WHERE partner_id = $1 AND user_identifier = $2 AND tournament_id = $3",
      [req.partner.id, req.user.id, tournamentId]
    );
    let chipsUsed = existingSquad[0]?.chips_used || [];
    let currentActiveChip = existingSquad[0]?.active_chip || null;

    if (activeChip) {
      if (!chipsUsed.includes(activeChip)) {
        chipsUsed.push(activeChip);
      }
      currentActiveChip = activeChip;
    }

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
        JSON.stringify(playerIds),
        captainId || null,
        bankRemaining,
        teamName || "",
        country || "",
        userName,
        JSON.stringify(chipsUsed),
        currentActiveChip
      ]
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
      WITH squad_players AS (
        SELECT 
          us.id AS squad_id,
          us.user_identifier,
          us.team_name,
          us.user_name,
          us.country,
          us.captain_id,
          us.active_chip,
          (elem.value::text)::int AS player_id,
          elem.ordinality AS player_order
        FROM user_squads us,
        jsonb_array_elements_text(us.player_ids) WITH ORDINALITY AS elem
        WHERE us.tournament_id = $1 AND us.partner_id = $2
      )
      SELECT 
        sp.user_identifier,
        sp.team_name,
        sp.user_name,
        sp.country,
        COALESCE(SUM(
          p.total_pts * (CASE WHEN p.id = sp.captain_id THEN (CASE WHEN sp.active_chip = 'triple_captain' THEN 3 ELSE 2 END) ELSE 1 END)
        ), 0)::int AS total_score
      FROM squad_players sp
      JOIN players p ON p.tournament_id = $1 AND p.id = sp.player_id
      WHERE sp.player_order <= (CASE WHEN sp.active_chip = 'bench_boost' THEN 15 ELSE 11 END)
      GROUP BY sp.squad_id, sp.user_identifier, sp.team_name, sp.user_name, sp.country
    `;

    const params = [tournamentId, req.partner.id];

    if (countryFilter && countryFilter !== "Global") {
      query += ` HAVING sp.country = $3`;
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

      const squadList = playerIds
        .map((id) => players.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => {
          const playerObj = serializePlayer(p);
          if (playerObj.id === h.captain_id) {
            playerObj.c = true;
          }
          playerObj.onPitch = false;
          return playerObj;
        });

      // Populate onPitch based on order
      const positionCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      const positionLimits = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
      for (const p of squadList) {
        if (positionCounts[p.pos] < positionLimits[p.pos]) {
          p.onPitch = true;
          positionCounts[p.pos]++;
        }
      }

      historyList.push({
        gameweek: h.gameweek,
        squad: squadList,
        points: h.points,
        rank: h.rank,
        chipUsed: h.chip_used,
        captainId: h.captain_id
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
         s.name as sport_name, 
         s.squad_size, 
         s.positions as sport_positions, 
         s.default_scoring as sport_default_scoring
       FROM tournaments t
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

export default router;
