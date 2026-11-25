import pg from "pg";

export async function bookingDatabase(){
  const pool=new pg.Pool({host:"database",database:"showroom",user:"showroom",password:process.env.POSTGRES_PASSWORD});
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
