const editorialSchema = `CREATE TABLE IF NOT EXISTS website_page_editions (
  page_key text NOT NULL, edition integer NOT NULL, content jsonb NOT NULL,
  stamp text NOT NULL, actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_key, edition))`;

const reviewEventColumns="id uuid PRIMARY KEY,page_key text NOT NULL,action text NOT NULL,draft_stamp text NOT NULL,actor text NOT NULL,note text NOT NULL,content jsonb NOT NULL,edition integer,recorded_at timestamptz NOT NULL DEFAULT now()";
async function ensurePageTables(conn) {
  const {editions,events}=(await conn.query("SELECT to_regclass('website_page_editions') AS editions,to_regclass('website_page_review_events') AS events")).rows[0];
  if(editions && events)return;
  await conn.query("SELECT pg_advisory_xact_lock(703451021)");
  await conn.query(editorialSchema);
  await conn.query("CREATE TABLE IF NOT EXISTS website_page_review_events ("+reviewEventColumns+")");
}
export async function pageReviewQueue(db){
  return db.transaction(async conn=>{
    await ensurePageTables(conn);
    const rows=(await conn.query(`SELECT page_key AS key, content#>>'{values,title}' AS title, content#>>'{review,state}' AS state,
      content#>>'{review,by}' AS actor,recorded_at AS at FROM website_page_editions
      WHERE edition=0 ORDER BY recorded_at DESC,page_key`)).rows;
    const isReview=row=>row.state==="pending" || row.state==="returned";
    return {status:200,data:{pages:rows.filter(isReview),drafts:rows.filter(row=>!isReview(row))}};
  });
}
function editablePage(page) {
  return {title:page.title, body:page.body, url:page.url, enabled:page.enabled,...(page.blocks?.length?{blocks:DealerSitePages.blocksForDraft(page.blocks)}:{})};
}

function validatePageDraft(value) {
  if (!value || typeof value.enabled !== "boolean") throw Error("Choose a visibility setting.");
  for (const [field, limit] of [["title",150],["body",12000],["url",4096]]) {
    if (typeof value[field] !== "string" || value[field].length > limit) throw Error("Check the length of the page " + field + ".");
  }
  const title=value.title.trim(), body=value.body.trim(), url=value.url.trim();
  if (!title) throw Error("Enter a page title.");
  if (url && !DealerSitePages.safeUrl(url)) throw Error("Enter a valid HTTPS destination without embedded credentials.");
  const blocks=DealerSitePages.blocksForDraft(value.blocks);
  return {title,body,url:url ? DealerSitePages.safeUrl(url) : "",enabled:value.enabled,...(blocks.length?{blocks}:{})};
}

export async function pageWorkflow({db,key,method,input,tenant,actor,manager,exportHistory,fingerprint,uuid}) {
  const base=DealerSitePages.catalog.find(page=>page.key===key);
  const fail=(status,error)=>({status,data:{error}});
  if (!base) return fail(404,"Unknown website page.");
  if (!["GET","POST"].includes(method)) return fail(405,"Use GET or POST.");
  // The route is held for the entire transaction, including tenants on dedicated databases.
  return db.transaction(async conn=>{
    await ensurePageTables(conn);
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
    const allowsPage=DealerSitePages.paymentPageAllowed(key,profile.options,apr);
    const visible=allowsPage && published.enabled;
    const liveStamp=fingerprint(JSON.stringify([live,overrides===null,allowsPage]));
    const editions=(await conn.query(`SELECT edition,content,stamp,actor,recorded_at FROM website_page_editions
      WHERE page_key=$1 ORDER BY edition DESC LIMIT 31`,[key])).rows;
    // Load the draft independently of the history window.
    const draft=(await conn.query("SELECT content,stamp,actor,recorded_at FROM website_page_editions WHERE page_key=$1 AND edition=0",[key])).rows[0];
    const franchise=profile.profile?.siteTemplate==="franchise";
    const review=draft?.content.review||null;
    const pending=review?.state==="pending", returned=review?.state==="returned";
    const governed=franchise || pending;
    const version=fingerprint(JSON.stringify([liveStamp,draft?.stamp,editions[0]?.edition,franchise]));
    if (!write && exportHistory){
      const records=(await conn.query(`SELECT id,action,draft_stamp AS revision,actor,note,content->>'preparedBy' AS author,content-'preparedBy' AS content,edition,recorded_at AS at
        FROM website_page_review_events WHERE page_key=$1 ORDER BY recorded_at,id`,[key])).rows;
      return {status:200,data:{dealership:profile.dealerName||tenant?.name||"Capital City CDJR",page:key,path:base.path,records}};
    }
    if (!write) {
      const events=(await conn.query(`SELECT action,actor,note,edition,recorded_at AS at,content->>'title' AS title
        FROM website_page_review_events WHERE page_key=$1 ORDER BY recorded_at DESC,id DESC LIMIT 40`,[key])).rows;
      return {status:200,data:{key,path:base.path,group:base.group,live,visible,allowsPage,requiresBody:base.editorial,version,manager:!!manager,franchise,events,
      review,canWithdraw:pending && (!!manager || review.by===actor),
      draft:draft?{values:draft.content.values,actor:draft.actor,at:draft.recorded_at,stale:draft.content.base!==liveStamp}:null,
      history:editions.filter(e=>e.edition>0).slice(0,30).map(e=>({edition:e.edition,title:e.content.title,actor:e.actor,at:e.recorded_at}))}};
    }
    if (input?.version!==version) return fail(409,"Someone changed this page. Reload the editor to see the latest version.");
    const action=input.action;
    const snapshot=draft && editablePage(draft.content.values), reviewStamp=draft?.content.revision||draft?.stamp;
    if(snapshot && (action==="submit" || action==="publish") && snapshot.blocks?.some(block=>!block.heading || !block.text))
      return fail(422,"Complete each content block or remove it before sending the page for publication.");
    const event=(action,note="",edition=null)=>conn.query(`INSERT INTO website_page_review_events(id,page_key,action,draft_stamp,actor,note,content,edition)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[uuid(),key,action,reviewStamp,actor,note,{...snapshot,preparedBy:draft.actor},edition]);
    if(pending && ["draft","restore","discard"].includes(action))return fail(409,"Withdraw the review request or return it to the editor before changing the draft.");
    if (["submit","return","withdraw"].includes(action)){
      if(!draft)return fail(409,"Save a draft first.");
      let state, note="";
      if(action==="submit"){
        if(pending||returned)return fail(409,"Save a revised draft before requesting review again.");
        if(draft.content.base!==liveStamp)return fail(409,"The live page changed. Review and save the draft again.");
        if(base.editorial && snapshot.enabled && !snapshot.body && !snapshot.blocks?.length)return fail(422,"Add page content before requesting review.");
        state="pending";
      }else{
        if(!pending)return fail(409,"This page is no longer waiting for review.");
        if(action==="return"){
          if(!manager)return fail(403,"A dealership administrator can return this page for changes.");
          note=typeof input.note==="string"?input.note.trim():"";
          if(!note || note.length>1000)return fail(422,"Enter a review note of up to 1,000 characters.");
          state="returned";
        }else{
          if(!manager && review.by!==actor)return fail(403,"Only the requester or an administrator can withdraw this review.");
          state="draft";
        }
      }
      const next={...draft.content,revision:reviewStamp,review:{state,by:actor,note}};
      await event(action,note);
      await conn.query("UPDATE website_page_editions SET content=$2,stamp=$3,recorded_at=now() WHERE page_key=$1 AND edition=0",[key,next,uuid()]);
    } else if (action==="discard") {
      await conn.query("DELETE FROM website_page_editions WHERE page_key=$1 AND edition=0",[key]);
    } else if (action==="draft" || action==="restore") {
      let values;
      if (action==="restore") {
        if (!Number.isSafeInteger(input.edition) || input.edition<1) return fail(400,"Choose a published revision.");
        values=(await conn.query("SELECT content FROM website_page_editions WHERE page_key=$1 AND edition=$2",[key,input.edition])).rows[0]?.content;
        if (!values) return fail(404,"Revision unavailable.");
        values=editablePage(values);
      } else {
        try {values=validatePageDraft({...input.values,blocks:input.values?.blocks===undefined?(snapshot||live).blocks:input.values.blocks});} catch(error) {return fail(422,error.message);}
      }
      if(returned && JSON.stringify(editablePage(values))===JSON.stringify(snapshot))return fail(422,"Revise the draft to address the review note.");
      await conn.query(`INSERT INTO website_page_editions(page_key,edition,content,stamp,actor) VALUES($1,0,$2,$3,$4)
        ON CONFLICT(page_key,edition) DO UPDATE SET content=excluded.content,stamp=excluded.stamp,actor=excluded.actor,recorded_at=now()`,
        [key,{values,base:liveStamp},uuid(),actor]);
    } else if (action==="publish") {
      if (!draft) return fail(409,"Save a draft first.");
      if (draft.content.base!==liveStamp) return fail(409,"The live page changed. Compare it with your draft and save the draft again.");
      if(governed && !manager)return fail(403,"A dealership administrator must review and publish this page.");
      if(returned)return fail(409,"Save a revised draft before publishing.");
      if(governed && input.checked!==true)return fail(422,"Review the saved copy, visibility and destination before approving.");
      const values=snapshot;
      if (base.editorial && values.enabled && !values.body && !values.blocks?.length) return fail(422,"Add page content before publishing.");
      const last=editions.find(e=>e.edition>0);
      let next=(last?.edition||0)+1;
      const record=(number,content,by)=>conn.query("INSERT INTO website_page_editions(page_key,edition,content,stamp,actor) VALUES($1,$2,$3,$4,$5)",[key,number,content,uuid(),by]);
      if (!last || JSON.stringify(editablePage(last.content))!==JSON.stringify(live))
        await record(next++,live,"Previous site content");
      await record(next,values,actor);
      await event(governed?"approve":"publish","",next);
      pages[key]=values;
      await conn.query("UPDATE client_profile SET settings=jsonb_set(settings,'{pages}',$1::jsonb),etag=$2 WHERE id=1",[pages,uuid()]);
      await conn.query("DELETE FROM website_page_editions WHERE page_key=$1 AND edition=0",[key]);
    } else return fail(400,"Choose a page editing action.");
    return {status:200,data:{ok:true}};
  });
}
