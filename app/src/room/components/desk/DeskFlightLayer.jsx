// The room's flight layer (deskFlightRun.js): where the cloth of a picked book flies between the
// desk and its course page. Above the page and its top line, under the overlays; never in the
// way of a pointer. Hosted by RoomLayout, so it outlives the page a flight leaves.

const LAYER = { position: 'fixed', inset: 0, zIndex: 35, pointerEvents: 'none', overflow: 'hidden' };

const DeskFlightLayer = () => <div className="room-flight-layer" data-desk-flight="" aria-hidden="true" style={LAYER} />;

export default DeskFlightLayer;
