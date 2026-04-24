export function useCleanup() {
  let cleanupFns: Array<() => void> = [];

  function registerCleanup(fn: () => void) {
    cleanupFns.push(fn);
  }

  function runCleanups() {
    cleanupFns.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.error('Cleanup error:', e);
      }
    });
    cleanupFns = [];
  }

  return { registerCleanup, runCleanups };
}

export function initPageCleanup(initFn: () => void, cleanupFn?: () => void) {
  document.removeEventListener('astro:page-load', initFn);
  document.addEventListener('astro:page-load', initFn);

  if (cleanupFn) {
    document.removeEventListener('astro:before-preparation', cleanupFn);
    document.addEventListener('astro:before-preparation', cleanupFn);
  }
}
