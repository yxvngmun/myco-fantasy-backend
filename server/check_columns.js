import dotenv from "dotenv";
dotenv.config();
import { pool } from "./src/db.js";

async function check() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'players';
    `);
    console.log(res.rows);
  } finally {
    await pool.end();
  }
}

check();
