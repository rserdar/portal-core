export interface ToastOptions {
  duration?: number;
}

type ToastType = 'success' | 'error' | 'info' | 'warning';

const CONFIG: Record<ToastType, { bar: string; icon: string; text: string }> = {
  success: {
    bar: 'bg-emerald-500',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    text: 'text-emerald-400',
  },
  error: {
    bar: 'bg-rose-500',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-rose-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    text: 'text-rose-400',
  },
  warning: {
    bar: 'bg-amber-500',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-amber-400 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    text: 'text-amber-400',
  },
  info: {
    bar: 'bg-indigo-500',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    text: 'text-indigo-400',
  },
};

class ToastManager {
  private container: HTMLElement | null = null;

  private getContainer(): HTMLElement {
    if (this.container) return this.container;
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  show(message: string, type: ToastType = 'info', options: ToastOptions = {}) {
    const container = this.getContainer();
    const duration = options.duration ?? 4000;
    const cfg = CONFIG[type];

    const toast = document.createElement('div');
    toast.className = [
      'pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-sm w-max',
      'bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden',
      'animate-in slide-in-from-right-5 fade-in duration-200',
    ].join(' ');

    toast.innerHTML = `
      <div class="w-1 self-stretch shrink-0 ${cfg.bar} rounded-l-xl -ml-[1px]"></div>
      <div class="flex items-start gap-2.5 py-3 pr-3 flex-1 min-w-0">
        ${cfg.icon}
        <p class="text-[13px] font-medium text-white/90 leading-snug break-words flex-1">${escapeHtml(message)}</p>
        <button class="shrink-0 text-white/30 hover:text-white/70 transition-colors mt-0.5" aria-label="Kapat">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
    `;

    toast.querySelector('button')?.addEventListener('click', () => this.dismiss(toast));
    container.appendChild(toast);
    setTimeout(() => this.dismiss(toast), duration);
  }

  private dismiss(toast: HTMLElement) {
    if (!toast.isConnected) return;
    toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-5');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  success(m: string, o?: ToastOptions) { this.show(m, 'success', o); }
  error(m: string, o?: ToastOptions) { this.show(m, 'error', o); }
  info(m: string, o?: ToastOptions) { this.show(m, 'info', o); }
  warning(m: string, o?: ToastOptions) { this.show(m, 'warning', o); }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const toast = new ToastManager();

if (typeof window !== 'undefined') {
  (window as any).toast = toast;
}
