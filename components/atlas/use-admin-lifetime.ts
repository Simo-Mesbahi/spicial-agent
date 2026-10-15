'use client';

import { useEffect, useRef } from 'react';

/** Ignore a completed request after its organization/case editor has unmounted. */
export function useAdminLifetime() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
