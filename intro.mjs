const ALPHABET = '01{}[]<>/\\$#@ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DECRYPT_MS = 760;
const HOLD_MS = 700;
const REVEAL_AT_MS = DECRYPT_MS + HOLD_MS;
const COMPLETE_AT_MS = REVEAL_AT_MS + 420;

// One clock owns the complete transition; slow frames never add chained delays.
export function createIntroController({ screen, name, browserWindow = window, browserDocument = document, onReveal, onComplete }) {
  const reducedMotion = browserWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finalText = name.getAttribute('data-final-text') || name.textContent;
  const letterCount = finalText.replaceAll(' ', '').length;
  let startedAt = null;
  let pausedAt = null;
  let frameId = null;
  let lastCipherFrame = -1;
  let revealed = false;
  let destroyed = false;
  screen.dataset.introPhase = 'idle';

  function renderCipher(lockedCount, frame) {
    let seen = 0;
    const text = [...finalText].map((char, index) => {
      if (char === ' ') return char;
      if (seen++ < lockedCount) return char;
      const candidate = ALPHABET[(frame * 11 + index * 7) % ALPHABET.length];
      return candidate === char ? ALPHABET[(frame * 11 + index * 7 + 1) % ALPHABET.length] : candidate;
    }).join('');
    if (name.textContent !== text) name.textContent = text;
  }

  function schedule() {
    if (!destroyed && !reducedMotion && frameId === null && browserDocument.visibilityState !== 'hidden') frameId = browserWindow.requestAnimationFrame(tick);
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    screen.dataset.introPhase = 'exiting';
    screen.classList.add('intro-exiting');
    onReveal();
  }

  function tick(timestamp) {
    frameId = null;
    if (destroyed || browserDocument.visibilityState === 'hidden') return;
    if (startedAt === null) {
      const frame = Math.floor(timestamp / 110);
      if (frame !== lastCipherFrame) { renderCipher(0, frame); lastCipherFrame = frame; }
    } else {
      const elapsed = Math.max(0, timestamp - startedAt);
      const progress = Math.min(1, elapsed / DECRYPT_MS);
      const frame = Math.floor(elapsed / 55);
      if (frame !== lastCipherFrame) { renderCipher(Math.floor(letterCount * progress), frame); lastCipherFrame = frame; }
      screen.style.setProperty('--intro-progress', progress.toFixed(3));
      if (elapsed >= DECRYPT_MS) {
        if (name.textContent !== finalText) name.textContent = finalText;
        screen.dataset.introPhase = revealed ? 'exiting' : 'resolved';
        screen.classList.add('intro-resolved');
      }
      if (elapsed >= REVEAL_AT_MS) reveal();
      if (elapsed >= COMPLETE_AT_MS) {
        screen.dataset.introPhase = 'complete';
        destroy();
        onComplete();
        return;
      }
    }
    schedule();
  }

  function activate() {
    if (destroyed || startedAt !== null) return;
    startedAt = browserWindow.performance.now();
    lastCipherFrame = -1;
    screen.dataset.introPhase = 'decrypting';
    screen.classList.add('intro-revealing');
    if (reducedMotion) {
      name.textContent = finalText;
      reveal();
      screen.dataset.introPhase = 'complete';
      destroy();
      onComplete();
    } else schedule();
  }

  function onVisibilityChange() {
    const now = browserWindow.performance.now();
    if (browserDocument.visibilityState === 'hidden') {
      if (pausedAt === null) pausedAt = now;
      if (frameId !== null) browserWindow.cancelAnimationFrame(frameId);
      frameId = null;
    } else {
      if (pausedAt !== null && startedAt !== null) startedAt += now - pausedAt;
      pausedAt = null;
      schedule();
    }
  }

  function destroy() {
    destroyed = true;
    if (frameId !== null) browserWindow.cancelAnimationFrame(frameId);
    frameId = null;
    screen.removeEventListener('click', activate);
    browserDocument.removeEventListener('visibilitychange', onVisibilityChange);
  }

  screen.addEventListener('click', activate);
  browserDocument.addEventListener('visibilitychange', onVisibilityChange);
  if (reducedMotion) name.textContent = finalText;
  else { renderCipher(0, 0); schedule(); }
  return { destroy };
}
