const draftSchema="vin text PRIMARY KEY, specs jsonb, created_at timestamptz NOT NULL DEFAULT now()";

async function draftsExist(conn){
  return !!(await conn.query("SELECT to_regclass('inventory_vin_drafts') AS relation")).rows[0].relation;
}

export async function listVinDrafts(db,offset){
  if(!Number.isSafeInteger(offset)||offset<0)return inventoryError(400,"Invalid draft page.");
  return db.transaction(async conn=>{
    if(!await draftsExist(conn))return inventoryResult(200,{total:0,rows:[]});
    const total=(await conn.query("SELECT count(*)::int AS n FROM inventory_vin_drafts")).rows[0].n;
    const rows=(await conn.query("SELECT vin,specs FROM inventory_vin_drafts ORDER BY created_at DESC,vin LIMIT 20 OFFSET $1",[offset])).rows;
    return inventoryResult(200,{total,rows});
  });
}

export async function importVinDrafts(db,input,decode){
  if(typeof input!=="string" || input.length>12000)return inventoryError(400,"Enter a list of VINs.");
  const entries=input.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if(!entries.length || entries.length>25)return inventoryError(422,"Submit between 1 and 25 entries per batch.");
  const invalid=[],repeated=[],existing=[],drafts=[],added=[],lookup=[],seen=new Set();
  for(const vin of entries){
    if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))invalid.push(vin);
    else if(seen.has(vin))repeated.push(vin);
    else seen.add(vin);
  }
  if(seen.size){
    await db.transaction(async conn=>{
      if(!await draftsExist(conn)){
        await conn.query("SELECT pg_advisory_xact_lock(81453,1)");
        await conn.query("CREATE TABLE IF NOT EXISTS inventory_vin_drafts ("+draftSchema+")");
      }
      // Use the publishing lock and a stable order for overlapping imports.
      for(const vin of [...seen].sort()){
        if(await inventoryRecord(conn,vin)){existing.push(vin);continue;}
        const saved=await conn.query("INSERT INTO inventory_vin_drafts(vin) VALUES($1) ON CONFLICT DO NOTHING",[vin]);
        if(saved.rowCount){added.push(vin);lookup.push(vin);}
        else{
          drafts.push(vin);
          if(!(await conn.query("SELECT specs IS NOT NULL AS decoded FROM inventory_vin_drafts WHERE vin=$1",[vin])).rows[0].decoded)lookup.push(vin);
        }
      }
      return inventoryResult(200,{});
    });
  }
  // VINs are durable before decoding. A catalog outage never loses intake.
  let decoded=0;
  if(lookup.length){
    try{
      const rows=await decode(lookup);
      const matched=rows.filter(r=>r.specs?.ErrorCode==="0" && (r.specs.Make || r.specs.Model));
      if(matched.length){
        const result=await db.query(`UPDATE inventory_vin_drafts d SET specs=v.specs
          FROM jsonb_to_recordset($1::jsonb) AS v(vin text,specs jsonb) WHERE d.vin=v.vin AND d.specs IS NULL`,[JSON.stringify(matched)]);
        decoded=result.rowCount;
      }
    }catch(error){console.warn("Bulk VIN enrichment deferred",error.code||error.name);}
  }
  return inventoryResult(200,{added,drafts,existing,invalid,repeated,needsLookup:lookup.length-decoded});
}
