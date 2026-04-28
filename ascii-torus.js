(function () {
  const root = document.getElementById('ascii-torus');
  if (!root || root.hidden) {
    return;
  }

  const output = root.querySelector('[data-ascii-torus-output]');
  const stateLabel = root.querySelector('[data-ascii-torus-state]');
  const shell = root.querySelector('.ascii-torus-shell');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const luminance = '.,-~:;=!*#$@';
  const width = 104;
  const height = 58;
  const centerX = width / 2;
  const centerY = height / 2;
  const majorRadius = 1.08;
  const tubeRadius = 0.46;
  const distance = 2.9;
  const scale = 33;
  const dragRotationSpeed = 0.0068;
  const dragInertiaSpeed = 0.00052;

  let debugRotationX = 0.78;
  let debugRotationY = -0.34;
  let debugRotationZ = 0.18;
  let velocityX = reducedMotion ? 0 : 0.0036;
  let velocityY = reducedMotion ? 0 : 0.008;
  let velocityZ = reducedMotion ? 0 : 0.0024;
  let isDragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let frameId = null;
  let revealStarted = false;
  let revealStartTime = 0;
  let revealProgress = 0;
  let lastRenderedLines = Array(height).fill(' '.repeat(width));

  function multiplyMatrices(a, b) {
    return [
      a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
      a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
      a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
      a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
      a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
      a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
      a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
      a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
      a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ];
  }

  function rotationMatrixX(angle) {
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    return [1, 0, 0, 0, cosine, -sine, 0, sine, cosine];
  }

  function rotationMatrixY(angle) {
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    return [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine];
  }

  function rotationMatrixZ(angle) {
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    return [cosine, -sine, 0, sine, cosine, 0, 0, 0, 1];
  }

  let orientation = multiplyMatrices(
    rotationMatrixZ(debugRotationZ),
    multiplyMatrices(rotationMatrixY(debugRotationY), rotationMatrixX(debugRotationX))
  );

  function rotatePoint(x, y, z) {
    return [
      orientation[0] * x + orientation[1] * y + orientation[2] * z,
      orientation[3] * x + orientation[4] * y + orientation[5] * z,
      orientation[6] * x + orientation[7] * y + orientation[8] * z,
    ];
  }

  function applyScreenRotation(angleX, angleY, angleZ) {
    const screenRotation = multiplyMatrices(
      rotationMatrixZ(angleZ),
      multiplyMatrices(rotationMatrixX(angleX), rotationMatrixY(angleY))
    );
    orientation = multiplyMatrices(screenRotation, orientation);
    debugRotationX += angleX;
    debugRotationY += angleY;
    debugRotationZ += angleZ;
  }

  function renderTorus() {
    const chars = Array(width * height).fill(' ');
    const depth = Array(width * height).fill(-Infinity);
    const light = rotatePoint(-0.32, 0.74, -1.12);
    const lightLength = Math.hypot(light[0], light[1], light[2]) || 1;
    const lightX = light[0] / lightLength;
    const lightY = light[1] / lightLength;
    const lightZ = light[2] / lightLength;
    let clippedPoints = 0;

    for (let theta = 0; theta < Math.PI * 2; theta += 0.14) {
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      for (let phi = 0; phi < Math.PI * 2; phi += 0.052) {
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        const ring = majorRadius + tubeRadius * cosTheta;
        const x = ring * cosPhi;
        const y = tubeRadius * sinTheta;
        const z = ring * sinPhi;
        const normal = rotatePoint(cosTheta * cosPhi, sinTheta, cosTheta * sinPhi);
        const point = rotatePoint(x, y, z);
        const inverseZ = 1 / (point[2] + distance);
        const projectedX = Math.floor(centerX + scale * inverseZ * point[0] * 1.78);
        const projectedY = Math.floor(centerY - scale * inverseZ * point[1]);

        if (projectedX < 0 || projectedX >= width || projectedY < 0 || projectedY >= height) {
          clippedPoints += 1;
          continue;
        }

        const index = projectedX + projectedY * width;
        if (inverseZ <= depth[index]) {
          continue;
        }

        depth[index] = inverseZ;
        const brightness = Math.max(0, normal[0] * lightX + normal[1] * lightY + normal[2] * lightZ);
        const glyphIndex = Math.min(luminance.length - 1, Math.floor(brightness * (luminance.length - 1)));
        chars[index] = luminance[glyphIndex];
      }
    }

    const centeredChars = centerGlyphBuffer(chars);
    const lines = [];
    for (let row = 0; row < height; row += 1) {
      lines.push(centeredChars.slice(row * width, row * width + width).join(''));
    }

    lastRenderedLines = lines;
    output.textContent = maskRevealLines(lines).join('\n');
    root.dataset.torusRotation = [debugRotationX, debugRotationY, debugRotationZ]
      .map((value) => value.toFixed(3))
      .join(',');
    root.dataset.torusClippedPoints = String(clippedPoints);
  }

  function centerGlyphBuffer(chars) {
    const occupied = [];
    chars.forEach((char, index) => {
      if (char !== ' ') {
        occupied.push({
          column: index % width,
          row: Math.floor(index / width),
        });
      }
    });

    if (!occupied.length) {
      return chars;
    }

    const minColumn = Math.min(...occupied.map((point) => point.column));
    const maxColumn = Math.max(...occupied.map((point) => point.column));
    const minRow = Math.min(...occupied.map((point) => point.row));
    const maxRow = Math.max(...occupied.map((point) => point.row));
    const shiftX = Math.round(width / 2 - (minColumn + maxColumn + 1) / 2);
    const shiftY = Math.round(height / 2 - (minRow + maxRow + 1) / 2);

    if (shiftX === 0 && shiftY === 0) {
      return chars;
    }

    const centered = Array(width * height).fill(' ');
    chars.forEach((char, index) => {
      if (char === ' ') {
        return;
      }

      const column = index % width;
      const row = Math.floor(index / width);
      const shiftedColumn = column + shiftX;
      const shiftedRow = row + shiftY;
      if (shiftedColumn < 0 || shiftedColumn >= width || shiftedRow < 0 || shiftedRow >= height) {
        return;
      }

      centered[shiftedColumn + shiftedRow * width] = char;
    });

    return centered;
  }

  function maskRevealLines(lines) {
    if (revealProgress >= 1) {
      root.dataset.torusReveal = 'complete';
      return lines;
    }

    if (!revealStarted) {
      root.dataset.torusReveal = 'idle';
      return lines.map((line) => line.replace(/[^\n]/g, ' '));
    }

    root.dataset.torusReveal = 'running';
    const easedProgress = 1 - Math.pow(1 - revealProgress, 3);
    const threshold = easedProgress * (width + height + 20);

    return lines.map((line, row) =>
      [...line]
        .map((char, column) => {
          if (char === ' ') {
            return ' ';
          }
          const noise = ((column * 17 + row * 31) % 19) - 9;
          return column + row * 0.75 + noise <= threshold ? char : ' ';
        })
        .join('')
    );
  }

  function startReveal() {
    if (revealStarted) {
      return;
    }

    revealStarted = true;
    revealStartTime = performance.now();
    revealProgress = reducedMotion ? 1 : 0.02;
    renderTorus();
  }

  function tick() {
    if (!revealStarted && root.classList.contains('matrix-revealed')) {
      startReveal();
    }

    if (revealStarted && revealProgress < 1) {
      revealProgress = Math.min(1, (performance.now() - revealStartTime) / 1150);
    }

    if (!isDragging) {
      applyScreenRotation(velocityX, velocityY, velocityZ);
      velocityX *= 0.992;
      velocityY *= 0.992;
      velocityZ *= 0.994;

      if (!reducedMotion) {
        velocityX += 0.000018;
        velocityY += 0.00004;
        velocityZ += 0.000012;
      }
    }

    renderTorus();

    if (!reducedMotion) {
      frameId = window.requestAnimationFrame(tick);
    }
  }

  function setState(text) {
    if (stateLabel) {
      stateLabel.textContent = text;
    }
  }

  function onPointerDown(event) {
    if (!shell) {
      return;
    }

    isDragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    velocityX = 0;
    velocityY = 0;
    velocityZ = 0;
    shell.classList.add('is-dragging');
    shell.setPointerCapture?.(event.pointerId);
    setState('locked to input');
  }

  function onPointerMove(event) {
    if (!isDragging) {
      return;
    }

    const deltaX = event.clientX - lastPointerX;
    const deltaY = event.clientY - lastPointerY;
    const angleY = -deltaX * dragRotationSpeed;
    const angleX = -deltaY * dragRotationSpeed;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    applyScreenRotation(angleX, angleY, 0);
    velocityY = -deltaX * dragInertiaSpeed;
    velocityX = -deltaY * dragInertiaSpeed;
    velocityZ = 0;
    renderTorus();
  }

  function onPointerUp(event) {
    if (!isDragging) {
      return;
    }

    isDragging = false;
    shell?.classList.remove('is-dragging');
    shell?.releasePointerCapture?.(event.pointerId);
    setState('inertia drift');
  }

  window.__asciiTorusDebug = {
    applyScreenRoll(angle) {
      applyScreenRotation(0, 0, angle);
      renderTorus();
    },
    startReveal,
  };

  const revealObserver = new MutationObserver(() => {
    if (root.classList.contains('matrix-revealed')) {
      startReveal();
    }
  });
  revealObserver.observe(root, { attributes: true, attributeFilter: ['class'] });

  if (shell && !reducedMotion) {
    shell.addEventListener('pointerdown', onPointerDown);
    shell.addEventListener('pointermove', onPointerMove);
    shell.addEventListener('pointerup', onPointerUp);
    shell.addEventListener('pointercancel', onPointerUp);
    shell.addEventListener('pointerleave', onPointerUp);
  }

  renderTorus();
  if (reducedMotion) {
    startReveal();
    setState('static render');
  } else {
    frameId = window.requestAnimationFrame(tick);
  }

  window.addEventListener('beforeunload', () => {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }
    revealObserver.disconnect();
  });
})();
