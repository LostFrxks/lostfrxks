export function setupSpeakingGallery() {
  const gallery = document.querySelector('[data-stage-gallery]');
  if (!gallery) return;
  const slides = [...gallery.querySelectorAll('[data-photo-slide]')];
  const status = gallery.querySelector('[data-photo-status]');
  const caption = gallery.querySelector('[data-photo-caption]');
  const stage = gallery.querySelector('[data-photo-stage]');
  let current = 0;
  let gesture;

  function showPhoto(value) {
    current = (value + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const offset = (index - current + slides.length) % slides.length;
      slide.dataset.position = offset === 0 ? 'active' : offset === 1 ? 'next' : 'previous';
      slide.setAttribute('aria-hidden', String(offset !== 0));
    });
    status.textContent = `${String(current + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    caption.textContent = slides[current].dataset.caption;
  }
  gallery.querySelector('[data-photo-previous]').addEventListener('click', () => showPhoto(current - 1));
  gallery.querySelector('[data-photo-next]').addEventListener('click', () => showPhoto(current + 1));
  gallery.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showPhoto(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
  });
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) { gesture = null; return; }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture?.(event.pointerId);
  });
  stage.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const x = event.clientX - gesture.x;
    const y = event.clientY - gesture.y;
    if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.4) showPhoto(current + (x < 0 ? 1 : -1));
    gesture = null;
  });
  stage.addEventListener('pointercancel', () => { gesture = null; });
  stage.addEventListener('lostpointercapture', () => { gesture = null; });

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
