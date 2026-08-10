import dotenv from "dotenv";
dotenv.config();
import { pool } from "./src/db.js";

async function test() {
  const partnerId = '3d3487c2-7981-49db-b3e0-9ad78c34e292'; // footypool partner
  const { rows } = await pool.query(
    `SELECT 
       t.*, 
       p.name as partner_name,
       p.subdomain as partner_subdomain,
       s.name as sport_name
     FROM tournaments t
     JOIN partners p ON t.partner_id = p.id
     JOIN sports_config s ON t.sport_key = s.key
     WHERE t.partner_id = $1 AND t.status = 'Active' 
     ORDER BY t.created_at DESC`,
    [partnerId]
  );
  console.log("=== PUBLIC TOURNAMENTS FOR FOOTYPOOL ===");
  console.log("Count:", rows.length);
  console.dir(rows, { depth: null });
  await pool.end();
}

test();
