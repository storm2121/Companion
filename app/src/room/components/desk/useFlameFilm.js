import { useEffect, useRef } from 'react';

// The candle's filmed flame (Pexels 7034332, assets/desk/README.md), for both desks: it plays
// only when it is night, motion is not still, the tab is visible and the flame is on screen;
// anything else pauses it (a paused film still shows its frame). Once it has a frame to show
// it tells `onShow(true)`, and the drawn (or rendered) flame steps aside; if it cannot play,
// `onShow(false)` and that flame stays. The film is a flame on black, screened where it plays.

export const useFlameFilm = (videoRef, { night, still, onShow }) => {
  const showRef = useRef(onShow);
  useEffect(() => {
    showRef.current = onShow;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let visible = true;
    let shown = document.visibilityState === 'visible';
    let usable = true;
    const tell = (value) => showRef.current?.(value);
    const sync = () => {
      if (usable && night && !still && shown && visible) {
        video.play()?.catch(() => {
          if (video.readyState < 2) tell(false);
        });
      } else {
        video.pause();
      }
    };
    const ready = () => tell(true);
    const failed = () => {
      usable = false;
      tell(false);
    };
    video.addEventListener('loadeddata', ready);
    // A <source> that fails reports on itself: caught on the way down.
    video.addEventListener('error', failed, true);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    io.observe(video);
    const onVisibility = () => {
      shown = document.visibilityState === 'visible';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (video.readyState >= 2) ready();
    sync();
    return () => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed, true);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
    };
  }, [videoRef, night, still]);
};
