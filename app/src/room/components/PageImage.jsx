import { useContext, useEffect, useRef, useState } from 'react';
import { PageImageContext } from '../pageImageContext';
import { IMAGE_MAX_SIZE, IMAGE_MIN_SIZE, imageSize, imageTilt, isUploadedImage } from '../pageImages';
import { Pill, TiltIcon } from './primitives';

// A photo ON THE PAGE (the board's photos are PinRail's). It is uploaded — chosen, dropped
// or pasted — and stored with the note, the way board photos are; it can be sized by its
// corner grip (a share of the page's width, so it looks the same on a phone) and tilted a
// few degrees either way, like a print stuck onto the paper.
//
// Photos used to be a pasted web ADDRESS. That field is gone. A photo still pointing at one
// keeps showing (where the address still serves it), with a line saying photos upload now
// and a way to replace it with an upload.

const TILT_STEP = 1.5;
const KEY_STEP = 5;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const imageFiles = (list) => [...(list || [])].filter((file) => file?.type?.startsWith('image/'));

const PageImage = ({ block, onChange, onFocus }) => {
  const tools = useContext(PageImageContext);
  const latest = useRef({ block, onChange });
  const frameRef = useRef(null);
  const fileRef = useRef(null);
  const drag = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [broken, setBroken] = useState(false);
  const [over, setOver] = useState(false);
  // The size while the grip is being dragged; written to the block once, on release.
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    latest.current = { block, onChange };
  }, [block, onChange]);

  const size = imageSize(block.size);
  const tilt = imageTilt(block.tilt);
  const shown = draft ?? size;
  const legacy = Boolean(block.value) && !isUploadedImage(block.value);

  const patch = (fields) => {
    const { block: current, onChange: change } = latest.current;
    change?.({ ...current, ...fields });
  };

  const take = async (files) => {
    const file = imageFiles(files)[0];
    if (!file) return;
    if (!tools?.upload || !tools.online) {
      setProblem('Adding a photo needs a connection.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const { url, ar } = await tools.upload(file);
      setBroken(false);
      patch({ value: url, ar });
    } catch (err) {
      console.error('Could not add that photo', err);
      setProblem('That photo would not attach — try another one.');
    } finally {
      setBusy(false);
    }
  };

  const choose = () => fileRef.current?.click();
  const tiltTo = (next) => patch({ tilt: imageTilt(next) });

  // The grip: the photo is centred, so dragging its corner out by d widens it by 2d —
  // measured from where the drag began, so the photo never jumps on the first move.
  const gripDown = (event) => {
    const frame = frameRef.current;
    const column = frame?.parentElement;
    if (!frame || !column) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { x: event.clientX, from: size, width: column.getBoundingClientRect().width };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the drag still works while it stays on the grip.
    }
    onFocus?.(null);
  };
  const gripMove = (event) => {
    const d = drag.current;
    if (!d || !d.width) return;
    setDraft(clamp(Math.round(d.from + ((event.clientX - d.x) * 200) / d.width), IMAGE_MIN_SIZE, IMAGE_MAX_SIZE));
  };
  const gripUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (draft !== null && draft !== size) patch({ size: draft });
    setDraft(null);
  };
  const gripKey = (event) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? KEY_STEP : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -KEY_STEP : 0;
    if (!step) return;
    event.preventDefault();
    patch({ size: clamp(size + step, IMAGE_MIN_SIZE, IMAGE_MAX_SIZE) });
  };

  const dropProps = {
    onDragOver: (event) => {
      if (![...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) return;
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      setOver(false);
      take(event.dataTransfer.files);
    },
    onPaste: (event) => {
      const files = imageFiles(event.clipboardData?.files);
      if (!files.length) return;
      event.preventDefault();
      take(files);
    },
  };

  return (
    <div
      className={`room-image${block.value ? '' : ' is-empty'}${over ? ' is-over' : ''}${draft !== null ? ' is-resizing' : ''}`}
      onFocus={() => onFocus?.(null)}
      {...dropProps}
    >
      {block.value ? (
        <figure
          ref={frameRef}
          className="room-image-frame"
          style={{
            width: `${shown}%`,
            transform: tilt ? `rotate(${tilt}deg)` : undefined,
            // A tilted print needs a little air above and below, or its corners touch the lines.
            marginBlock: tilt ? `${Math.round(Math.abs(tilt) * 3) + 6}px` : undefined,
          }}
        >
          <img
            src={block.value}
            alt={block.alt || ''}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
          />
          <div className="room-image-tools">
            <button type="button" className="room-image-btn" onClick={() => tiltTo(tilt - TILT_STEP)} aria-label="Tilt left" title="Tilt left">
              <TiltIcon />
            </button>
            <button type="button" className="room-image-btn" onClick={() => tiltTo(tilt + TILT_STEP)} aria-label="Tilt right" title="Tilt right">
              <TiltIcon flip />
            </button>
            {tilt !== 0 && (
              <button type="button" className="room-image-btn room-image-btn--text" onClick={() => tiltTo(0)} title="Straighten">
                0°
              </button>
            )}
            <button type="button" className="room-image-btn room-image-btn--text" onClick={choose} disabled={busy} title="Replace the photo">
              {busy ? '…' : 'Replace'}
            </button>
          </div>
          <span
            className="room-image-grip"
            role="slider"
            tabIndex={0}
            aria-label="Photo size"
            aria-valuemin={IMAGE_MIN_SIZE}
            aria-valuemax={IMAGE_MAX_SIZE}
            aria-valuenow={shown}
            aria-valuetext={`${shown}% of the page width`}
            onPointerDown={gripDown}
            onPointerMove={gripMove}
            onPointerUp={gripUp}
            onPointerCancel={gripUp}
            onKeyDown={gripKey}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" focusable="false" aria-hidden="true">
              <path d="M2.5 10.5 L10.5 2.5 M6.5 10.5 L10.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </span>
        </figure>
      ) : (
        <div className="room-image-drop">
          <p>{busy ? 'Adding the photo…' : 'Drop a photo here, or paste one.'}</p>
          <Pill onClick={choose} disabled={busy}>
            Choose a photo
          </Pill>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />

      {problem && <p className="room-image-note is-error">{problem}</p>}
      {legacy && (
        <p className="room-image-note">
          {broken ? 'This linked photo cannot be shown here. ' : 'This photo is still a web link. '}
          Photos upload with your note now —{' '}
          <button type="button" onClick={choose} disabled={busy}>
            replace it with an upload
          </button>
          .
        </p>
      )}
    </div>
  );
};

export default PageImage;
