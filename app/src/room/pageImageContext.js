import { createContext } from 'react';

// What a photo on the page needs from the note it lives in: `upload(file)` → { url, ar },
// and whether there is a connection to upload over. RoomNote provides it; PageImage reads it.
export const PageImageContext = createContext(null);
