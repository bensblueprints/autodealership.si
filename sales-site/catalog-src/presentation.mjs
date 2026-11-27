import { editorialFor } from "./editorial.mjs";

const h=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const imagery={
 approach:["Delivery bay at sunset with a red wagon","A vehicle ready for delivery"],
 lot:["Vehicles lined up outside an independent dealership","On the lot"],
 desk:["Desk phone and vehicle keys at a dealership","At the sales desk"],
 franchise:["Sunlit automotive showroom with a white crossover","On the showroom floor"],
 road:["A coupe on a winding country road","On the road"]
};
const screens={
 showroom:["Vehicle detail page","A shopper can review the truck, its listed price and its stock number before requesting a test drive."],
 search:["Inventory search","The inventory list updates as a shopper chooses a make, body style or payment preference."],
 location:["Hours and directions","The showroom displays department contact details and opening hours from the dealer’s settings."],
 payment:["Cash and in-house payments","The vehicle page presents cash price and a dealer-configured down payment and installment schedule."],
 banners:["Homepage banner controls","Staff choose the hero image and arrange promotional slides before saving them to the showroom."],
 inquiry:["Shopper inquiry inbox","The salesperson sees the stock number, the question and the shopper’s contact information in a single record."],
 reporting:["Test-drive reporting","The dealership can compare bookings with attended visits, no-shows and appointments still awaiting an outcome."],
 conversation:["Customer conversation","The opportunity shows its assigned salesperson, stage and messages associated with the shopper."],
 concierge:["Voice concierge","The shopper can start a voice session or use the text field while browsing the dealer’s inventory."],
 chat:["Showroom chat","The shopper types an inventory question into the concierge and continues the conversation on the page."],
 review:["Review page changes","A reviewer compares proposed copy and its evidence before deciding whether to publish."],
 feed:["Google vehicle feed diagnostics","Staff can search by VIN or stock number and see which listing fields need attention before a vehicle can enter the feed."],
 campaign:["Campaign brief","The dealer can specify a program, channel, target market and budget, then send the brief for review."]
};
const productMap={
 "lotline":["lot","showroom","search"],"local-reach":["lot","location","showroom"],"answer-index":["road","location","review"],"deal-path":["approach","payment","showroom"],"offer-board":["franchise","banners","review"],"shopper-paths":["road","search","showroom"],"rooftop-profile":["lot","location","banners"],"stock-inbox":["desk","inquiry","conversation"],"visit-count":["approach","reporting","inquiry"],"contact-permissions":["desk","inquiry","conversation"],"access-review":["franchise","search","location"],"lot-guide":["approach","concierge","inquiry"],"front-desk":["desk","conversation","inquiry"],"lot-chat":["desk","chat","conversation"],"copy-desk":["desk","review","banners"],"feed-desk":["lot","feed","showroom"]
};
const otherMap={
 "company/our-approach":["approach","showroom","inquiry"],"company/dealer-stories":["lot","inquiry","reporting"],"company/leadership":["desk"],"company/work-with-us":["road"],
 "solutions/buy-here-pay-here":["lot","payment","showroom"],"solutions/independent-dealers":["lot","showroom","inquiry"],"solutions/franchise-dealers":["franchise","banners","review"],
 "solutions/dealer-groups":["franchise","reporting","location"],"solutions/keep-your-website":["desk","chat","conversation"],
 "resources/measuring-test-drives":["road","reporting","conversation"],"resources/vehicle-page-checklist":["lot","showroom","payment"],"resources/walkthroughs":["approach","concierge","inquiry"],"partners/integrations":["desk","feed","conversation"],"ads-management":["road","campaign","reporting"]
};
const categoryArt={oem:"franchise",company:"approach",solutions:"lot",resources:"road",partners:"desk",products:"franchise",contact:"desk"};
function media(key){const [first,slug]=key.split("/");return (first==="products"&&slug?productMap[slug]:otherMap[key])||[categoryArt[first]||"approach"];}
function art(k){const [alt]=imagery[k];return '<picture class="es-photo"><source media="(max-width:650px)" srcset="/editorial/'+k+'-small.webp"><img src="/editorial/'+k+'.webp" alt="'+h(alt)+'" width="1440" height="960" fetchpriority="high"></picture>';}
function screen(k,primary=false){
 const [name,text]=screens[k];
 return '<figure class="es-screen'+(primary?' es-screen-main':'')+'"><a class="es-frame" href="/platform/'+k+'.webp" target="_blank" rel="noopener" aria-label="Open full-size screenshot of '+h(name)+'"><img src="/platform/'+k+'.webp" alt="'+h(name+'. '+text)+'" loading="lazy" decoding="async"><span aria-hidden="true">↗</span></a><figcaption><strong>'+h(name)+'</strong><p>'+h(text)+'</p></figcaption></figure>';
}
function platformProof(key,planned){
 const [,first,second]=media(key);if(!first)return "";
 const related=planned||key==="products/front-desk";
 const label=related?"Related platform screens":"Inside the platform";
 const intro=planned?"These screens show the tools a dealer can use today alongside this planned product.":key==="products/front-desk"?"These screens show the dealership’s follow-up workspace. Ask for a live phone demonstration to hear the receptionist.":"Select a screenshot to inspect the controls at full size. Screens use demonstration inventory and shopper records.";
 return '<section class="es-proof" id="platform-screens"><div class="es-wrap"><div class="es-sectionhead"><h2>'+label+'</h2><p>'+h(intro)+'</p></div><div class="es-gallery">'+screen(first,true)+(second?screen(second):"")+'</div></div></section>';
}
function steps(e){
 return '<section class="es-story es-wrap"><div class="es-storyhead"><h2>'+h(e.headline)+'</h2><p>'+h(e.intro)+'</p></div><div class="es-method">'+e.sections.map(s=>'<section><h3>'+h(s.title)+'</h3><p>'+h(s.text)+'</p>'+(s.source?'<a class="es-source" href="'+h(s.source.url)+'">'+h(s.source.label)+' ↗</a>':'')+'</section>').join("")+'</div></section>';
}
function qa(e){
 return '<section class="es-faq es-wrap"><h2>Questions dealers ask</h2><div>'+e.faq.map(f=>'<details><summary>'+h(f.question)+'</summary><p>'+h(f.answer)+'</p></details>').join('')+'</div></section>';
}
function close(e){return '<section class="es-close"><div class="es-wrap"><div><h2>'+h(e.demo.title)+'</h2><p>'+h(e.demo.text)+'</p></div><a class="catalog-action" href="/#book-demo">Book a meeting with our team <span aria-hidden="true">↗</span></a></div></section>';}
export function editorialPage({key,trail,heading,desc,topic,actions="",fields="",status="",collection="",related=""}){
 const e=editorialFor({key}),[photo]=media(key),proof=platformProof(key,status==="Planned");
 const hero='<section class="es-hero"><div class="es-wrap es-herogrid"><div class="es-lead">'+trail+'<p class="es-topic">'+h(topic)+'</p><h1>'+h(heading)+'</h1>'+(status?'<strong class="es-status">'+h(status)+'</strong>':'')+'<p class="es-deck">'+h(desc)+'</p><div class="catalog-actions">'+actions+(proof?'<a class="es-jump" href="#platform-screens">View platform screens ↓</a>':'')+'</div>'+fields+'</div>'+art(photo)+'</div></section>';
 return hero+(collection?'<div class="es-directory es-wrap">'+collection+'</div>':'')+proof+steps(e)+qa(e)+close(e)+(related?'<section class="catalog-related es-wrap"><h2>Explore next</h2>'+related+'</section>':'');
}
export function commerceEditorial(key){
 const e=editorialFor({key});return '<div class="es-commerce">'+(key==="ads-management"?platformProof(key,false):'')+steps(e)+qa(e)+'</div>';
}
