import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

function serialize(row) {
  return {
    key: row.key,
    name: row.name,
    status: row.status,
    ruleProfile: row.rule_profile,
    dataProvider: row.data_provider,
    squadSize: row.squad_size,
    positions: row.positions,
    defaultScoring: row.default_scoring,
    tournamentTypes: row.tournament_types,
  };
}

router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM sports_config ORDER BY name");
  res.json(rows.map(serialize));
});

const patchableFields = {
  name: "name",
  status: "status",
  ruleProfile: "rule_profile",
  dataProvider: "data_provider",
  squadSize: "squad_size",
  positions: "positions",
  defaultScoring: "default_scoring",
  tournamentTypes: "tournament_types",
};
const jsonFields = new Set(["positions", "defaultScoring", "tournamentTypes"]);

// Fields that must be integers - coerce to prevent Postgres type errors (e.g. "7.5" for INTEGER column)
const intFields = new Set(["squadSize"]);

router.patch("/:key", async (req, res) => {
  const { key } = req.params;
  const b = req.body || {};

  const updates = [];
  const values = [];
  let i = 1;
  for (const [field, column] of Object.entries(patchableFields)) {
    if (field in b) {
      updates.push(`${column} = $${i++}`);
      let val = b[field];
      if (jsonFields.has(field)) {
        val = JSON.stringify(val);
      } else if (intFields.has(field)) {
        // squad_size is INTEGER in Postgres; round any decimal input (e.g. 7.5 → 8)
        val = Math.round(Number(val));
      }
      values.push(val);
    }
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    values.push(key);
    const { rows } = await pool.query(
      `UPDATE sports_config SET ${updates.join(", ")} WHERE key = $${i} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "Sport not found" });
    res.json(serialize(rows[0]));
  } catch (err) {
    console.error("PATCH /sports/:key error:", err.message);
    res.status(500).json({ error: err.message || "Failed to update sport" });
  }
});

export default router;
