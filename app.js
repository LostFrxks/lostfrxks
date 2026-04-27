(function () {
  const canvas = document.getElementById('matrix-canvas');
  const context = canvas.getContext('2d');
  const introScreen = document.getElementById('intro-screen');
  const introRain = document.getElementById('intro-rain');
  const introRainContext = introRain ? introRain.getContext('2d') : null;
  const introName = document.querySelector('[data-intro-name]');
  const commands = document.querySelectorAll('[data-target]');
  const bootLines = document.querySelectorAll('[data-boot-text]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealGroups = [
    { selector: '.site-header', type: 'chrome' },
    { selector: '.hero', type: 'hero' },
    { selector: '.terminal-window, .identity-panel, .command-dock', type: 'panel' },
    { selector: 'main > .section-band:not(.hero)', type: 'section' },
    {
      selector:
        '.project-card, .stack-card, .achievement-card, .timeline li, .contact-actions > a, .mock-socials a',
      type: 'item',
    },
  ];

  const glyphs = '01{}[]<>/\\$#@lostfrxksARTURPYTSFASTAPI';
  const matrixFontSize = 16;
  const matrixColumnWidth = 18;
  const matrixRainSpeed = 0.24;
  const matrixTrailMin = 5;
  const matrixTrailMax = 18;
  const matrixGlyphRefreshFrames = 72;
  const matrixFrameClearAlpha = 1;
  const matrixRespawnGapMax = 18;
  const introRainAlphabet = introRain ? introRain.getAttribute('data-rain-alphabet') : glyphs;
  const introNameAlphabet = '01{}[]<>/\\$#@ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const introRainNormalSpeed = 1;
  const introRainDecryptSpeed = 0.24;
  const introRainNormalGlyphRefreshFrames = 4;
  const introRainDecryptGlyphRefreshFrames = 180;
  const introRainNormalTrailAlpha = 0.12;
  const introRainDecryptTrailAlpha = 0.18;
  const revealTargets = [];
  let columns = [];
  let introRainColumns = [];
  let introRainSpeed = introRainNormalSpeed;
  let introRainTargetSpeed = introRainNormalSpeed;
  let introRainFrame = 0;
  let animationId = 0;
  let introRainAnimationId = 0;
  let introNameTimer = 0;
  let introDecryptTimer = 0;
  let introDismissed = false;
  let revealStarted = false;
  let revealObserver = null;
  let matrixFrame = 0;

  function randomFromAlphabet(alphabet) {
    return alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  function createMatrixColumn(height, spawnAbove) {
    const trailLength = matrixTrailMin + Math.floor(Math.random() * (matrixTrailMax - matrixTrailMin + 1));
    const y = spawnAbove
      ? -matrixColumnWidth * (trailLength + 1 + Math.floor(Math.random() * matrixRespawnGapMax))
      : Math.floor(Math.random() * height);
    return {
      y,
      trailLength,
      refreshOffset: Math.floor(Math.random() * matrixGlyphRefreshFrames),
      glyphs: Array.from({ length: trailLength + 1 }, () => randomFromAlphabet(glyphs)),
    };
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.dataset.matrixStyle = 'intro-rain';
    canvas.dataset.rainAlphabet = introRainAlphabet;
    canvas.dataset.fontSize = String(matrixFontSize);
    canvas.dataset.columnWidth = String(matrixColumnWidth);
    canvas.dataset.rainSpeed = matrixRainSpeed.toFixed(2);
    canvas.dataset.trailRange = `${matrixTrailMin}-${matrixTrailMax}`;
    canvas.dataset.glyphRefreshFrames = String(matrixGlyphRefreshFrames);
    canvas.dataset.glyphRefreshMode = 'staggered-slow';
    canvas.dataset.frameClearMode = 'crisp';
    canvas.dataset.frameClearAlpha = matrixFrameClearAlpha.toFixed(2);
    canvas.dataset.respawnMode = 'after-full-trail-exit';

    const columnCount = Math.ceil(window.innerWidth / matrixColumnWidth);
    columns = Array.from({ length: columnCount }, () => createMatrixColumn(window.innerHeight));
    canvas.dataset.trailLengths = columns.slice(0, 18).map((column) => column.trailLength).join(',');
    drawMatrixFrame(true);
  }

  function drawMatrixFrame(clear) {
    const frameClearAlpha = Number(canvas.dataset.frameClearAlpha || matrixFrameClearAlpha);
    if (clear || frameClearAlpha >= 1) {
      context.fillStyle = '#020403';
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
    } else {
      context.fillStyle = `rgba(2, 4, 3, ${frameClearAlpha})`;
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }

    const fontSize = Number(canvas.dataset.fontSize || matrixFontSize);
    const columnWidth = Number(canvas.dataset.columnWidth || matrixColumnWidth);
    const rainSpeed = Number(canvas.dataset.rainSpeed || matrixRainSpeed);
    const refreshFrames = Number(canvas.dataset.glyphRefreshFrames || matrixGlyphRefreshFrames);
    const alphabet = canvas.dataset.rainAlphabet || glyphs;
    context.font = `${fontSize}px JetBrains Mono, Consolas, monospace`;
    context.textBaseline = 'top';
    matrixFrame += 1;

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const x = index * columnWidth;
      const y = column.y;

      for (let segment = column.trailLength; segment >= 0; segment -= 1) {
        const segmentY = y - segment * columnWidth;
        if (segmentY < -columnWidth || segmentY > window.innerHeight + columnWidth) {
          continue;
        }

        const glyphIndex = column.trailLength - segment;
        const shouldRefreshGlyph =
          (matrixFrame + column.refreshOffset + glyphIndex * 17) % refreshFrames === 0;
        if (!column.glyphs[glyphIndex] || shouldRefreshGlyph) {
          column.glyphs[glyphIndex] = randomFromAlphabet(alphabet);
        }

        const glyph = column.glyphs[glyphIndex];
        const alpha = segment === 0 ? 1 : Math.max(0.12, 1 - segment / (column.trailLength + 1));
        const isHighlight = segment === 0 && index % 9 === 0;
        context.fillStyle = isHighlight
          ? `rgba(101, 231, 255, ${alpha})`
          : `rgba(92, 255, 177, ${alpha})`;
        context.fillText(glyph, x, segmentY);
      }

      const fullTrailExitY = window.innerHeight + (column.trailLength + 1) * columnWidth;
      if (y > fullTrailExitY) {
        columns[index] = createMatrixColumn(0, true);
      } else {
        column.y = y + columnWidth * rainSpeed;
      }
    }
  }

  function animateMatrix() {
    drawMatrixFrame(false);
    animationId = window.requestAnimationFrame(animateMatrix);
  }

  function setupMatrixReveals() {
    const seen = new Set();

    revealGroups.forEach((group) => {
      document.querySelectorAll(group.selector).forEach((element, index) => {
        if (seen.has(element)) {
          return;
        }

        seen.add(element);
        element.classList.add('matrix-reveal');
        element.setAttribute('data-matrix-reveal', group.type);
        revealTargets.push(element);
      });
    });
  }

  function revealElement(element, order) {
    if (!element || element.classList.contains('matrix-revealed')) {
      return;
    }

    const delay = reducedMotion ? 0 : Math.min(order * 80, 520);
    element.style.setProperty('--reveal-delay', `${delay}ms`);
    element.classList.add('matrix-revealed');
  }

  function revealChildren(container) {
    const children = Array.from(
      container.querySelectorAll('[data-matrix-reveal="panel"], [data-matrix-reveal="item"]')
    );
    children.forEach((child, index) => revealElement(child, index + 1));
  }

  function revealBlock(element, order) {
    revealElement(element, order);
    revealChildren(element);
  }

  function startMatrixReveals() {
    if (revealStarted) {
      return;
    }

    revealStarted = true;
    document.body.classList.add('matrix-reveal-live');

    if (reducedMotion) {
      revealTargets.forEach((element) => revealElement(element, 0));
      return;
    }

    revealElement(document.querySelector('.site-header'), 0);
    revealBlock(document.querySelector('.hero'), 1);

    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          revealBlock(entry.target, 0);
          revealObserver.unobserve(entry.target);
        });
      },
      {
        rootMargin: '0px 0px -18% 0px',
        threshold: 0.18,
      }
    );

    document.querySelectorAll('[data-matrix-reveal="section"]').forEach((section) => {
      revealObserver.observe(section);
    });
  }

  function randomIntroChar() {
    return introNameAlphabet[Math.floor(Math.random() * introNameAlphabet.length)];
  }

  function randomRainChar() {
    return randomFromAlphabet(introRainAlphabet);
  }

  function createIntroRainColumn(height) {
    return {
      y: Math.floor(Math.random() * height),
      glyph: randomRainChar(),
      refreshOffset: Math.floor(Math.random() * introRainDecryptGlyphRefreshFrames),
    };
  }

  function setIntroRainSpeedMode(mode) {
    if (!introRain) {
      return;
    }

    introRainTargetSpeed = mode === 'decrypting' ? introRainDecryptSpeed : introRainNormalSpeed;
    const refreshFrames =
      mode === 'decrypting' ? introRainDecryptGlyphRefreshFrames : introRainNormalGlyphRefreshFrames;
    const trailAlpha =
      mode === 'decrypting' ? introRainDecryptTrailAlpha : introRainNormalTrailAlpha;
    introRain.dataset.rainSpeedMode = mode;
    introRain.dataset.rainSpeedTarget = introRainTargetSpeed.toFixed(2);
    introRain.dataset.rainSpeedCurrent = introRainSpeed.toFixed(2);
    introRain.dataset.glyphRefreshFrames = String(refreshFrames);
    introRain.dataset.trailAlpha = trailAlpha.toFixed(2);
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

    const fontSize = matrixFontSize;
    const columnWidth = matrixColumnWidth;
    introRain.dataset.fontSize = String(fontSize);
    introRain.dataset.columnWidth = String(columnWidth);
    const columnCount = Math.ceil(window.innerWidth / columnWidth);
    introRainColumns = Array.from(
      { length: columnCount },
      () => createIntroRainColumn(window.innerHeight)
    );
    drawIntroRainFrame(true);
  }

  function drawIntroRainFrame(clear) {
    if (!introRainContext) {
      return;
    }

    const fontSize = Number(introRain.dataset.fontSize || 22);
    const columnWidth = Number(introRain.dataset.columnWidth || matrixColumnWidth);
    const refreshFrames = Number(introRain.dataset.glyphRefreshFrames || introRainNormalGlyphRefreshFrames);
    const trailAlpha =
      introRainTargetSpeed < introRainNormalSpeed ? introRainDecryptTrailAlpha : introRainNormalTrailAlpha;
    introRain.dataset.trailAlpha = trailAlpha.toFixed(2);
    if (clear) {
      introRainSpeed = introRainTargetSpeed;
    } else {
      introRainSpeed += (introRainTargetSpeed - introRainSpeed) * 0.08;
    }

    introRain.dataset.rainSpeedCurrent = introRainSpeed.toFixed(2);
    introRainContext.fillStyle = clear ? '#020403' : `rgba(2, 4, 3, ${trailAlpha})`;
    introRainContext.fillRect(0, 0, window.innerWidth, window.innerHeight);
    introRainContext.font = `${fontSize}px JetBrains Mono, Consolas, monospace`;
    introRainContext.textBaseline = 'top';
    introRainFrame += 1;

    for (let index = 0; index < introRainColumns.length; index += 1) {
      const column = introRainColumns[index];
      const x = index * columnWidth;
      const y = column.y;

      if (!column.glyph || (introRainFrame + column.refreshOffset) % refreshFrames === 0) {
        column.glyph = randomRainChar();
      }

      introRainContext.fillStyle = index % 9 === 0 ? '#65e7ff' : '#5cffb1';
      introRainContext.fillText(column.glyph, x, y);

      if (y > window.innerHeight + Math.random() * 700) {
        introRainColumns[index] = createIntroRainColumn(0);
        introRainColumns[index].y = -columnWidth * Math.floor(Math.random() * 12);
      } else {
        column.y = y + columnWidth * introRainSpeed;
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

    setIntroRainSpeedMode('normal');
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
    window.setTimeout(startMatrixReveals, reducedMotion ? 0 : 260);
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
    setIntroRainSpeedMode('decrypting');
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
        window.setTimeout(() => revealBlock(target, 0), reducedMotion ? 0 : 260);
      }
    });
  });

  setupMatrixReveals();

  if (introScreen) {
    introScreen.addEventListener('click', dismissIntro);
    startIntro();
  } else {
    document.body.classList.remove('intro-active');
    startMatrixReveals();
    bootTerminal();
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
    resizeIntroRain();
  });
  resizeCanvas();

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
    if (revealObserver) {
      revealObserver.disconnect();
    }
  });
})();
