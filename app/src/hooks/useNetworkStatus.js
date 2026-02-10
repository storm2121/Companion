import { useEffect, useState } from 'react';

const getInitialOnline = () => {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
};

const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(getInitialOnline);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};

export default useNetworkStatus;
