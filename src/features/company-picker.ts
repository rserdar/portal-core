import { api } from '../lib/api';
import { $companies } from '../lib/store';
import { SyncManager } from '../lib/sync';

type CompanyRecord = Record<string, any>;

interface SetupCompanyPickerOptions {
  prefix: string;
  registerCleanup?: (fn: () => void) => void;
  onShowPicker?: () => void;
  onSelected: (payload: { id: string; company: CompanyRecord }) => void | Promise<void>;
}

const getElement = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

export function getCompanyId(company: CompanyRecord) {
  return String(
    company?.['Firma No'] ||
      company?.FirmaNo ||
      company?.firmaNo ||
      company?.id ||
      company?.ID ||
      '',
  ).trim();
}

export function getCompanyDisplayName(company: CompanyRecord) {
  return String(
    company?.['Firma Adı'] ||
      company?.nickname ||
      company?.Nick ||
      company?.nick ||
      company?.FirmaAdi ||
      company?.Unvan ||
      company?.unvan ||
      'Firma',
  ).trim();
}

export function getCompanyLabel(company: CompanyRecord) {
  const id = getCompanyId(company);
  return `${getCompanyDisplayName(company)} (${id || '—'})`;
}

function normalizeSearchText(value: string) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

export async function setupOperationCompanyPicker({
  prefix,
  registerCleanup,
  onShowPicker,
  onSelected,
}: SetupCompanyPickerOptions) {
  const companySearch = getElement<HTMLInputElement>(`${prefix}-company-search`);
  const companyList = getElement<HTMLDivElement>(`${prefix}-company-list`);
  const companyContinue = getElement<HTMLButtonElement>(`${prefix}-company-continue`);
  const selectStatus = getElement<HTMLElement>(`${prefix}-page-select-status`);

  let selectedCompany: CompanyRecord | null = null;
  let companySuggestions: CompanyRecord[] = [];
  let activeCompanyIndex = -1;

  const setSelectStatus = (message: string, isError = false) => {
    if (!selectStatus) return;
    selectStatus.textContent = message;
    selectStatus.className = `text-xs font-semibold ${isError ? 'text-rose-400' : 'text-muted'}`;
  };

  const closeCompanyList = () => {
    activeCompanyIndex = -1;
    companySuggestions = [];
    if (!companyList) return;
    companyList.classList.add('hidden');
    companyList.innerHTML = '';
    companySearch?.setAttribute('aria-expanded', 'false');
  };

  const chooseCompany = (company: CompanyRecord) => {
    selectedCompany = company;
    if (companySearch) {
      companySearch.value = getCompanyLabel(company);
      companySearch.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setSelectStatus('Firma seçildi. Devam edebilirsin.');
    closeCompanyList();
  };

  const moveCompanySelection = (direction: 1 | -1) => {
    if (!companySuggestions.length || !companyList) return;
    activeCompanyIndex =
      (activeCompanyIndex + direction + companySuggestions.length) % companySuggestions.length;
    const buttons = Array.from(
      companyList.querySelectorAll<HTMLButtonElement>('[data-company-option]'),
    );
    buttons.forEach((button, index) => {
      const isActive = index === activeCompanyIndex;
      button.classList.toggle('bg-indigo-600', isActive);
      button.classList.toggle('text-white', isActive);
      button.classList.toggle('text-main', !isActive);
      button.classList.toggle('hover:bg-surface-hover', !isActive);

      const secondary = button.querySelector('.company-id-tag');
      if (secondary) {
        secondary.classList.toggle('text-indigo-100', isActive);
        secondary.classList.toggle('text-muted', !isActive);
      }
    });
    buttons[activeCompanyIndex]?.scrollIntoView({ block: 'nearest' });
  };

  const renderCompanySuggestions = (query = '', options: { forceOpen?: boolean } = {}) => {
    if (!companyList || !companySearch) return;

    const companies = ($companies.get() as CompanyRecord[]) || [];
    const normalizedQuery = normalizeSearchText(query);
    const suggestions = normalizedQuery
      ? companies.filter((company) => {
          const haystacks = [
            getCompanyLabel(company),
            getCompanyDisplayName(company),
            getCompanyId(company),
          ];
          return haystacks.some((value) => normalizeSearchText(value).includes(normalizedQuery));
        })
      : companies.slice(0, 12);

    companySuggestions = suggestions.slice(0, 12);
    activeCompanyIndex = companySuggestions.length ? 0 : -1;

    if (!companySuggestions.length) {
      if (options.forceOpen && query.trim()) {
        companyList.innerHTML =
          '<p class="px-3 py-2 text-xs font-semibold text-muted">Eşleşen firma bulunamadı. Listeden bir firma seçmelisin.</p>';
        companyList.classList.remove('hidden');
        companySearch.setAttribute('aria-expanded', 'true');
        return;
      }
      closeCompanyList();
      return;
    }

    companyList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    companySuggestions.forEach((company, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.companyOption = getCompanyId(company);
      const isActive = index === activeCompanyIndex;
      button.className = `company-option group flex w-full flex-col items-start rounded-xl px-4 py-2.5 text-left text-sm font-bold transition-all duration-200 ${
        isActive
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 translate-x-1'
          : 'text-main hover:bg-surface-hover hover:translate-x-1'
      }`;

      const primary = document.createElement('span');
      primary.className = 'block truncate';
      primary.textContent = getCompanyDisplayName(company) || 'Firma';
      button.appendChild(primary);

      const secondary = document.createElement('span');
      secondary.className = `company-id-tag text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${
        isActive ? 'text-indigo-100' : 'text-muted'
      }`;
      secondary.textContent = `M${getCompanyId(company) || '—'}`;
      button.appendChild(secondary);

      fragment.appendChild(button);
    });
    companyList.appendChild(fragment);
    companyList.classList.remove('hidden');
    companySearch.setAttribute('aria-expanded', 'true');
  };

  const syncCompanyList = (companies: CompanyRecord[]) => {
    if (companies.length > 0) setSelectStatus('Bir firma seçip devam edebilirsin.');
    if (document.activeElement === companySearch) {
      renderCompanySuggestions(companySearch?.value || '', { forceOpen: true });
    }
  };

  const resolveCompanyFromInput = () => {
    const raw = companySearch?.value.trim() || '';
    const companies = ($companies.get() as CompanyRecord[]) || [];
    if (!raw) return null;
    return (
      companies.find((company) => {
        const label = getCompanyLabel(company);
        const id = getCompanyId(company);
        const nick = getCompanyDisplayName(company);
        return raw === label || raw === id || raw === nick;
      }) || null
    );
  };

  const handleListMouseDown = (event: MouseEvent) => {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-company-option]');
    if (!option) return;
    event.preventDefault();
    const matched = companySuggestions.find(
      (company) => getCompanyId(company) === (option.dataset.companyOption || ''),
    );
    if (matched) chooseCompany(matched);
  };

  const handleContinue = async () => {
    selectedCompany = resolveCompanyFromInput();
    const selectedId = selectedCompany ? getCompanyId(selectedCompany) : '';
    if (!selectedId || !selectedCompany) {
      setSelectStatus('Devam etmek için listeden geçerli bir firma seç.', true);
      return;
    }
    await onSelected({ id: selectedId, company: selectedCompany });
  };

  onShowPicker?.();
  syncCompanyList(($companies.get() as CompanyRecord[]) || []);

  const unsub = $companies.subscribe((companies) => syncCompanyList(companies as CompanyRecord[]));
  registerCleanup?.(unsub);

  await SyncManager.init();
  if (($companies.get() as CompanyRecord[]).length === 0) {
    const res = await api.getCompanies();
    if (res.success && Array.isArray(res.data)) {
      $companies.set(res.data);
    }
  }

  if (companySearch) {
    companySearch.onfocus = () => {
      renderCompanySuggestions(companySearch.value || '', { forceOpen: true });
    };
    companySearch.oninput = () => {
      selectedCompany = resolveCompanyFromInput();
      renderCompanySuggestions(companySearch.value || '', { forceOpen: true });
      setSelectStatus(selectedCompany ? 'Firma seçildi. Devam edebilirsin.' : 'Listeden geçerli bir firma seç.');
    };
    companySearch.onkeydown = (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (companyList?.classList.contains('hidden')) {
          renderCompanySuggestions(companySearch.value || '', { forceOpen: true });
          return;
        }
        moveCompanySelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!companyList?.classList.contains('hidden')) {
          moveCompanySelection(-1);
        }
        return;
      }
      if (event.key === 'Enter') {
        if (activeCompanyIndex >= 0 && companySuggestions[activeCompanyIndex]) {
          event.preventDefault();
          chooseCompany(companySuggestions[activeCompanyIndex]);
          return;
        }
        selectedCompany = resolveCompanyFromInput();
        if (selectedCompany) {
          event.preventDefault();
          void handleContinue();
        }
        return;
      }
      if (event.key === 'Escape') {
        closeCompanyList();
      }
    };
    companySearch.onblur = () => {
      window.setTimeout(() => closeCompanyList(), 120);
    };
  }

  companyList?.addEventListener('mousedown', handleListMouseDown);
  registerCleanup?.(() => companyList?.removeEventListener('mousedown', handleListMouseDown));

  companyContinue?.addEventListener('click', handleContinue);
  registerCleanup?.(() => companyContinue?.removeEventListener('click', handleContinue));
}
