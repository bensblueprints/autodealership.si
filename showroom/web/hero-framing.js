const HeroFraming = (() => {
  const positions = ["left top","center top","right top","left center","center center","right center","left bottom","center bottom","right bottom"];
  const valid = value => value && positions.includes(value.desktop) && positions.includes(value.mobile);
  const defaults = {desktop:"center center", mobile:"center center"};
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  function markup({photo, art, focus}, name) {
    const artwork = /^[a-f0-9]{64}$/.test(art || "");
    if (!artwork && !photo) return "";
    const frame = valid(focus) ? focus : defaults;
    const directory = "api/template-art/" + art + "/";
    const source = artwork ? '<source media="(max-width:700px)" srcset="'+directory+'mobile.jpg">' : "";
    const src = artwork ? directory+"desktop.jpg" : photo;
    return '<section id="published-hero" class="hero template-art-hero" aria-label="Dealership showroom" style="--hero-desktop-position:'+frame.desktop+';--hero-mobile-position:'+frame.mobile+'">'+
      '<picture>'+source+'<img fetchpriority="high" alt="" src="'+escape(src)+'"></picture><div class="scrim"></div>'+
      '<div class="herotext"><div class="eyebrow">Our showroom</div><h1>'+escape(name)+'</h1><div class="actions">'+
      '<a class="primary" href="#inventory">Browse inventory</a><button type="button" class="secondary" data-hero-concierge hidden>Ask concierge</button></div></div></section>';
  }
  return {positions,valid,defaults,markup};
})();
