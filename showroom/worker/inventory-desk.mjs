const lotTable="inventory_lot_dates";
const lotColumns="vin text PRIMARY KEY,stocked_on date NOT NULL";
const inventoryResult=(status,data)=>({status,data});
const inventoryError=(status,error)=>inventoryResult(status,{error});
async function lotDatesExist(db){
  return Boolean((await db.query("SELECT to_regclass('inventory_lot_dates') AS relation")).rows[0].relation);
}
export async function inventoryDesk(db,tenant){
  return db.transaction(async conn=>{
    const dates=await lotDatesExist(conn);
    const rows=(await conn.query("SELECT c.body,s.status,"+(dates?"to_char(l.stocked_on,'YYYY-MM-DD')":"NULL::text")+" AS arrival FROM client_cars c LEFT JOIN inventory_status s ON s.vin=c.vin "+
      (dates?"LEFT JOIN inventory_lot_dates l ON l.vin=c.vin ":"")+"WHERE s.status IS DISTINCT FROM 'deleted' ORDER BY "+(tenant?"c.vin":"c.position"))).rows;
    return inventoryResult(200,rows.map(({body,status,arrival})=>({...body,lotDate:arrival,deskStatus:status||"current"})));
  });
}
async function inventoryRecord(conn,vin){
  await conn.query("SELECT pg_advisory_xact_lock(81451,hashtext($1))",[vin]);
  return (await conn.query("SELECT c.body->>'stock' AS stock,s.status FROM client_cars c LEFT JOIN inventory_status s USING(vin) WHERE c.vin=$1",[vin])).rows[0];
}
async function stockInUse(conn,stock,vin){
  await conn.query("SELECT pg_advisory_xact_lock(81452,hashtext(lower(btrim($1))))",[stock]);
  return (await conn.query(`SELECT 1 FROM client_cars c WHERE c.vin<>$2 AND lower(btrim(c.body->>'stock'))=lower(btrim($1))
    AND NOT EXISTS(SELECT 1 FROM inventory_status s WHERE s.vin=c.vin) LIMIT 1`,[stock,vin])).rowCount>0;
}
async function saveLotDate(conn,vin,value,expected){
  if(value!==null){
    if(typeof value!=="string" || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || value.slice(0,4)==="0000" ||
      new Date(value).toISOString().slice(0,10)!==value)return inventoryError(422,"Enter a valid lot arrival date.");
    const {today}=(await conn.query(`SELECT to_char(now() AT TIME ZONE coalesce(
      (SELECT settings->'profile'->>'driveTimezone' FROM client_profile WHERE id=1),'America/Chicago'),'YYYY-MM-DD') AS today`)).rows[0];
    if(value>today)return inventoryError(422,"Lot arrival cannot be in the future.");
  }
  if(!await lotDatesExist(conn)){
    await conn.query("SELECT pg_advisory_xact_lock(81453,0)");
    await conn.query("CREATE TABLE IF NOT EXISTS "+lotTable+" ("+lotColumns+")");
  }
  const current=(await conn.query("SELECT to_char(stocked_on,'YYYY-MM-DD') AS day FROM inventory_lot_dates WHERE vin=$1",[vin])).rows[0]?.day||null;
  if(current!==expected && current!==value)return inventoryError(409,"Another editor changed the lot date. Reopen the vehicle to review it.");
  if(value===null)await conn.query("DELETE FROM inventory_lot_dates WHERE vin=$1",[vin]);
  else await conn.query("INSERT INTO inventory_lot_dates VALUES($1,$2) ON CONFLICT(vin) DO UPDATE SET stocked_on=excluded.stocked_on",[vin,value]);
}
export async function saveInventoryRecord(db,payload){
  const {lotDate,previousLotDate,inventoryIntent,deskStatus,...car}=payload;
  car.stock=String(car.stock||"").trim();
  if(!car.stock)return inventoryError(422,"Enter a stock number.");
  return db.transaction(async conn=>{
    const existing=await inventoryRecord(conn,car.vin);
    if(inventoryIntent==="add" && existing)return inventoryError(409,existing.status==="sold"?"This VIN is in Sold inventory. Return the existing listing to the lot.":existing.status==="deleted"?"This VIN belongs to a deleted listing.":"This VIN is already in inventory. Open the existing listing.");
    if(inventoryIntent==="edit" && !existing)return inventoryError(409,"This vehicle is no longer in inventory.");
    if(existing?.status==="deleted")return inventoryError(409,"This listing was deleted.");
    if(!existing?.status && existing?.stock?.trim().toLowerCase()!==car.stock.toLowerCase() && await stockInUse(conn,car.stock,car.vin))
      return inventoryError(409,"This stock number is already in use on the current lot.");
    if(lotDate!==undefined){
      const invalid=await saveLotDate(conn,car.vin,lotDate,previousLotDate??null);
      if(invalid)return invalid;
    }
    await conn.query("INSERT INTO client_cars(vin,body) VALUES($1,$2) ON CONFLICT(vin) DO UPDATE SET body=client_cars.body || excluded.body",[car.vin,car]);
    return inventoryResult(200,{});
  });
}
export async function changeInventoryStatus(db,vin,status){
  return db.transaction(async conn=>{
    const car=await inventoryRecord(conn,vin);
    if(!car)return inventoryError(404,"This vehicle is no longer in inventory.");
    if(car.status==="deleted" && status!=="deleted")return inventoryError(409,"This vehicle was deleted.");
    if(status==="available"){
      if(car.status==="sold" && car.stock && await stockInUse(conn,car.stock,vin))return inventoryError(409,"Another current vehicle uses this stock number. Edit the sold listing's stock number before returning it to the lot.");
      await conn.query("DELETE FROM inventory_status WHERE vin=$1 AND status='sold'",[vin]);
    }else await conn.query("INSERT INTO inventory_status VALUES($1,$2) ON CONFLICT(vin) DO UPDATE SET status=excluded.status WHERE inventory_status.status<>'deleted'",[vin,status]);
    return inventoryResult(200,{});
  });
}
