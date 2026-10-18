import { CONTEXT, serveGlass } from './rainRenderer.js';

// The window's glass, off the page's main thread: the WebGL2 context (which alone takes tens of
// milliseconds to make), the compiling, the pictures' upload and every frame happen here, on the
// OffscreenCanvas the page handed over (rainGlass.js). The page keeps what only it can know: what
// is on screen, how big, where the pointer goes.

const schedule = self.requestAnimationFrame
  ? (callback) => self.requestAnimationFrame(callback)
  : (callback) => self.setTimeout(() => callback(performance.now()), 16);
const cancel = self.cancelAnimationFrame ? (handle) => self.cancelAnimationFrame(handle) : (handle) => self.clearTimeout(handle);
const post = (message) => self.postMessage(message);

let glass = null;

self.onmessage = ({ data }) => {
  if (data.type !== 'init') {
    glass?.receive(data);
    if (data.type === 'destroy') self.close();
    return;
  }
  let gl = null;
  try {
    gl = data.canvas.getContext('webgl2', CONTEXT);
  } catch {
    gl = null;
  }
  if (!gl) {
    post({ type: 'failed' });
    return;
  }
  data.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    post({ type: 'failed' });
  });
  glass = serveGlass({ gl, options: data.options, size: data.size, post, schedule, cancel });
};
