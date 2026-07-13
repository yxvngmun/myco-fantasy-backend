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
  };
}

// 1. Get Players catalog
router.get("/players", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM players ORDER BY val DESC");
    res.json(rows.map(serializePlayer));
  } catch (err) {
    console.error("GET /players failed:", err.message);
    res.status(500).json({ error: "Failed to load players" });
  }
});

// 2. Get Fixtures schedule
router.get("/fixtures", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM fixtures ORDER BY event_date ASC");
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
  try {
    const { rows } = await pool.query(
      "SELECT * FROM user_squads WHERE partner_id = $1 AND user_identifier = $2",
      [req.partner.id, req.user.id]
    );

    const squadRow = rows[0];
    if (!squadRow) {
      return res.json({ squad: null });
    }

    const playerIds = squadRow.player_ids;
    if (!playerIds || playerIds.length === 0) {
      return res.json({ squad: [], bank: Number(squadRow.bank_remaining), captainId: squadRow.captain_id });
    }

    const { rows: players } = await pool.query(
      "SELECT * FROM players WHERE id = ANY($1)",
      [playerIds]
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
    });
  } catch (err) {
    console.error("GET /squad failed:", err.message);
    res.status(500).json({ error: "Failed to load squad" });
  }
});

// 4. Create / Update User Squad (Requires User Auth)
router.post("/squad", requireUserAuth, async (req, res) => {
  const { playerIds, captainId } = req.body || {};

  if (!Array.isArray(playerIds) || playerIds.length !== 15) {
    return res.status(400).json({ error: "Squad must contain exactly 15 players" });
  }

  try {
    // Fetch all selected players from database
    const { rows: players } = await pool.query(
      "SELECT * FROM players WHERE id = ANY($1)",
      [playerIds]
    );

    if (players.length !== 15) {
      return res.status(400).json({ error: "Some players selected are invalid or not found" });
    }

    // Validate squad budget & rules
    let totalCost = 0;
    const clubCounts = {};
    const posCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };

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

    if (posCounts.GK !== 2 || posCounts.DEF !== 5 || posCounts.MID !== 5 || posCounts.FWD !== 3) {
      return res.status(400).json({
        error: "Squad must contain exactly 2 Goalkeepers, 5 Defenders, 5 Midfielders, and 3 Forwards",
      });
    }

    if (captainId && !playerIds.includes(Number(captainId))) {
      return res.status(400).json({ error: "Captain must be a player in your squad" });
    }

    const bankRemaining = 100 - totalCost;

    // Insert or update user squad
    const { rows } = await pool.query(
      `INSERT INTO user_squads (partner_id, user_identifier, player_ids, captain_id, bank_remaining, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (partner_id, user_identifier)
       DO UPDATE SET
         player_ids = EXCLUDED.player_ids,
         captain_id = EXCLUDED.captain_id,
         bank_remaining = EXCLUDED.bank_remaining,
         updated_at = now()
       RETURNING *`,
      [req.partner.id, req.user.id, JSON.stringify(playerIds), captainId || null, bankRemaining]
    );

    res.json({
      success: true,
      squad: players.map(serializePlayer),
      bank: bankRemaining,
      captainId: rows[0].captain_id,
    });
  } catch (err) {
    console.error("POST /squad failed:", err.message);
    res.status(500).json({ error: "Failed to save squad" });
  }
});

export default router;
