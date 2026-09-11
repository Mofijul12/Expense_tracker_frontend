import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useApp } from '../lib/store.jsx';
import { Topbar, Async, Empty } from '../components/Shell.jsx';
import PdfPreview from '../components/PdfPreview.jsx';
import { buildExpensesPdf } from '../lib/pdf.js';
import { formatMoney, formatMonthName, formatShortDate } from '../lib/format.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'uncategorized', label: 'Uncategorized' },
];

const PAGE_SIZE = 10;

export default function Expenses() {
  const { month, settings, categories, notify } = useApp();
  const navigate = useNavigate();

  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('');
  // null until a PDF has been built and is waiting to be reviewed.
  const [preview, setPreview] = useState(null);
  const [building, setBuilding] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Any change to the filters puts us back on the first page.
  useEffect(() => setPage(1), [filter, category, debounced, month]);

  const state = useApi(
    () =>
      api.expenses.list({
        month,
        filter,
        category,
        q: debounced,
        page,
        limit: PAGE_SIZE,
      }),
    [month, filter, category, debounced, page]
  );

  return (
    <>
      <Topbar
        title="Expenses"
        subtitle={`Every expense in ${formatMonthName(month)}`}
        search={search}
        onSearch={setSearch}
      />
      <div className="screen">
        <div className="stack-tight">
          <div className="toolbar">
            <div className="seg">
              {FILTERS.map((f) => (
                <label key={f.id} className="seg-opt">
                  <input
                    type="radio"
                    name="filter"
                    checked={filter === f.id}
                    onChange={() => setFilter(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>

            <select
              className="input"
              style={{ width: 'auto', minWidth: 150 }}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>

            <span className="spacer muted-sm">
              {state.data
                ? `${state.data.total} ${state.data.total === 1 ? 'expense' : 'expenses'} · ${formatMoney(
                    state.data.spendAmount,
                    settings
                  )} spend`
                : ' '}
            </span>

            <button
              className="btn btn-secondary"
              disabled={building || !state.data?.items.length}
              onClick={async () => {
                setBuilding(true);
                try {
                  setPreview(
                    await buildExpensesPdf({
                      rows: state.data.items,
                      settings,
                      title: 'Expenses',
                      subtitle: `Every expense in ${formatMonthName(month)}`,
                      filename: `expenses-${month}.pdf`,
                    })
                  );
                } catch (err) {
                  notify(`Could not build the PDF — ${err.message}`);
                } finally {
                  setBuilding(false);
                }
              }}
            >
              <i className="ph ph-file-pdf" style={{ fontSize: 14 }} />
              {building ? 'Preparing…' : 'Export PDF'}
            </button>
          </div>

          <Async
            state={state}
            label="Loading expenses"
            empty={(data) =>
              data.items.length === 0 ? (
                <section className="panel">
                  <Empty
                    icon="ph ph-funnel"
                    title="Nothing matches these filters"
                    hint="Try a different month, category or search."
                    action={
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setFilter('all');
                          setCategory('');
                          setSearch('');
                        }}
                      >
                        Clear filters
                      </button>
                    }
                  />
                </section>
              ) : null
            }
          >
            {(data) => (
              <section className="panel" style={{ padding: 'var(--space-3) 0' }}>
                <div className="table-scroll">
                  <table className="table table-cards">
                    <thead>
                      <tr>
                        <th style={{ width: 30 }} />
                        <th>Date</th>
                        <th>Category</th>
                        <th>Note</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((e) => (
                        <tr
                          key={e._id}
                          className="row-link"
                          onClick={() => navigate(`/app/expenses/${e._id}`)}
                        >
                          <td>
                            <i
                              className={e.category?.icon || 'ph ph-question'}
                              style={{ fontSize: 15, color: 'var(--color-accent)' }}
                            />
                          </td>
                          <td style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>
                            {formatShortDate(e.date)}
                          </td>
                          <td>
                            <span className="tag tag-neutral">
                              {e.category?.name || 'Uncategorized'}
                            </span>
                          </td>
                          <td className="note-cell">
                            {e.note || <span className="muted-sm">—</span>}
                          </td>
                          <td className="num amount-cell" style={{ textAlign: 'right' }}>
                            {formatMoney(e.amount, settings)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-4) var(--space-6) var(--space-2)',
                  }}
                >
                  <span className="muted-sm">
                    Showing {(data.page - 1) * data.limit + 1}–
                    {Math.min(data.page * data.limit, data.total)} of {data.total}
                  </span>
                  <div className="spacer" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button
                      className="btn btn-secondary btn-icon"
                      disabled={data.page <= 1}
                      onClick={() => setPage((p) => Math.max(p - 1, 1))}
                      aria-label="Previous page"
                    >
                      <i className="ph ph-caret-left" />
                    </button>
                    <button
                      className="btn btn-secondary btn-icon"
                      disabled={data.page >= data.pages}
                      onClick={() => setPage((p) => Math.min(p + 1, data.pages))}
                      aria-label="Next page"
                    >
                      <i className="ph ph-caret-right" />
                    </button>
                  </div>
                </div>
              </section>
            )}
          </Async>
        </div>
      </div>

      <PdfPreview
        open={!!preview}
        title="Expenses"
        subtitle={formatMonthName(month)}
        file={preview}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
