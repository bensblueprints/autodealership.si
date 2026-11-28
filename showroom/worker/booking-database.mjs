import pg from "pg";

export function showroomPool(database) {
  const limits = database ? { max: 3, idleTimeoutMillis: 5000 } : {};
  const configured = process.env.SHOWROOM_DATABASE_URL;
  if (!configured) {
    return new pg.Pool({
      host: "database",
      database: database || "showroom",
      user: "showroom",
      password: process.env.POSTGRES_PASSWORD,
      ...limits,
    });
  }

  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Invalid SHOWROOM_DATABASE_URL");
  }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) {
    throw new Error("SHOWROOM_DATABASE_URL must name a PostgreSQL server and control database");
  }
  if (url.searchParams.has("database") || url.searchParams.has("dbname")) {
    throw new Error("Specify the control database in the URL path");
  }
  if (database) url.pathname = "/" + encodeURIComponent(database);
  return new pg.Pool({ connectionString: url.toString(), ...limits });
}

export async function bookingDatabase(){
  const pool=showroomPool();
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(`CREATE TABLE IF NOT EXISTS appointments (
      key text PRIMARY KEY, confirmation text UNIQUE NOT NULL, body jsonb NOT NULL,
      notes jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS inventory_status (vin text PRIMARY KEY,status text NOT NULL CHECK(status IN ('sold','deleted')));
      CREATE TABLE IF NOT EXISTS showroom_migrations (name text PRIMARY KEY)`);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  return pool;
}
