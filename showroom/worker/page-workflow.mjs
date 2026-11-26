const editorialSchema = `CREATE TABLE IF NOT EXISTS website_page_editions (
  page_key text NOT NULL, edition integer NOT NULL, content jsonb NOT NULL,
  stamp text NOT NULL, actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_key, edition))`;

function editablePage(page) {
  return {title:page.title, body:page.body, url:page.url, enabled:page.enabled};
}

function validatePageDraft(value) {
  if (!value || typeof value.enabled !== "boolean") throw Error("Choose a visibility setting.");
  for (const [field, limit] of [["title",150],["body",12000],["url",4096]]) {
    if (typeof value[field] !== "string" || value[field].length > limit) throw Error("Check the length of the page " + field + ".");
  }
  const title=value.title.trim(), body=value.body.trim(), url=value.url.trim();
  if (!title) throw Error("Enter a page title.");
  if (url && !DealerSitePages.safeUrl(url)) throw Error("Enter a valid HTTPS destination without embedded credentials.");
  return {title,body,url:url ? DealerSitePages.safeUrl(url) : "",enabled:value.enabled};
}

export async function pageWorkflow({db,key,method,input,tenant,actor,fingerprint,uuid}) {
  const base=DealerSitePages.catalog.find(page=>page.key===key);
  const fail=(status,error)=>({status,data:{error}});
  if (!base) return fail(404,"Unknown website page.");
  if (!["GET","POST"].includes(method)) return fail(405,"Use GET or POST.");
  // The route is held for the entire transaction, including tenants on dedicated databases.
  return db.transaction(async conn=>{
    // Only the first editor opening a newly provisioned or legacy database needs DDL.
    if (!(await conn.query("SELECT to_regclass('website_page_editions') AS relation")).rows[0].relation) {
      await conn.query("SELECT pg_advisory_xact_lock(703451021)");
      await conn.query(editorialSchema);
    }
    const write=method==="POST";
    if (write) await conn.query("INSERT INTO client_profile(id,settings,etag) VALUES(1,$1,$2) ON CONFLICT DO NOTHING",
      [{dealerName:tenant?.name||"Capital City CDJR",profile:{},pages:{}},uuid()]);
    const profile=(await conn.query("SELECT settings FROM client_profile WHERE id=1"+(write?" FOR UPDATE":" FOR SHARE"))).rows[0]?.settings||{};
    const pages=Array.isArray(profile.pages)?Object.fromEntries(profile.pages.filter(p=>p?.key).map(p=>[p.key,p])):{...profile.pages};
    const overrides=pages[key]??null;
    const defaults=DealerSitePages.list({profile:profile.profile},!!tenant,true).find(p=>p.key===key);
    const published=DealerSitePages.list({...profile,pages},!!tenant,true).find(p=>p.key===key);
    const live=editablePage({...published,enabled:overrides?overrides.enabled!==false:defaults.enabled});
    const apr=profile.financingEnabled!==false && profile.options?.aprFinancingEnabled!==false;
    const allowsPage=apr || !DealerSitePages.requiresApr.has(key);
    const visible=allowsPage && published.enabled;
    const liveStamp=fingerprint(JSON.stringify([live,overrides===null,allowsPage]));
    const editions=(await conn.query(`SELECT edition,content,stamp,actor,recorded_at FROM website_page_editions
      WHERE page_key=$1 ORDER BY edition DESC LIMIT 31`,[key])).rows;
    // Load the draft independently of the history window.
    const draft=(await conn.query("SELECT content,stamp,actor,recorded_at FROM website_page_editions WHERE page_key=$1 AND edition=0",[key])).rows[0];
    const version=fingerprint(JSON.stringify([liveStamp,draft?.stamp,editions[0]?.edition]));
    if (!write) return {status:200,data:{key,path:base.path,group:base.group,live,visible,allowsPage,requiresBody:base.editorial,version,
      draft:draft?{values:draft.content.values,actor:draft.actor,at:draft.recorded_at,stale:draft.content.base!==liveStamp}:null,
      history:editions.filter(e=>e.edition>0).slice(0,30).map(e=>({edition:e.edition,title:e.content.title,actor:e.actor,at:e.recorded_at}))}};
    if (input?.version!==version) return fail(409,"Someone changed this page. Reload the editor to see the latest version.");
    const action=input.action;
    if (action==="discard") {
      await conn.query("DELETE FROM website_page_editions WHERE page_key=$1 AND edition=0",[key]);
    } else if (action==="draft" || action==="restore") {
      let values;
      if (action==="restore") {
        if (!Number.isSafeInteger(input.edition) || input.edition<1) return fail(400,"Choose a published revision.");
        values=(await conn.query("SELECT content FROM website_page_editions WHERE page_key=$1 AND edition=$2",[key,input.edition])).rows[0]?.content;
        if (!values) return fail(404,"Revision unavailable.");
      } else {
        try {values=validatePageDraft(input.values);} catch(error) {return fail(422,error.message);}
      }
      await conn.query(`INSERT INTO website_page_editions(page_key,edition,content,stamp,actor) VALUES($1,0,$2,$3,$4)
        ON CONFLICT(page_key,edition) DO UPDATE SET content=excluded.content,stamp=excluded.stamp,actor=excluded.actor,recorded_at=now()`,
        [key,{values,base:liveStamp},uuid(),actor]);
    } else if (action==="publish") {
      if (!draft) return fail(409,"Save a draft first.");
      if (draft.content.base!==liveStamp) return fail(409,"The live page changed. Compare it with your draft and save the draft again.");
      const values=draft.content.values;
      if (base.editorial && values.enabled && !values.body) return fail(422,"Add page content before publishing.");
      const last=editions.find(e=>e.edition>0);
      let next=(last?.edition||0)+1;
      const record=(number,content,by)=>conn.query("INSERT INTO website_page_editions(page_key,edition,content,stamp,actor) VALUES($1,$2,$3,$4,$5)",[key,number,content,uuid(),by]);
      if (!last || ["title","body","url","enabled"].some(field=>last.content[field]!==live[field]))
        await record(next++,live,"Previous site content");
      await record(next,values,actor);
      pages[key]=values;
      await conn.query("UPDATE client_profile SET settings=jsonb_set(settings,'{pages}',$1::jsonb),etag=$2 WHERE id=1",[pages,uuid()]);
      await conn.query("DELETE FROM website_page_editions WHERE page_key=$1 AND edition=0",[key]);
    } else return fail(400,"Choose a page editing action.");
    return {status:200,data:{ok:true}};
  });
}
