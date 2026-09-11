import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Topbar, Loading } from '../components/Shell.jsx';
import PdfPreview from '../components/PdfPreview.jsx';
import { buildExpensesPdf } from '../lib/pdf.js';
import { formatMoney, formatMonthName } from '../lib/format.js';

const CURRENCIES = [
  { code: 'BDT', symbol: '৳', label: 'Bangladeshi taka' },
  { code: 'USD', symbol: '$', label: 'US dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'Pound sterling' },
  { code: 'INR', symbol: '₹', label: 'Indian rupee' },
];

const TOGGLES = [
  { key: 'dailyNudge', label: 'Daily logging nudge', note: 'One reminder at 9 pm if nothing logged' },
  { key: 'budgetWarning', label: 'Budget warning at 80%', note: 'Per envelope, once per month' },
  { key: 'weeklySummary', label: 'Weekly summary email', note: 'Sunday morning recap' },
  { key: 'roundInLists', label: 'Round amounts in lists', note: 'Hides decimals on every screen' },
];

function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      className={`toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export default function Settings() {
  const { settings, saveSettings, month, notify } = useApp();
  const [budget, setBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // null until a PDF has been built and is waiting to be reviewed.
  const [preview, setPreview] = useState(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (settings) setBudget(String(settings.monthlyBudget));
  }, [settings]);

  if (!settings) return <Loading label="Loading settings" />;

  async function patch(body, message) {
    setSaving(true);
    setError(null);
    try {
      await saveSettings(body);
      if (message) notify(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const budgetChanged = String(settings.monthlyBudget) !== budget.trim();

  return (
    <>
      <Topbar title="Settings" subtitle="Currency, reminders and data" />
      <div className="screen">
        <div className="split-form" style={{ gridTemplateColumns: '1fr 1fr', maxWidth: 900 }}>
          <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <h4 style={{ margin: 0, fontSize: 16 }}>Money</h4>

            {error && (
              <div className="banner error">
                <i className="ph ph-warning-circle" />
                {error}
              </div>
            )}

            <div className="field">
              <label htmlFor="currency">Currency</label>
              <select
                id="currency"
                className="input"
                value={settings.currencyCode}
                disabled={saving}
                onChange={(e) => {
                  const c = CURRENCIES.find((x) => x.code === e.target.value);
                  patch(
                    { currencyCode: c.code, currencySymbol: c.symbol, currencyLabel: c.label },
                    `Currency set to ${c.label}`
                  );
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} — {c.symbol} {c.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="month-start">Month starts on</label>
              <select
                id="month-start"
                className="input"
                value={settings.monthStartsOn}
                disabled={saving}
                onChange={(e) =>
                  patch({ monthStartsOn: Number(e.target.value) }, 'Budget period updated')
                }
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1st of the month' : `Day ${d}`}
                  </option>
                ))}
              </select>
              <div className="muted-sm" style={{ marginTop: 'var(--space-1)' }}>
                {formatMonthName(month)} currently runs from day {settings.monthStartsOn}.
              </div>
            </div>

            <div className="field">
              <label htmlFor="budget">Monthly budget</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  id="budget"
                  className="input num"
                  inputMode="numeric"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))}
                />
                <button
                  className="btn btn-primary"
                  disabled={saving || !budgetChanged}
                  onClick={() =>
                    patch({ monthlyBudget: Number(budget) || 0 }, 'Monthly budget saved')
                  }
                >
                  Save
                </button>
              </div>
              <div className="muted-sm" style={{ marginTop: 'var(--space-1)' }}>
                Currently {formatMoney(settings.monthlyBudget, settings)} a month.
              </div>
            </div>

            <div className="field">
              <label>Rounding</label>
              <div className="seg" style={{ marginTop: 'var(--space-1)' }}>
                {[
                  ['exact', 'Exact'],
                  // "Bangladeshi taka" -> "Whole taka"
                  ['whole', `Whole ${settings.currencyLabel.split(' ').pop().toLowerCase()}`],
                ].map(([id, label]) => (
                  <label key={id} className="seg-opt">
                    <input
                      type="radio"
                      name="rounding"
                      checked={settings.rounding === id}
                      onChange={() => patch({ rounding: id }, 'Rounding updated')}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h4 style={{ margin: 0, fontSize: 16 }}>Reminders &amp; data</h4>

            {TOGGLES.map((t) => (
              <div key={t.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{ fontSize: 14 }}>{t.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>{t.note}</div>
                </div>
                <Toggle
                  label={t.label}
                  on={Boolean(settings.reminders?.[t.key])}
                  onChange={(value) => patch({ reminders: { [t.key]: value } })}
                />
              </div>
            ))}

            <hr className="hr" />

            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                disabled={building}
                onClick={async () => {
                  setBuilding(true);
                  try {
                    const data = await api.expenses.list({ month, limit: 200 });
                    if (!data.items.length) {
                      notify(`Nothing to export in ${formatMonthName(month)}`);
                      return;
                    }
                    setPreview(
                      await buildExpensesPdf({
                        rows: data.items,
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
              <button className="btn btn-secondary" disabled title="Not connected in this build">
                <i className="ph ph-plug" style={{ fontSize: 14 }} />
                Connect bank
              </button>
            </div>

            <div className="muted-sm">
              Export builds a PDF of the whole of {formatMonthName(month)} and shows it for review
              before saving. Bank syncing isn&apos;t wired up in this build.
            </div>
          </section>
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
