import { getVisiblePageNumbers } from '../utils';

interface TableFilterOptions<T> {
  data: readonly T[];
  pageSize?: number;
  filterFn: (item: T, filters: Record<string, string>) => boolean;
  sortFn?: (a: T, b: T) => number;
  onStateChange?: (state: 'loading' | 'empty' | 'ready') => void;
  onRender: (items: T[]) => void;
}

export function useTableFilter<T>(options: TableFilterOptions<T>) {
  let sourceData: readonly T[] = options.data;
  let filters: Record<string, string> = {};
  let currentPage = 1;
  let pageSize = options.pageSize || 20;

  function updatePaginationUI(totalItems: number) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    currentPage = Math.min(currentPage, totalPages);

    const pageSummary = document.getElementById('page-summary');
    if (pageSummary) pageSummary.textContent = `${currentPage} / ${totalPages}`;

    const datasetSummary = document.getElementById('dataset-summary');
    if (datasetSummary) datasetSummary.textContent = totalItems.toString();

    const paginationBar = document.getElementById('pagination-bar');
    const pageNumberList = document.getElementById('page-number-list');
    const prevPageBtn = document.getElementById('prev-page-btn') as HTMLButtonElement;
    const nextPageBtn = document.getElementById('next-page-btn') as HTMLButtonElement;

    if (!paginationBar || !pageNumberList || !prevPageBtn || !nextPageBtn) return;

    if (totalItems === 0) {
      paginationBar.classList.add('hidden');
      pageNumberList.innerHTML = '';
      return;
    }

    paginationBar.classList.remove('hidden');
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;

    const pages = getVisiblePageNumbers(totalPages, currentPage);
    pageNumberList.innerHTML = '';

    pages.forEach((pageNum, index) => {
      if (index > 0 && pages[index - 1] !== pageNum - 1) {
        const dots = document.createElement('span');
        dots.className = 'px-1.5 text-xs text-muted';
        dots.textContent = '…';
        pageNumberList.appendChild(dots);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(pageNum);
      btn.className = `w-8 h-8 rounded-lg border text-xs font-black transition-all ${
        pageNum === currentPage
          ? 'bg-primary text-white border-primary shadow-md shadow-primary/20'
          : 'border-border-main text-muted hover:text-primary hover:bg-primary/10 hover:border-primary/30'
      }`;
      btn.addEventListener('click', () => {
        currentPage = pageNum;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        renderTable();
      });
      pageNumberList.appendChild(btn);
    });
  }

  function getFilteredData() {
    let filtered = sourceData.filter(item => options.filterFn(item, filters));
    if (options.sortFn) {
      filtered = filtered.sort(options.sortFn);
    }
    return filtered;
  }

  function renderTable() {
    const filtered = getFilteredData();

    if (filtered.length === 0) {
      if (options.onStateChange) options.onStateChange('empty');
      updatePaginationUI(0);
      options.onRender([]);
      return;
    }

    if (options.onStateChange) options.onStateChange('ready');

    updatePaginationUI(filtered.length);
    const startIndex = (currentPage - 1) * pageSize;
    const paged = filtered.slice(startIndex, startIndex + pageSize);

    options.onRender(paged);
  }

  function setFilters(newFilters: Record<string, string>) {
    filters = { ...filters, ...newFilters };
    currentPage = 1;
    renderTable();
  }

  function setPageSize(newSize: number) {
    pageSize = newSize;
    currentPage = 1;
    renderTable();
  }

  function nextPage() {
    const totalPages = Math.max(1, Math.ceil(sourceData.filter(item => options.filterFn(item, filters)).length / pageSize));
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  }

  function prevPage() {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  }

  function updateData(newData: readonly T[]) {
    sourceData = newData;
    renderTable();
  }

  return {
    renderTable,
    setFilters,
    setPageSize,
    nextPage,
    prevPage,
    updateData,
    getFilteredData,
    filters
  };
}
