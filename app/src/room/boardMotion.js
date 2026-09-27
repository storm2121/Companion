// How photos on the board move.
//
// A critically damped spring — the "SmoothDamp" formulation — rather than CSS
// transitions. A transition restarts from zero speed every time its target changes, and
// during a drag the targets change on every pointer move, so neighbours stuttered as they
// made room. A spring carries its current velocity into the new target, so a photo that is
// already gliding just bends its path.
//
// Critically damped means it never overshoots: the design says nothing bounces and nothing
// springs, and this is the one kind of spring that honours that.
//
// DOM-only by design: positions are written straight onto nodes as transforms and nothing
// here touches React state (contextweb §5 — geometry never goes in state).
//
// `smoothDamp` is pure and Node-safe, so tests/room.unit.test.mjs covers it.

// Seconds to settle, roughly. Calm, not sluggish.
export const SETTLE_TIME = 0.16;

const REST_DISTANCE = 0.25;
const REST_SPEED = 2;
const MAX_STEP = 0.05; // a backgrounded tab must not teleport photos on return

export const smoothDamp = (current, target, velocity, smoothTime, dt) => {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  const nextVelocity = (velocity - omega * temp) * decay;
  const next = target + (change + temp) * decay;
  // The polynomial above approximates the exact decay; at large steps it can land a hair
  // past the target. Never let that show.
  if (target - current > 0 === next > target) return { value: target, velocity: 0 };
  return { value: next, velocity: nextVelocity };
};

// A thrown photo keeps its speed on release only if that speed carries it TOWARDS where it
// is going. Speed pointing away would carry it past and bring it back — a bounce.
export const releaseVelocity = (position, target, velocity) =>
  Math.sign(target - position) === Math.sign(velocity) ? velocity : 0;

export const createBoardMotion = ({ write, isStill }) => {
  const items = new Map();
  let frame = 0;
  let last = 0;
  let onFrame = null;

  const draw = (item) => {
    if (item.drawn === item.y) return;
    item.drawn = item.y;
    write(item);
  };

  const tick = (now) => {
    const dt = Math.min(MAX_STEP, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    onFrame?.(dt);

    const still = isStill();
    let moving = Boolean(onFrame);
    items.forEach((item) => {
      if (!item.held && (item.y !== item.target || item.v !== 0)) {
        if (still) {
          item.y = item.target;
          item.v = 0;
        } else {
          const next = smoothDamp(item.y, item.target, item.v, SETTLE_TIME, dt);
          item.y = next.value;
          item.v = next.velocity;
          if (Math.abs(item.y - item.target) < REST_DISTANCE && Math.abs(item.v) < REST_SPEED) {
            item.y = item.target;
            item.v = 0;
          } else {
            moving = true;
          }
        }
      }
      draw(item);
    });

    if (moving) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = 0;
      last = 0;
    }
  };

  const kick = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  return {
    items,

    // Where a photo should be. A photo seen for the first time is simply put there — only
    // changes animate, never the first paint.
    aim(id, node, target) {
      const item = items.get(id);
      if (!item) {
        const created = { id, node, y: target, v: 0, target, drawn: null, held: false };
        items.set(id, created);
        draw(created);
        return;
      }
      // A remounted node has never been drawn on — force the write.
      if (item.node !== node) {
        item.node = node;
        item.drawn = null;
      }
      if (!item.held) item.target = target;
      draw(item);
    },

    // A photo under the pointer goes exactly where the pointer says.
    hold(id, y, velocity = 0) {
      const item = items.get(id);
      if (!item) return;
      item.held = true;
      item.y = y;
      item.v = velocity;
      draw(item);
    },

    release(id, target) {
      const item = items.get(id);
      if (!item) return;
      item.held = false;
      item.target = target;
      item.v = releaseVelocity(item.y, target, item.v);
      kick();
    },

    forget(id) {
      items.delete(id);
    },

    // A live gesture that needs a callback every frame (auto-scroll at the viewport edge).
    during(callback) {
      onFrame = callback;
      if (callback) kick();
    },

    kick,

    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      onFrame = null;
    },
  };
};
