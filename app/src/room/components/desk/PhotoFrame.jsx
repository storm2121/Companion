import SceneSlot from '../SceneSlot';

// The Home's own picture (SceneSlot, unchanged) in a thin dark wooden frame, standing on
// the desk's back edge against the wall. Only the frame and its place are new; the slot
// keeps its empty state, its upload and its menu.

const PhotoFrame = ({ style }) => (
  <div className="room-desk-frame" style={style}>
    <span className="room-desk-shade" aria-hidden="true" />
    <div className="room-desk-frame-wood">
      <SceneSlot />
    </div>
  </div>
);

export default PhotoFrame;
