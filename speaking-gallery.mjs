export function setupSpeakingGallery() {
  const gallery = document.querySelector('[data-stage-gallery]');
  if (!gallery) return;
  const slides = [...gallery.querySelectorAll('[data-photo-slide]')];
  const status = gallery.querySelector('[data-photo-status]');
  const stage = gallery.querySelector('[data-photo-stage]');
  let current = slides.findIndex(slide => slide.dataset.position === 'active');
  let gesture;
  let frame = 0, previousTime = 0;
  let stageWidth, cardWidth, cardHeight, perspective, restAngles;
  function measure() {
    stageWidth = stage.clientWidth;
    cardWidth = slides[0].offsetWidth;
    cardHeight = slides[0].offsetHeight;
    perspective = parseFloat(getComputedStyle(stage).perspective);
    restAngles = slides.map(slide => {
      const style = getComputedStyle(slide);
      return ['x', 'y', 'z'].map(axis => parseFloat(style.getPropertyValue(`--photo-rest-${axis}`)));
    });
  }
  measure();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverMotion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const motion = {
    phase: { value: current, target: current, velocity: 0 },
    tiltX: { value: 0, target: 0, velocity: 0 },
    tiltY: { value: 0, target: 0, velocity: 0 }
  };
  const wrap = value => ((value % slides.length) + slides.length) % slides.length;
  function render() {
    const radius = cardWidth * .68;
    const depth = Math.max(300, 900 - stageWidth);
    let fit = 1;
    const limit = stageWidth / 2 - 10;
    const poses = slides.map((slide, index) => {
      const angle = (index - motion.phase.value) * Math.PI * 2 / slides.length;
      const sine = Math.sin(angle), cosine = Math.cos(angle);
      const focus = Math.max(0, cosine) ** 3;
      const z = 48 - depth * (1 - cosine);
      const pose = {
        x: radius * sine, z,
        yaw: -45 * sine - 13 * cosine + motion.tiltY.value * focus,
        pitch: 4 + motion.tiltX.value * focus,
        roll: -2 * cosine + 5 * sine,
        brightness: .62 + .38 * (cosine + 1) / 2
      };
      const [restX, restY, restZ] = restAngles[index];
      const rotation = new DOMMatrix().rotate(pose.pitch + restX, 0, 0)
        .rotate(0, pose.yaw + restY, 0).rotate(0, 0, pose.roll + restZ);
      // Fit the entire moving scene through the perspective camera. One uniform
      // scale preserves the cards' proportions, separation and shared trajectory.
      for (const x of [-cardWidth / 2, cardWidth / 2]) {
        for (const y of [-cardHeight / 2, cardHeight / 2]) {
          const point = rotation.transformPoint(new DOMPoint(x, y, 0));
          const extent = Math.abs(point.x + pose.x) + limit * (point.z + z) / perspective;
          if (extent > limit) fit = Math.min(fit, limit / extent);
        }
      }
      return pose;
    });
    slides.forEach((slide, index) => {
      const pose = poses[index];
      const values = {
        '--photo-fit': fit.toFixed(5),
        '--photo-orbit-x': `${pose.x.toFixed(5)}px`,
        '--photo-orbit-z': `${pose.z.toFixed(5)}px`,
        '--photo-orbit-yaw': `${pose.yaw.toFixed(5)}deg`,
        '--photo-orbit-pitch': `${pose.pitch.toFixed(5)}deg`,
        '--photo-orbit-roll': `${pose.roll.toFixed(5)}deg`,
        '--photo-brightness': pose.brightness.toFixed(5),
        '--photo-order': String(10000 + Math.round(pose.z * 10))
      };
      for (const [name, value] of Object.entries(values)) slide.style.setProperty(name, value);
    });
  }
  function animate(time) {
    const dt = previousTime ? Math.min(32, time - previousTime) : 16;
    previousTime = time;
    let moving = false;
    // One critically damped spring drives the entire orbit, including reversals.
    for (const state of Object.values(motion)) {
      const omega = .018, decay = Math.exp(-omega * dt);
      const error = state.value - state.target;
      const momentum = state.velocity + omega * error;
      state.value = state.target + (error + momentum * dt) * decay;
      state.velocity = (state.velocity - omega * momentum * dt) * decay;
      if (Math.abs(state.value - state.target) < .00001 && Math.abs(state.velocity) < .00001) {
        state.value = state.target;
        state.velocity = 0;
      } else moving = true;
    }
    render();
    frame = moving ? requestAnimationFrame(animate) : 0;
    if (!moving) previousTime = 0;
  }
  function wake() {
    if (reducedMotion.matches || document.hidden) {
      cancelAnimationFrame(frame);
      frame = previousTime = 0;
      for (const state of Object.values(motion)) { state.value = state.target; state.velocity = 0; }
      render();
    } else if (!frame) frame = requestAnimationFrame(animate);
  }
  function updateSelection() {
    const selected = wrap(Math.round(motion.phase.target));
    if (selected === current) return;
    current = selected;
    slides.forEach((slide, index) => {
      const offset = wrap(index - current);
      slide.dataset.position = offset === 0 ? 'active' : offset === 1 ? 'next' : 'previous';
      slide.setAttribute('aria-hidden', String(offset !== 0));
    });
    status.textContent = `${String(current + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  }
  function resetLight() {
    motion.tiltX.target = motion.tiltY.target = 0;
    stage.style.removeProperty('--photo-light-x');
    stage.style.removeProperty('--photo-light-y');
    wake();
  }
  function followMouse(event) {
    if (event.pointerType !== 'mouse' || !hoverMotion.matches) { resetLight(); return; }
    const bounds = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    motion.tiltX.target = (0.5 - y) * 9;
    motion.tiltY.target = (x - 0.5) * 14;
    stage.style.setProperty('--photo-light-x', `${x * 100}%`);
    stage.style.setProperty('--photo-light-y', `${y * 100}%`);
    wake();
  }
  stage.addEventListener('pointerleave', resetLight);
  function resetDrag() {
    const pointerId = gesture?.id;
    gesture = null;
    stage.removeAttribute('data-dragging');
    motion.phase.target = Math.round(motion.phase.target);
    updateSelection();
    resetLight();
    if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  }
  function showPhoto(value) {
    resetDrag();
    const delta = wrap(wrap(value) - current + 1) - 1;
    motion.phase.target += delta;
    updateSelection();
    wake();
  }
  gallery.querySelector('[data-photo-previous]').addEventListener('click', () => showPhoto(current - 1));
  gallery.querySelector('[data-photo-next]').addEventListener('click', () => showPhoto(current + 1));
  gallery.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showPhoto(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
  });
  stage.addEventListener('dragstart', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    resetDrag();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, phase: motion.phase.target, horizontal: false };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!gesture) { followMouse(event); return; }
    if (gesture.id !== event.pointerId) return;
    const x = event.clientX - gesture.x, y = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(y) > 8 && Math.abs(y) > Math.abs(x) * 1.2) { resetDrag(); return; }
      if (Math.abs(x) < 6 || Math.abs(x) <= Math.abs(y) * 1.4) return;
      gesture.horizontal = true;
      stage.setAttribute('data-dragging', '');
    }
    const distancePerPhoto = Math.max(100, Math.min(280, stageWidth * .45));
    motion.phase.target = gesture.phase - x / distancePerPhoto;
    updateSelection();
    wake();
  });
  stage.addEventListener('pointerup', event => { if (gesture?.id === event.pointerId) resetDrag(); });
  stage.addEventListener('pointercancel', resetDrag);
  stage.addEventListener('lostpointercapture', resetDrag);
  window.addEventListener('blur', resetDrag);
  const resizeObserver = new ResizeObserver(() => {
    measure();
    render();
  });
  resizeObserver.observe(stage);
  reducedMotion.addEventListener('change', wake);
  render();

  const video = document.querySelector('[data-stage-video]');
  const play = document.querySelector('[data-stage-play]');
  const error = document.querySelector('[data-stage-video-error]');
  if (!video || !play) return;
  const showVideoError = () => {
    error.hidden = false;
    play.hidden = false;
    video.controls = false;
  };
  video.addEventListener('error', showVideoError);
  play.addEventListener('click', async () => {
    error.hidden = true;
    video.controls = true;
    if (!video.getAttribute('src')) video.src = video.dataset.src;
    else if (video.error) video.load();
    try {
      await video.play();
      play.hidden = true;
      video.focus({ preventScroll: true });
    } catch (reason) {
      if (reason.name !== 'AbortError') showVideoError();
      play.hidden = false;
      video.controls = false;
    }
  });
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => !entry.isIntersecting)) video.pause();
  });
  observer.observe(video);
  const onVisibility = () => { if (document.visibilityState === 'hidden') video.pause(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', event => {
    video.pause();
    if (event.persisted) return;
    observer.disconnect();
    resizeObserver.disconnect();
    reducedMotion.removeEventListener('change', wake);
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', onVisibility);
  });
}
