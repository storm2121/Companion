import { Component, lazy, Suspense, useEffect } from 'react';
import { useAuth } from '../context/authState';
import RoomHome from './RoomHome';
import RoomShell from './RoomShell';
import { HOME_DESK, homeFor } from './roomPrefs';

// The room's Home, behind its door: the papers (RoomHome, the courses and recent notes as a list)
// or the desk (RoomDesk, a preview), as the person chose on the You page (roomPrefs.home, read by
// homeFor: the papers unless the desk was chosen).
//
// The desk is loaded HERE, lazily, and nothing else in the app imports it: while the switch is off
// none of its code, its scene.json or its pictures is fetched. While its chunk loads (1.1 MB gzip:
// seconds on a slow connection), the room's top line stands over the ground with nothing under it,
// so Search, Calendar, Inbox and You work meanwhile; never the papers first.
//
// If the desk cannot open (its chunk did not load, or it threw), the papers stand in for the rest
// of this visit with one line under the top line, and the error is logged: nobody lands on a blank
// Home. The saved choice is left alone. Choosing a Home again lets the desk try again.

const RoomDesk = lazy(() => import('./RoomDesk'));

const DESK_FAILED = 'The desk could not open, so this is Home as it was.';

// For the visit (until a reload): once the desk failed, Home is the papers until the preference
// changes, so a desk that throws after it appeared is not shown again on every return to Home.
let failedThisVisit = false;

class DeskBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: failedThisVisit };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    failedThisVisit = true;
    console.error('The desk could not open', error);
  }

  render() {
    return this.state.failed ? <RoomHome notice={DESK_FAILED} /> : this.props.children;
  }
}

const RoomHomeDoor = () => {
  const { profile } = useAuth();
  const home = homeFor(profile?.roomPrefs);

  // The preference moved off the desk: the next time it is chosen, the desk gets a fresh try.
  useEffect(() => {
    if (home !== HOME_DESK) failedThisVisit = false;
  }, [home]);

  if (home !== HOME_DESK) return <RoomHome />;
  return (
    <DeskBoundary>
      <Suspense fallback={<RoomShell />}>
        <RoomDesk />
      </Suspense>
    </DeskBoundary>
  );
};

export default RoomHomeDoor;
