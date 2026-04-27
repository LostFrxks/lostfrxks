(function () {
  const canvas = document.getElementById('matrix-canvas');
  const context = canvas.getContext('2d');
  const introScreen = document.getElementById('intro-screen');
  const introRain = document.getElementById('intro-rain');
  const introRainContext = introRain ? introRain.getContext('2d') : null;
  const introName = document.querySelector('[data-intro-name]');
  const toggle = document.getElementById('matrix-toggle');
  const commands = document.querySelectorAll('[data-target]');
  const bootLines = document.querySelectorAll('[data-boot-text]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const glyphs = '01{}[]<>/\\$#@lostfrxksARTURPYTSFASTAPI';
  const introRainAlphabet = introRain ? introRain.getAttribute('data-rain-alphabet') : '漢アイ가А01{}[]';
  const introNameAlphabet = '01{}[]<>/\\$#@ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let columns = [];
  let introRainColumns = [];
  let animationId = 0;
  let introRainAnimationId = 0;
  let introNameTimer = 0;
  let introDecryptTimer = 0;
  let introDismissed = false;
  let matrixEnabled = true;

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const columnCount = Math.ceil(window.innerWidth / 18);
    columns = Array.from({ length: columnCount }, () => Math.floor(Math.random() * window.innerHeight));
    drawMatrixFrame(true);
  }

  function drawMatrixFrame(clear) {
    if (clear) {
      context.fillStyle = '#020403';
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
    } else {
      context.fillStyle = matrixEnabled ? 'rgba(2, 4, 3, 0.12)' : 'rgba(2, 4, 3, 0.28)';
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }

    context.font = '16px JetBrains Mono, monospace';
    context.textBaseline = 'top';

    for (let index = 0; index < columns.length; index += 1) {
      const x = index * 18;
      const y = columns[index];
      const glyph = glyphs[Math.floor(Math.random() * glyphs.length)];

      context.fillStyle = index % 9 === 0 ? '#65e7ff' : '#5cffb1';
      context.fillText(glyph, x, y);

      if (y > window.innerHeight + Math.random() * 800) {
        columns[index] = 0;
      } else {
        columns[index] = y + (matrixEnabled ? 18 : 8);
      }
    }
  }

  function animateMatrix() {
    drawMatrixFrame(false);
    animationId = window.requestAnimationFrame(animateMatrix);
  }

  function setMatrixState(enabled) {
    matrixEnabled = enabled;
    document.body.classList.toggle('matrix-muted', !enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.innerHTML = enabled ? '<span>$</span> matrix:on' : '<span>$</span> matrix:low';
  }

  function randomIntroChar() {
    return introNameAlphabet[Math.floor(Math.random() * introNameAlphabet.length)];
  }

  function randomRainChar() {
    return introRainAlphabet[Math.floor(Math.random() * introRainAlphabet.length)];
  }

  function scrambleIntroName(lockedCount) {
    const finalText = introName.getAttribute('data-final-text') || 'Artur Usenov';
    return finalText
      .split('')
      .map((char, index) => {
        if (char === ' ') {
          return ' ';
        }
        return index < lockedCount ? char : randomIntroChar();
      })
      .join('');
  }

  function resizeIntroRain() {
    if (!introRain || !introRainContext) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    introRain.width = Math.floor(window.innerWidth * ratio);
    introRain.height = Math.floor(window.innerHeight * ratio);
    introRain.style.width = `${window.innerWidth}px`;
    introRain.style.height = `${window.innerHeight}px`;
    introRainContext.setTransform(ratio, 0, 0, ratio, 0, 0);

    const fontSize = window.innerWidth < 640 ? 18 : 22;
    introRain.dataset.fontSize = String(fontSize);
    const columnCount = Math.ceil(window.innerWidth / fontSize);
    introRainColumns = Array.from(
      { length: columnCount },
      () => Math.floor(Math.random() * window.innerHeight)
    );
    drawIntroRainFrame(true);
  }

  function drawIntroRainFrame(clear) {
    if (!introRainContext) {
      return;
    }

    const fontSize = Number(introRain.dataset.fontSize || 22);
    introRainContext.fillStyle = clear ? '#010604' : 'rgba(1, 6, 4, 0.14)';
    introRainContext.fillRect(0, 0, window.innerWidth, window.innerHeight);
    introRainContext.font = `${fontSize}px JetBrains Mono, Consolas, monospace`;
    introRainContext.textBaseline = 'top';

    for (let index = 0; index < introRainColumns.length; index += 1) {
      const x = index * fontSize;
      const y = introRainColumns[index];
      const char = randomRainChar();

      introRainContext.fillStyle = index % 11 === 0 ? '#dfffee' : '#5cffb1';
      introRainContext.fillText(char, x, y);

      if (y > window.innerHeight + Math.random() * 700) {
        introRainColumns[index] = -fontSize * Math.floor(Math.random() * 12);
      } else {
        introRainColumns[index] = y + fontSize;
      }
    }
  }

  function animateIntroRain() {
    drawIntroRainFrame(false);
    introRainAnimationId = window.requestAnimationFrame(animateIntroRain);
  }

  function startIntro() {
    if (!introScreen) {
      return;
    }

    resizeIntroRain();
    if (reducedMotion) {
      drawIntroRainFrame(false);
    } else {
      introRainAnimationId = window.requestAnimationFrame(animateIntroRain);
    }

    introName.textContent = scrambleIntroName(0);
    introNameTimer = window.setInterval(() => {
      introName.textContent = scrambleIntroName(0);
    }, reducedMotion ? 500 : 70);
  }

  function finishIntro() {
    introScreen.classList.add('intro-hidden');
    if (introRainAnimationId) {
      window.cancelAnimationFrame(introRainAnimationId);
    }
    window.clearInterval(introNameTimer);
    window.clearInterval(introDecryptTimer);
    introScreen.remove();
    window.setTimeout(() => {
      document.body.classList.remove('site-revealing');
    }, 1200);
    bootTerminal();
  }

  function startSiteReveal() {
    introScreen.classList.add('intro-exiting');
    document.body.classList.remove('intro-active');
    document.body.classList.add('site-revealing');
    window.setTimeout(finishIntro, reducedMotion ? 240 : 1350);
  }

  function decryptIntroName() {
    const finalText = introName.getAttribute('data-final-text') || 'Artur Usenov';
    const revealableCount = finalText.replaceAll(' ', '').length;
    let lockedCount = 0;

    introName.textContent = scrambleIntroName(lockedCount);
    introDecryptTimer = window.setInterval(() => {
      lockedCount += 1;

      let targetIndex = 0;
      let nonSpaceSeen = 0;
      while (targetIndex < finalText.length && nonSpaceSeen < lockedCount) {
        if (finalText[targetIndex] !== ' ') {
          nonSpaceSeen += 1;
        }
        targetIndex += 1;
      }

      introName.textContent = scrambleIntroName(targetIndex);

      if (lockedCount >= revealableCount) {
        window.clearInterval(introDecryptTimer);
        introName.textContent = finalText;
        window.setTimeout(startSiteReveal, reducedMotion ? 180 : 700);
      }
    }, reducedMotion ? 60 : 95);
  }

  function dismissIntro() {
    if (!introScreen || introDismissed) {
      return;
    }

    introDismissed = true;
    window.clearInterval(introNameTimer);
    introScreen.classList.add('intro-revealing');
    decryptIntroName();
  }

  function bootTerminal() {
    if (reducedMotion) {
      return;
    }

    bootLines.forEach((line, lineIndex) => {
      const text = line.getAttribute('data-boot-text') || '';
      line.textContent = '';
      window.setTimeout(() => {
        let cursor = 0;
        const timer = window.setInterval(() => {
          line.textContent = text.slice(0, cursor);
          cursor += 1;
          if (cursor > text.length) {
            window.clearInterval(timer);
          }
        }, 18);
      }, 180 * lineIndex);
    });
  }

  commands.forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.target);
      if (target) {
        target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    });
  });

  toggle.addEventListener('click', () => {
    setMatrixState(!matrixEnabled);
  });

  if (introScreen) {
    introScreen.addEventListener('click', dismissIntro);
    startIntro();
  } else {
    document.body.classList.remove('intro-active');
    bootTerminal();
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
    resizeIntroRain();
  });
  resizeCanvas();
  setMatrixState(true);

  if (reducedMotion) {
    drawMatrixFrame(true);
  } else {
    animationId = window.requestAnimationFrame(animateMatrix);
  }

  window.addEventListener('beforeunload', () => {
    if (animationId) {
      window.cancelAnimationFrame(animationId);
    }
    if (introRainAnimationId) {
      window.cancelAnimationFrame(introRainAnimationId);
    }
    window.clearInterval(introNameTimer);
    window.clearInterval(introDecryptTimer);
  });
})();
