// The public contact card and its search metadata share the same published facts.
const DealerLocation = (() => {
  const departments = [["Sales","sales"],["Service","service"],["Parts","parts"]];
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const socialNames = {facebook:"Facebook",instagram:"Instagram",youtube:"YouTube",tiktok:"TikTok",x:"X",linkedin:"LinkedIn"};
  const text = value => typeof value === "string" ? value.trim() : "";
  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function dial(number) {
    const parts = /^([+\d().\s-]+?)(?:\s*(?:ext\.?|x|#)\s*(\d+))?$/i.exec(text(number));
    if (!parts) return "";
    const digits = parts[1].replace(/\D/g,"");
    if (digits.length < 7 || digits.length > 15) return "";
    return "tel:" + (parts[1].trim().startsWith("+") ? "+" : "") + digits + (parts[2] ? ";ext=" + parts[2] : "");
  }
  function schedule(hours) {
    if (!hours || typeof hours !== "object") return [];
    const valid = time => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
    return days.flatMap(day => {
      const pair = hours[day.slice(0,3)];
      if (pair === null) return [{day,range:null}];
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(valid) || pair[0] >= pair[1]) return [];
      return [{day,range:pair}];
    });
  }
  function facts(profile = {}) {
    const address = {};
    for (const [key,field] of Object.entries({streetAddress:"street",addressLocality:"city",addressRegion:"region",postalCode:"postal",addressCountry:"country"})) {
      if (text(profile[field])) address[key] = text(profile[field]);
    }
    const locality = [address.addressLocality,[address.addressRegion,address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const lines = address.streetAddress || locality ? [address.streetAddress,locality,address.addressCountry].filter(Boolean) : [];
    const teams = departments.map(([label,key]) => {
      const number = text(profile[key+"Phone"]), phone = dial(number);
      return {label,key,phone,number,hours:schedule(profile[key+"Hours"])};
    }).filter(team => team.phone || team.hours.length);
    const socials = Object.entries(socialNames).flatMap(([key,label]) => {
      const href = DealerSitePages.safeUrl(profile[key]);
      return href ? [{label,href}] : [];
    });
    return {address,lines,teams,socials,zone:text(profile.driveTimezone).replaceAll("_"," ")};
  }
  function clock(value) {
    const [hour,min] = value.split(":");
    return (Number(hour)%12 || 12) + ":" + min + (Number(hour)<12 ? " AM" : " PM");
  }
  function card(f,expanded = false) {
    const parts = [];
    if (f.lines.length) {
      const url = "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(f.lines.join(", "));
      parts.push('<section class="location-block"><h3>Visit the dealership</h3><address>'+f.lines.map(line=>'<span>'+esc(line)+'</span>').join("")+'</address><a class="location-action" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Get directions</a></section>');
    }
    for (const team of f.teams) {
      const phone = team.phone ? '<a class="department-phone" href="'+esc(team.phone)+'" aria-label="'+esc("Call "+team.label+" at "+team.number)+'">'+esc(team.number)+'</a>' : "";
      const rows = team.hours.map(({day,range})=>'<div><dt>'+day+'</dt><dd>'+(range?range.map(clock).join(" – "):"Closed")+'</dd></div>').join("");
      const hours = rows ? '<details class="location-hours" data-department="'+team.key+'"'+(expanded?" open":"")+'><summary>'+team.label+' hours</summary><dl>'+rows+'</dl><p>'+esc(f.zone?"Local time · "+f.zone:"Dealership local time")+'</p></details>' : "";
      parts.push('<section class="location-block"><h3>'+team.label+'</h3>'+phone+hours+'</section>');
    }
    if (f.socials.length) parts.push('<section class="location-block"><h3>Follow us</h3><div class="social-links">'+f.socials.map(s=>'<a href="'+esc(s.href)+'" target="_blank" rel="noopener noreferrer">'+s.label+'</a>').join("")+'</div></section>');
    return parts.length ? '<div class="contact-grid location-grid">'+parts.join("")+'</div>' : "";
  }
  function schema(f,name,origin) {
    if (!f.address.streetAddress || !f.address.addressLocality || !name) return null;
    const address = {"@type":"PostalAddress",...f.address};
    const dealer = {"@context":"https://schema.org","@type":"AutoDealer","@id":origin+"/#dealership",name,url:origin+"/",address};
    for (const team of f.teams) {
      const entity = team.key==="sales" ? dealer : {"@type":team.key==="service"?"AutoRepair":"AutoPartsStore","@id":origin+"/#"+team.key,name:name+" "+team.label,address};
      if (team.phone) entity.telephone = team.number;
      if (team.hours.length) entity.openingHoursSpecification = team.hours.map(({day,range})=>({"@type":"OpeningHoursSpecification",dayOfWeek:"https://schema.org/"+day,opens:range?.[0]||"00:00",closes:range?.[1]||"00:00"}));
      if (entity!==dealer) (dealer.department ||= []).push(entity);
    }
    if (f.socials.length) dealer.sameAs = f.socials.map(s=>s.href);
    return dealer;
  }
  return {dial,facts,card,schema};
})();
