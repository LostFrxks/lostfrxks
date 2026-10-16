export function setupSpeakingGallery() {
  const gallery = document.querySelector('[data-stage-gallery]');
  if (!gallery) return;
  const slides = [...gallery.querySelectorAll('[data-photo-slide]')];
  const status = gallery.querySelector('[data-photo-status]');
  const stage = gallery.querySelector('[data-photo-stage]');
  let current = slides.findIndex(slide => slide.dataset.position === 'active');
  let gesture;

  function showPhoto(value) {
    resetDrag();
    current = (value + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const offset = (index - current + slides.length) % slides.length;
      slide.dataset.position = offset === 0 ? 'active' : offset === 1 ? 'next' : 'previous';
      slide.setAttribute('aria-hidden', String(offset !== 0));
    });
    status.textContent = `${String(current + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  }
  gallery.querySelector('[data-photo-previous]').addEventListener('click', () => showPhoto(current - 1));
  gallery.querySelector('[data-photo-next]').addEventListener('click', () => showPhoto(current + 1));
  gallery.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showPhoto(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
  });
  function resetDrag() {
    const pointerId = gesture?.id;
    gesture = null;
    stage.removeAttribute('data-dragging');
    // Restore transitions before clearing the held position, so release settles smoothly.
    if (stage.style.getPropertyValue('--gallery-drag-x')) stage.getBoundingClientRect();
    stage.style.removeProperty('--gallery-drag-x');
    stage.style.removeProperty('--gallery-drag-yaw');
    if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  }
  stage.addEventListener('dragstart', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    resetDrag();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId) return;
    const x = event.clientX - gesture.x;
    const y = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(y) > 8 && Math.abs(y) > Math.abs(x) * 1.2) { resetDrag(); return; }
      if (Math.abs(x) < 6 || Math.abs(x) <= Math.abs(y) * 1.4) return;
      gesture.horizontal = true;
      stage.setAttribute('data-dragging', '');
    }
    const width = stage.clientWidth;
    const offset = Math.max(-width * .55, Math.min(width * .55, x));
    stage.style.setProperty('--gallery-drag-x', `${offset * .55}px`);
    stage.style.setProperty('--gallery-drag-yaw', `${offset / width * 25}deg`);
  });
  stage.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const x = event.clientX - gesture.x;
    const advance = gesture.horizontal && Math.abs(x) > 45;
    resetDrag();
    if (advance) showPhoto(current + (x < 0 ? 1 : -1));
  });
  stage.addEventListener('pointercancel', resetDrag);
  stage.addEventListener('lostpointercapture', resetDrag);
  window.addEventListener('blur', resetDrag);

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
    document.removeEventListener('visibilitychange', onVisibility);
  });
}
