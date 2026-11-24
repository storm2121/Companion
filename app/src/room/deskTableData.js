// The desk's production pictures on the network (round eight, run 3): the core file, each light state's file,
// and the pictures they name, all plain URLs under public/assets/desk-p1/ (app/scripts/desk-pictures.mjs).
// Never through import.meta.glob: the old stage's 671 inlined pictures are what that does to a chunk.
//
// The folder's name is its version: /assets/** is cached for a year, immutable (firebase.json), so pictures
// changed after a deploy go out under a new folder and this constant moves with them.
export const DESK_PICTURES = '/assets/desk-p1/';

// The harness may point the desk elsewhere (a folder that is not there: the fallback).
const base = () => (typeof globalThis !== 'undefined' && globalThis.__deskPictures) || DESK_PICTURES;
export const pictureUrl = (rec, density = 1) => (rec ? `${base()}${density === 2 ? rec.x2 : rec.x1}` : '');

const getJson = (url) =>
  fetch(url, { credentials: 'same-origin' }).then((res) => {
    if (!res.ok) throw new Error(`desk pictures: ${url} ${res.status}`);
    return res.json();
  });

// The core, once per visit (a failure is remembered: the old stage then stands for the visit).
let core = null;
export const loadCore = () => {
  if (!core) core = getJson(`${base()}core.json`);
  return core;
};
// A light state's file, once per visit; null when it cannot be read.
const states = new Map();
const statesIn = new Map();
export const loadState = (coreData, state) => {
  if (!states.has(state)) {
    const file = coreData?.states?.[state]?.file;
    const p = file ? getJson(`${base()}${file}`) : Promise.reject(new Error(`desk pictures: no state ${state}`));
    states.set(
      state,
      p.then((data) => {
        statesIn.set(state, data);
        return data;
      }),
    );
  }
  return states.get(state);
};
// A state's file if it is in already (synchronous), else null.
export const stateNow = (state) => statesIn.get(state) || null;

// A picture fetched and decoded off the page, once per URL; settles either way (a picture that fails is
// simply not there: `failedPictures` holds its URL and the stage leaves it out).
const decoded = new Map();
export const failedPictures = new Set();
export const decodePicture = (url) => {
  if (!url) return Promise.resolve(false);
  if (!decoded.has(url)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    decoded.set(
      url,
      img.decode().then(
        () => true,
        () => {
          failedPictures.add(url);
          return false;
        },
      ),
    );
  }
  return decoded.get(url);
};
export const pictureDecoded = (url) => decoded.has(url);

// What this visit fetched of the desk (the harness's loading report reads the browser's own list; this
// only says which states were asked for).
export const statesAsked = () => [...states.keys()];
