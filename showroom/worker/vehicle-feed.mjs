const feedXml = value => String(value).replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,"")
  .replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c]));
const feedText = value => typeof value==="string" && !/^(?:n\/a|unknown|unspecified|not available|other\/unknown)$/i.test(value.trim()) ? value.trim() : "";

export function vehicleFeedItem(car, origin) {
  const issues=[];
  const vin=car.vin, make=feedText(car.make), model=feedText(car.model), color=feedText(car.color);
  const condition=feedText(car.condition).toLowerCase();
  const used=["used","pre-owned","certified pre-owned","certified"].includes(condition);
  if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))issues.push("Valid 17-character VIN");
  if(!/^\d{4}$/.test(car.year))issues.push("Four-digit model year");
  if(!make)issues.push("Make");
  if(!model)issues.push("Model");
  if(!color)issues.push("Exterior color");
  if(!used && condition!=="new")issues.push("New or used condition");
  if(!/^\d+$/.test(car.miles) || !Number.isSafeInteger(Number(car.miles)))issues.push("Odometer reading in miles");
  if(condition==="new" && Number(car.miles)>200)issues.push("Review new condition and odometer");
  const status=String(car.status||"").trim().toLowerCase();
  if(status && !["available","in stock","in-stock","on lot"].includes(status))issues.push(status==="listed online"?"Confirm on-lot availability and select Available":"Available on the lot");
  const dollars=value=>/^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value)>0;
  if(!dollars(car.price))issues.push("Positive cash selling price");
  if(condition==="new" && !dollars(car.msrp))issues.push("MSRP for new vehicle");
  let image;
  try{
    const source=feedText(car.image);
    if(!/^(?:https:\/\/|\/?assets\/vehicle-photos\/)/i.test(source))throw Error();
    image=new URL(source,origin+"/");
    if(image.protocol!=="https:" || image.username || image.password || car.image_type==="stock")throw Error();
  }catch{issues.push("Photo of the actual vehicle");}
  if(issues.length)return {issues,vin,stock:car.stock};
  const url=origin+"/vehicle.html?stock="+encodeURIComponent(vin);
  const values={id:vin,vin,google_product_category:"916",condition:used?"used":"new",brand:make,model,
    year:car.year,color,mileage:car.miles+" Miles",price:Number(car.price).toFixed(2)+" USD",
    image_link:image.href,link_template:url+"&store={store_code}",link:url};
  if(dollars(car.msrp))values.vehicle_msrp=Number(car.msrp).toFixed(2)+" USD";
  if(feedText(car.trim))values.trim=car.trim.trim();
  return {values,vin,stock:car.stock};
}

export async function readVehicleFeed(db, origin, useDealerCash, diagnostics) {
  const profile=(await db.query("SELECT settings->'profile'->>'googleStoreCode' AS code,settings->'profile'->>'country' AS country,settings->'options' AS options,settings->>'dealerName' AS name FROM client_profile WHERE id=1")).rows[0]||{};
  const code=profile.code||"";
  const country=String(profile.country||"US").toLowerCase().replace(/[^a-z]/g,"");
  const supportedCountry=["us","usa","unitedstates","unitedstatesofamerica"].includes(country);
  const enabled=!!code && supportedCountry && profile.options?.pricing!==false && profile.options?.cash!==false;
  if(!enabled && !diagnostics)return null;
  const cars=await db.query(`SELECT c.vin,c.body->>'stock' AS stock,c.body->>'make' AS make,c.body->>'model' AS model,
    c.body->>'trim' AS trim,c.body->>'year' AS year,c.body->>'condition' AS condition,c.body->>'color' AS color,
    c.body->>'miles' AS miles,c.body->>'image' AS image,c.body->>'imageType' AS image_type,c.body->>'status' AS status,
    CASE WHEN $1 AND b.offer ? 'cash' THEN ((b.offer->>'cash')::numeric/100)::text ELSE c.body->>'price' END AS price,
    c.body->>'msrp' AS msrp FROM client_cars c LEFT JOIN bhph_offers b ON b.vehicle=c.vin
    WHERE NOT EXISTS(SELECT 1 FROM inventory_status s WHERE s.vin=c.vin) ORDER BY c.vin`,[useDealerCash]);
  const entries=cars.rows.map(car=>vehicleFeedItem(car,origin));
  const valid=entries.filter(row=>row.values);
  if(diagnostics)return {storeCode:code,enabled,supportedCountry,pricingVisible:profile.options?.pricing!==false && profile.options?.cash!==false,
    url:origin+"/feeds/google-vehicles.xml",available:entries.length,eligible:valid.length,
    excluded:entries.filter(row=>row.issues),asOf:new Date().toISOString()};
  const items=valid.map(({values})=>{
    const attributes=Object.entries(values).map(([field,value])=>"<g:"+field+">"+feedXml(value)+"</g:"+field+">").join("");
    return "<item>"+attributes+"<g:vehicle_fulfillment><g:option>in_store</g:option><g:store_code>"+feedXml(code)+"</g:store_code></g:vehicle_fulfillment></item>";
  });
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>'+feedXml(profile.name||"Dealership inventory")+"</title><link>"+feedXml(origin+"/")+"</link><description>Available vehicles</description>"+items.join("")+"</channel></rss>";
}
