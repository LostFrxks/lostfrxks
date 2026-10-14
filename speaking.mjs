const SLIDE_TITLES = [
  '250,000 products. One pipeline.', 'Artur Usenov · MMarket', 'The catalog problem',
  'The catalog before', 'Processing one product', '50 products per agent',
  'One orchestrator. 40 agents.', 'The complete pipeline', 'Attribute upload results',
  'Product card: before and after', 'Attributes become filters', 'Skills', 'MCP',
  'Logs and memory', 'Questions and contacts',
];

export function setupSpeaking() {
  const section = document.getElementById('talks');
  const dialog = document.getElementById('talk-deck');
  if (!section || !dialog) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  function updateMotion() {
    section.dataset.talkMotion = visible && !reduced.matches && document.visibilityState !== 'hidden' ? 'running' : 'paused';
  }
  const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); updateMotion(); });
  observer.observe(section);
  document.addEventListener('visibilitychange', updateMotion);
  reduced.addEventListener('change', updateMotion);

  const image = dialog.querySelector('[data-talk-slide]');
  const counter = dialog.querySelector('[data-talk-counter]');
  const caption = dialog.querySelector('[data-talk-caption]');
  const previous = dialog.querySelector('[data-talk-previous]');
  const next = dialog.querySelector('[data-talk-next]');
  let index = 0;
  let trigger;
  let gesture;
  function showSlide(value) {
    const focusedControl = document.activeElement;
    index = Math.max(0, Math.min(SLIDE_TITLES.length - 1, value));
    const number = String(index + 1).padStart(2, '0');
    image.src = `assets/talks/mdconf-2026/slide-${number}.png`;
    image.alt = `Slide ${index + 1} of 15: ${SLIDE_TITLES[index]}`;
    counter.textContent = `${number} / 15`;
    caption.textContent = SLIDE_TITLES[index];
    previous.disabled = index === 0;
    next.disabled = index === SLIDE_TITLES.length - 1;
    if (focusedControl === previous && previous.disabled) next.focus();
    else if (focusedControl === next && next.disabled) previous.focus();
  }
  section.querySelectorAll('[data-open-talk]').forEach(button => button.addEventListener('click', () => {
    trigger = button;
    showSlide(0);
    dialog.showModal();
    document.body.classList.add('deck-open');
  }));
  previous.addEventListener('click', () => showSlide(index - 1));
  next.addEventListener('click', () => showSlide(index + 1));
  dialog.querySelector('[data-talk-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { document.body.classList.remove('deck-open'); trigger?.focus(); });
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') showSlide(0);
      else if (event.key === 'End') showSlide(SLIDE_TITLES.length - 1);
      else showSlide(index + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  image.addEventListener('pointerdown', event => { gesture = { x: event.clientX, y: event.clientY }; });
  image.addEventListener('pointerup', event => {
    if (gesture && Math.abs(event.clientX - gesture.x) > 45 && Math.abs(event.clientY - gesture.y) < 70) showSlide(index + (event.clientX < gesture.x ? 1 : -1));
    gesture = null;
  });
  image.addEventListener('pointercancel', () => { gesture = null; });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer.disconnect();
    document.removeEventListener('visibilitychange', updateMotion);
    reduced.removeEventListener('change', updateMotion);
  });
}
