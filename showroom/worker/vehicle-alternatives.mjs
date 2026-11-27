// Only the current dealership's published listings can appear on a shopper's vehicle page.
export async function vehicleAlternatives(db,{vin,car,showCash,useDealerCash}) {
  const price = showCash && Number(car?.price)>0 ? car.price : null;
  const {rows} = await db.query(`
    WITH inventory AS (
      SELECT c.vin,c.body,
        CASE WHEN $5 THEN COALESCE((o.offer->>'cash')::numeric / 100,
          CASE WHEN c.body->>'price' ~ '^[0-9]+([.][0-9]+)?$' THEN (c.body->>'price')::numeric END) END AS price,
        CASE WHEN lower(trim(c.body->>'make'))=$2 AND lower(trim(c.body->>'model'))=$3 THEN 1
             WHEN lower(trim(c.body->>'body'))=$4 THEN 2
             WHEN lower(trim(c.body->>'make'))=$2 THEN 3 ELSE 4 END AS match_rank
      FROM client_cars c LEFT JOIN bhph_offers o ON $6 AND o.vehicle=c.vin
      WHERE c.vin<>$1 AND NOT EXISTS(SELECT 1 FROM inventory_status s WHERE s.vin=c.vin)
        AND lower(trim(coalesce(c.body->>'status',''))) NOT IN ('reserved','in transit','sold','deleted')
    )
    SELECT vin,body->>'year' AS year,body->>'make' AS make,body->>'model' AS model,
      body->>'trim' AS trim,body->>'stock' AS stock,body->>'miles' AS miles,
      body->>'image' AS image,body->>'imageType' AS image_type,price,match_rank
    FROM inventory ORDER BY match_rank,abs(nullif(price,0)-$7::numeric) NULLS LAST,
      CASE WHEN body->>'year' ~ '^[0-9]{4}$' THEN body->>'year' END DESC NULLS LAST,vin
    LIMIT 3`,[vin,...[car?.make,car?.model,car?.body].map(v=>v?.trim().toLowerCase()||null),showCash,useDealerCash,price]);
  return rows;
}

export function publicVehiclePhoto(value,origin) {
  if(typeof value!=="string" || !/^(?:https:\/\/|\/?assets\/)/i.test(value))return "";
  try{
    const url=new URL(value,origin+"/");
    return url.protocol==="https:" && !url.username && !url.password ? url.href : "";
  }catch{return "";}
}

export function alternativesMarkup(rows,{esc,origin,inventoryPath,unavailable}) {
  if(!rows.length)return "";
  const cards=rows.map(car=>{
    const title=[car.year,car.make,car.model,car.trim].filter(Boolean).join(" ") || "Vehicle details";
    const photo=publicVehiclePhoto(car.image,origin);
    const media=photo?'<img src="'+esc(photo)+'" loading="lazy" alt="">':'<span class="related-placeholder">Photo unavailable</span>';
    const caption=photo && car.image_type==="stock"?'<small>Representative photo</small>':"";
    const miles=/^\d+$/.test(car.miles||"")?Number(car.miles).toLocaleString("en-US")+" mi":"";
    const reason=["","Same model","Same body style","Same make"][car.match_rank]||"";
    const price=Number(car.price)>0?'<strong>Cash price '+esc(Number(car.price).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:2}))+'</strong>':"";
    const info=[miles,car.stock && "Stock #"+car.stock].filter(Boolean).join(" · ");
    return '<li><a class="related-card" href="/vehicle.html?stock='+esc(encodeURIComponent(car.vin))+'"><div class="related-photo">'+media+caption+'</div><div class="related-details">'+
      (reason?'<span>'+reason+'</span>':'')+'<h3>'+esc(title)+'</h3>'+(info?'<p>'+esc(info)+'</p>':'')+price+'</div></a></li>';
  }).join("");
  return '<section id="similar-vehicles" aria-labelledby="similar-title"><div class="related-heading"><h2 id="similar-title">More from this dealership</h2>'+
    (unavailable?'':'<a href="'+esc(inventoryPath)+'">Browse inventory</a>')+'</div><ul>'+cards+'</ul></section>';
}
