(() => {
  const word = document.querySelector("#hero-word");
  const title = word.closest("h1");
  const phrases = ["Website.", "Phone System.", "Live Chat."];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let timer;
  function start() {
    clearTimeout(timer);
    const animate = !motion.matches && !document.hidden;
    title.classList.toggle("is-typing", animate);
    let index = 0;
    let length = phrases[0].length;
    let erasing = true;
    word.textContent = phrases[0];
    if (document.hidden) return;
    if (motion.matches) {
      function swapPhrase() {
        index = (index + 1) % phrases.length;
        word.textContent = phrases[index];
        timer = setTimeout(swapPhrase, 3000);
      }
      timer = setTimeout(swapPhrase, 2200);
      return;
    }
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
    timer = setTimeout(tick, 1100);
  }
  motion.addEventListener("change", start);
  document.addEventListener("visibilitychange", start);
  start();
})();
