(() => {
  const word = document.querySelector("#hero-word");
  const title = word.closest("h1");
  const phrases = ["Website.", "Phone System.", "Live Chat."];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let timer;
  function start() {
    clearTimeout(timer);
    const animate = !motion.matches;
    title.classList.toggle("is-typing", animate);
    let index = 0;
    let length = 0;
    let erasing = false;
    word.textContent = "";
    if (document.hidden) return;
    function tick() {
      length += erasing ? -1 : 1;
      word.textContent = phrases[index].slice(0, length);
      let delay = erasing ? 46 : 82;
      if (length === 0) {
        index = (index + 1) % phrases.length;
        erasing = false;
        delay = 220;
      } else if (length === phrases[index].length) {
        erasing = true;
        delay = 2100;
      }
      timer = setTimeout(tick, delay);
    }
    timer = setTimeout(tick, 240);
  }
  motion.addEventListener("change", start);
  document.addEventListener("visibilitychange", start);
  start();
})();
