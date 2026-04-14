const TOAST_CONTAINER_ID = 'toast-container';
const FLASH_TOAST_KEY = 'portal_flash_toast';

export type ToastType = 'success' | 'error' | 'info';

export function ensureToastContainer(): HTMLElement | null {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (container) {
    if (container.parentElement !== document.body) {
      document.body.appendChild(container);
    }
    return container;
  }

  container = document.createElement('div');
  container.id = TOAST_CONTAINER_ID;
  container.className = 'fixed inset-x-4 bottom-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-[100] flex flex-col gap-3 pointer-events-none sm:max-w-sm';
  document.body.appendChild(container);
  return container;
}

export function showToast(message: string, type: ToastType = 'info') {
  const container = ensureToastContainer();
  if (!container) return;

  const colors = {
    success: 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/20',
    error: 'bg-rose-600 text-white border-rose-500 shadow-rose-900/20',
    info: 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-900/20',
  } as const;

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-3 px-5 py-4 rounded-xl border-2 shadow-xl text-sm font-semibold max-w-sm translate-y-4 opacity-0 transition-all duration-300 ${colors[type]}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-4', 'opacity-0');
    });
  });

  setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

export function setFlashToast(message: string, type: ToastType = 'info') {
  try {
    sessionStorage.setItem(FLASH_TOAST_KEY, JSON.stringify({ message, type }));
  } catch {
    // Ignore storage failures; regular toasts still work in-page.
  }
}

export function consumeFlashToast() {
  try {
    const raw = sessionStorage.getItem(FLASH_TOAST_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_TOAST_KEY);
    const parsed = JSON.parse(raw) as { message?: string; type?: ToastType };
    if (parsed?.message) {
      showToast(parsed.message, parsed.type || 'info');
    }
  } catch {
    sessionStorage.removeItem(FLASH_TOAST_KEY);
  }
}
