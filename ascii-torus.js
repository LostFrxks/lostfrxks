(function () {
  const root = document.getElementById('ascii-torus');
  const mobileViewport = window.matchMedia('(max-width: 680px)').matches;
  if (!root || root.hidden || mobileViewport) {
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
  // Angular speeds are radians per second, independent of display refresh rate.
  const idleVelocity = reducedMotion ? [0, 0, 0] : [0.135, 0.3, 0.12];
  const damping = [-60 * Math.log(0.992), -60 * Math.log(0.992), -60 * Math.log(0.994)];

  let debugRotationX = 0.78;
  let debugRotationY = -0.34;
  let debugRotationZ = 0.18;
  let velocity = reducedMotion ? [0, 0, 0] : [0.216, 0.48, 0.144];
  let activePointerId = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let lastPointerTime = 0;
  let previousFrameTime = null;
  let frameId = null;
  let revealStarted = false;
  let revealStartTime = 0;
  let revealProgress = 0;

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

    // Project around the fixed 3D origin; glyph bounds change as the torus rotates.
    const lines = [];
    for (let row = 0; row < height; row += 1) {
      lines.push(chars.slice(row * width, row * width + width).join(''));
    }

    output.textContent = maskRevealLines(lines).join('\n');
    root.dataset.torusRotation = [debugRotationX, debugRotationY, debugRotationZ]
      .map((value) => value.toFixed(3))
      .join(',');
    root.dataset.torusClippedPoints = String(clippedPoints);
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

  function advanceMotion(seconds) {
    // Integrate damped velocity analytically so inertia also respects elapsed time.
    const angles = velocity.map((speed, axis) => {
      const target = idleVelocity[axis];
      const decay = Math.exp(-damping[axis] * seconds);
      velocity[axis] = target + (speed - target) * decay;
      return target * seconds + (speed - target) * (1 - decay) / damping[axis];
    });
    applyScreenRotation(...angles);
  }

  function scheduleFrame() {
    if (!reducedMotion && document.visibilityState !== 'hidden' && frameId === null) {
      frameId = window.requestAnimationFrame(tick);
    }
  }

  function tick(timestamp) {
    frameId = null;
    if (document.visibilityState === 'hidden') {
      previousFrameTime = null;
      return;
    }
    const seconds = previousFrameTime === null ? 0 : Math.min(0.05, Math.max(0, (timestamp - previousFrameTime) / 1000));
    previousFrameTime = timestamp;
    if (!revealStarted && root.classList.contains('matrix-revealed')) startReveal();
    if (revealStarted && revealProgress < 1) {
      revealProgress = Math.min(1, (performance.now() - revealStartTime) / 1150);
    }
    if (activePointerId === null) advanceMotion(seconds);
    renderTorus();
    scheduleFrame();
  }

  function setState(text) {
    if (stateLabel) {
      stateLabel.textContent = text;
    }
  }

  function onPointerDown(event) {
    if (!shell || activePointerId !== null || event.isPrimary === false || event.button !== 0) return;
    activePointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    lastPointerTime = performance.now();
    velocity = [0, 0, 0];
    shell.classList.add('is-dragging');
    try { shell.setPointerCapture?.(event.pointerId); } catch {}
    setState('locked to input');
  }

  function onPointerMove(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    const deltaX = event.clientX - lastPointerX;
    const deltaY = event.clientY - lastPointerY;
    const angleY = -deltaX * dragRotationSpeed;
    const angleX = -deltaY * dragRotationSpeed;
    const now = performance.now();
    const seconds = Math.max(0.008, (now - lastPointerTime) / 1000);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    lastPointerTime = now;
    applyScreenRotation(angleX, angleY, 0);
    velocity = [angleX, angleY, 0].map(angle => Math.max(-3, Math.min(3, angle / seconds * 0.18)));
    renderTorus();
  }

  function onPointerUp(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    const pointerId = activePointerId;
    activePointerId = null;
    // A held pointer that has stopped moving should not impart stale momentum.
    if (performance.now() - lastPointerTime > 100) velocity = [0, 0, 0];
    shell?.classList.remove('is-dragging');
    try { if (shell?.hasPointerCapture?.(pointerId)) shell.releasePointerCapture(pointerId); } catch {}
    setState('inertia drift');
  }

  function pause() {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
    previousFrameTime = null;
    if (activePointerId !== null) onPointerUp({ pointerId: activePointerId });
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
    shell.addEventListener('lostpointercapture', onPointerUp);
  }

  renderTorus();
  if (reducedMotion) {
    startReveal();
    setState('static render');
  } else {
    scheduleFrame();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
    else scheduleFrame();
  });
  window.addEventListener('blur', () => {
    if (activePointerId !== null) onPointerUp({ pointerId: activePointerId });
  });

  window.addEventListener('beforeunload', () => {
    pause();
    revealObserver.disconnect();
  });
})();
