'use client';

import { useSession, signOut } from 'next-auth/react';
import Script from 'next/script';
import Image from 'next/image';
import { useEffect } from 'react';

export default function DashboardClient({ user }) {
  useEffect(() => {
    // Give parser.js and app.js a tick to load if not already ready
    const timer = setInterval(() => {
      if (typeof window.initLegacyApp === 'function') {
        window.initLegacyApp();
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {/* Load Chart.js and plugin before app.js */}
      <Script src="https://cdn.jsdelivr.net/npm/chart.js" strategy="beforeInteractive" />
      <Script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation" strategy="beforeInteractive" />
      <Script src={`/parser.js?v=${Date.now()}`} strategy="beforeInteractive" />
      <Script src={`/app.js?v=${Date.now()}`} strategy="afterInteractive" />

      <div className="app-container">
        {/* ── Sidebar ── */}
        <nav className="sidebar">
          <div className="logo">
            <span className="logo-icon white">✦</span>
            <span className="logo-text">EKATRA</span>
          </div>
          <ul className="nav-links">
            <li className="active" data-target="dashboard">Dashboard</li>
            <li data-target="sleep-recovery">Sleep &amp; Recovery</li>
            <li data-target="workouts">Workouts</li>
            <li data-target="habits-experiments">Habits &amp; Experiments</li>
            <li data-target="circadian">Circadian</li>
            <li data-target="data-import">Data Import</li>
          </ul>

          <div className="data-management-sidebar">
            <div className="status-indicator">
              <span className="dot active"></span>
              <span id="sync-time">Live Sync</span>
            </div>
            <div className="sidebar-upload" id="drop-zone">
              <span>Import Engine</span>
            </div>
          </div>
        </nav>

        {/* ── Main Content ── */}
        <main className="content">
          {/* Header */}
          <header className="top-bar">
            <div>
              <h1 className="page-title">Ready for action, {user?.name?.split(' ')[0] ?? 'there'}</h1>
              <p className="page-subtitle" id="date-subtitle"></p>
            </div>
            <div className="header-actions">
              <button id="sync-now-btn" className="btn-sync">Sync Now</button>
              {/* User avatar + sign out */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {user?.image ? (
                  <Image
                    src={user.image}
                    alt={user.name ?? 'User'}
                    width={40}
                    height={40}
                    style={{ borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                ) : (
                  <div className="avatar" />
                )}
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#94A3B8',
                    padding: '0.4rem 0.8rem',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </header>

          {/* ── Dashboard Section ── */}
          <section id="dashboard" className="view-section active">
            <div className="bento-grid">
              <div className="bento-card span-2 row-2">
                <h2 className="panel-title">READINESS SCORE</h2>
                <div className="readiness-container">
                  <svg className="readiness-rings-svg" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                    <circle className="readiness-ring ring-bg" cx="50" cy="50" r="40"></circle>
                    <circle className="readiness-ring ring-recovery glow-violet" id="ring-recovery" cx="50" cy="50" r="40" strokeDasharray="0 251.2"></circle>
                    <circle className="readiness-ring ring-bg" cx="50" cy="50" r="30"></circle>
                    <circle className="readiness-ring ring-strain glow-coral" id="ring-strain" cx="50" cy="50" r="30" strokeDasharray="0 188.4"></circle>
                  </svg>
                  <div className="readiness-content">
                    <div className="data-primary" id="dash-recovery-score">88</div>
                    <div className="page-subtitle">Optimal</div>
                  </div>
                </div>
              </div>

              <div className="bento-card span-2 ai-coach-card">
                <div className="card-header-flex">
                  <h2 className="panel-title">COACH AI</h2>
                  <button id="refresh-ai-btn" className="btn-icon-only" title="Refresh Insight">
                    <span className="icon-refresh">↻</span>
                  </button>
                </div>
                <div className="ai-insight">
                  <p id="dash-insight-text">Analyzing your health patterns...</p>
                </div>
                <div className="waveform-container active">
                  {[...Array(8)].map((_, i) => <div key={i} className="waveform-bar"></div>)}
                </div>
              </div>

              <div className="bento-card span-2">
                <div className="card-header-flex">
                  <h2 className="panel-title">SLEEP &amp; WAKE VARIANCE</h2>
                  <div className="time-range-selectors" data-stat="sleep-variance">
                    <button className="range-btn" data-range="7">1W</button>
                    <button className="range-btn active" data-range="30">1M</button>
                    <button className="range-btn" data-range="365">1Y</button>
                  </div>
                </div>
                <div className="grid-main" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '1rem', gap: '1rem' }}>
                  <div>
                    <h2 className="panel-title">Avg Bedtime</h2>
                    <div className="data-primary" style={{ fontSize: '24px' }} id="avg-bedtime">11:15 <span className="unit">PM</span></div>
                  </div>
                  <div>
                    <h2 className="panel-title">Avg Wakeup</h2>
                    <div className="data-primary" style={{ fontSize: '24px' }} id="avg-wakeup">06:45 <span className="unit">AM</span></div>
                  </div>
                </div>
                <div className="kpi-subtext mt-4" id="sleep-variance-text">±12m consistency</div>
              </div>

              <div className="bento-card">
                <h2 className="panel-title">HRV RECOVERY</h2>
                <div className="data-primary" id="dash-hrv">52 <span className="unit">ms</span></div>
                <div className="kpi-subtext positive" id="hrv-velocity">↑ Accelerating</div>
              </div>

              <div className="bento-card">
                <h2 className="panel-title">RESTING HR</h2>
                <div className="data-primary" id="dash-rhr">51 <span className="unit">bpm</span></div>
                <div className="kpi-subtext positive" id="rhr-delta">-2 bpm drop</div>
              </div>

              <div className="bento-card">
                <div className="card-header-flex">
                  <h2 className="panel-title">TOTAL SLEEP</h2>
                  <span className="badge-lite" id="efficiency-badge-main">--%</span>
                </div>
                <div className="data-primary" id="dash-sleep-total">-- <span className="unit">h</span></div>
                <div className="kpi-subtext" id="dash-naps">No naps</div>
              </div>

              <div className="bento-card">
                <div className="card-header-flex">
                  <h2 className="panel-title">SLEEP EFFICIENCY</h2>
                  <span className="badge-lite" id="efficiency-badge">--%</span>
                </div>
                <div className="data-primary" id="dash-efficiency">-- <span className="unit">%</span></div>
                <div className="kpi-subtext" id="efficiency-velocity">Stable</div>
              </div>

              <div className="bento-card span-2">
                <h2 className="panel-title">WEEKLY VOLUME</h2>
                <div className="grid-main" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <div className="data-primary" style={{ fontSize: '32px' }} id="weekly-volume">420 <span className="unit">min</span></div>
                    <div className="kpi-subtext">Active load</div>
                  </div>
                  <div>
                    <h2 className="panel-title">Training Zone</h2>
                    <div className="data-primary" style={{ fontSize: '24px' }} id="training-zone">Aerobic</div>
                  </div>
                </div>
              </div>

              <div className="bento-card span-4" id="habit-pulse-card">
                <div className="card-header-flex">
                  <h2 className="panel-title">Habit Pulse Grid</h2>
                  <span className="badge-lite">1-Tap Tagging</span>
                </div>
                <div className="habit-pulse-grid" id="daily-tags-container">
                  <div className="btn-add-habit" id="add-habit-trigger">
                    <span style={{ fontSize: '24px' }}>+</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Sleep & Recovery ── */}
          <section id="sleep-recovery" className="view-section">
            <div className="bento-grid">
              <div className="bento-card span-full">
                <div className="card-header-flex">
                  <h2 className="panel-title">SLEEP TREND</h2>
                  <div className="time-range-selectors" data-chart="sleep-recovery">
                    <button className="range-btn" data-range="1w">1W</button>
                    <button className="range-btn" data-range="1m">1M</button>
                    <button className="range-btn" data-range="3m">3M</button>
                    <button className="range-btn active" data-range="1y">1Y</button>
                    <button className="range-btn" data-range="all">ALL</button>
                  </div>
                </div>
                <div className="chart-container-lg" style={{ height: '350px' }}>
                  <canvas id="sleepTrendChart"></canvas>
                </div>
              </div>

              <div className="bento-card span-full">
                <h2 className="panel-title">SLEEP &amp; WAKE SCHEDULE</h2>
                <div className="chart-container-lg" style={{ height: '350px' }}>
                  <canvas id="sleepScheduleChart"></canvas>
                </div>
              </div>

              <div className="bento-card span-full">
                <h2 className="panel-title">HRV RECOVERY TREND</h2>
                <div className="chart-container-lg">
                  <canvas id="hrvChartOnly"></canvas>
                </div>
              </div>

              <div className="bento-card span-full">
                <h2 className="panel-title">RESTING HEART RATE TREND</h2>
                <div className="chart-container-lg">
                  <canvas id="rhrChartOnly"></canvas>
                </div>
              </div>

              <div className="insight-bridge-layout">
                {/* Weekly Readiness (Short-term) */}
                <div className="ai-insight-panel short-term">
                  <div className="ai-panel-header">
                    <div className="ai-header-left">
                      <div className="ai-icon-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                      </div>
                      <h2 className="panel-title">WEEKLY READINESS</h2>
                    </div>
                    <div className="ai-writing-indicator">
                      <div className="ai-dot pulse"></div>
                      <span className="badge-lite">Live Analysis</span>
                    </div>
                  </div>
                  <p id="sleep-short-term-insight" className="insight-text" style={{ fontSize: '0.95rem', lineHeight: '1.7', opacity: 0.9 }}>
                    Comparing last night&apos;s data to your weekly average...
                  </p>
                </div>

                {/* Historical Synthesis (Long-term) */}
                <div className="ai-insight-panel long-term">
                  <div className="ai-panel-header">
                    <div className="ai-header-left">
                      <div className="ai-icon-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h2 className="panel-title">HISTORICAL SYNTHESIS</h2>
                    </div>
                    <div className="ai-writing-indicator">
                      <div className="ai-dot pulse" style={{ animationDelay: '0.2s' }}></div>
                      <span className="badge-lite">Deep Context</span>
                    </div>
                  </div>
                  <p id="sleep-long-term-insight" className="insight-text" style={{ fontSize: '0.95rem', lineHeight: '1.7', opacity: 0.9 }}>
                    Analyzing long-term sleep architecture...
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Workouts ── */}
          <section id="workouts" className="view-section">
            <div className="bento-card span-full" style={{ background: 'linear-gradient(145deg, rgba(30,32,45,0.7), rgba(15,17,25,0.9))', borderLeft: '4px solid var(--accent-1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 className="panel-title" style={{ marginBottom: '4px', color: 'var(--accent-1)' }}>DYNAMIC READINESS COACH</h2>
                  <div className="data-primary" style={{ fontSize: '20px', color: 'var(--text-base)' }} id="workout-ai-advice">Analyzing nervous system capacity...</div>
                </div>
                <span style={{ fontSize: '32px' }} id="workout-ai-emoji">🧠</span>
              </div>
            </div>
            <div className="bento-grid">
              <div className="bento-card span-full">
                <div className="card-header-flex">
                  <h2 className="panel-title">INTENSITY DISTRIBUTION (80/20)</h2>
                  <div className="time-range-selectors" data-chart="workouts">
                    <button className="range-btn" data-range="1w">1W</button>
                    <button className="range-btn" data-range="1m">1M</button>
                    <button className="range-btn active" data-range="3m">3M</button>
                    <button className="range-btn" data-range="1y">1Y</button>
                    <button className="range-btn" data-range="all">ALL</button>
                  </div>
                </div>
                <div className="chart-container-lg" style={{ height: '350px' }}>
                  <canvas id="workoutDistributionChart"></canvas>
                </div>
              </div>
              <div className="bento-card span-full" style={{ paddingBottom: '32px' }}>
                <div className="card-header-flex">
                  <h2 className="panel-title">MOMENTUM &amp; STREAKS (90 DAYS)</h2>
                </div>
                <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingTop: '10px', paddingBottom: '4px' }} id="workout-momentum-grid"></div>
              </div>
            </div>
          </section>

          {/* ── Habits & Experiments ── */}
          <section id="habits-experiments" className="view-section">
            <div className="bento-grid">
              <div className="bento-card span-full" style={{ minHeight: '250px' }}>
                <div className="card-header-flex">
                  <h2 className="panel-title">HABIT CONSISTENCY CALENDAR</h2>
                  <div className="calendar-controls">
                    <button id="cal-prev" className="btn-icon-only">←</button>
                    <span id="cal-month-label" style={{ fontWeight: 600, color: 'white' }}>March 2024</span>
                    <button id="cal-next" className="btn-icon-only">→</button>
                  </div>
                </div>
                <div id="habits-legend" className="habits-legend"></div>
                <div id="habits-calendar-grid" className="habits-calendar-grid"></div>
              </div>

              <div className="bento-card span-full">
                <div className="card-header-flex">
                  <h2 className="panel-title">Habit Pulse Grid</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button id="yesterday-btn" className="yesterday-link">← Yesterday</button>
                    <span className="badge-lite" id="pulse-date-label">Today</span>
                  </div>
                </div>
                <div className="habit-pulse-grid expanded" id="habits-tab-container"></div>
              </div>

              <div className="bento-card span-full">
                <div className="card-header-flex">
                  <h2 className="panel-title">HABIT STREAKS</h2>
                  <span className="badge-lite">Current Run</span>
                </div>
                <div id="habits-streaks-bar" className="habits-streaks-bar"></div>
              </div>

              <div className="bento-card span-full">
                <div className="card-header-flex">
                  <h2 className="panel-title">HABIT IMPACT MATRIX</h2>
                  <label className="lag-toggle" title="Calculates effects on the biometrics for the day after the habit">
                    <input type="checkbox" id="lag-toggle-cb" defaultChecked />
                    <span className="lag-toggle-label">Next-day Effect</span>
                  </label>
                </div>
                <p className="kpi-subtext">Select a habit to see its exact mathematical dividend or tax on your core biometrics.</p>
                <div className="mt-4" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>Analyze Habit:</span>
                  <select id="habit-impact-select" className="neon-select" style={{ background: 'var(--color-bg-void)', color: 'white', border: '1px solid var(--color-border-card)', padding: '0.5rem 1rem', borderRadius: '8px', minWidth: '200px', fontWeight: 500 }}></select>
                </div>
                <div id="habit-impact-results" className="grid-main mt-4 hidden" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                  {['hrv', 'rhr', 'efficiency', 'deep'].map((metric) => (
                    <div key={metric} className="bento-card" style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem 1rem', textAlign: 'center' }}>
                      <div className="kpi-subtext">{metric === 'hrv' ? 'HRV' : metric === 'rhr' ? 'RHR' : metric === 'efficiency' ? 'Sleep Efficiency' : 'Deep Sleep'} Impact</div>
                      <div id={`impact-${metric}`} className="data-primary" style={{ fontSize: '1.8rem', margin: '0.5rem 0' }}>--</div>
                      <div className="badge-lite" style={{ background: 'transparent', color: 'var(--color-text-secondary)', width: 'auto' }} id={`impact-${metric}-raw`}>-- vs --</div>
                    </div>
                  ))}
                </div>
                <div id="habit-impact-empty" className="mt-4" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.8 }}>🧪</div>
                  <div className="kpi-subtext">Select a habit from the dropdown above.<br />The engine requires at least <strong>4 logged instances</strong> of a habit to compute statistical significance.</div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Circadian ── */}
          <section id="circadian" className="view-section">
            <div className="bento-grid">
              <div className="bento-card span-full">
                <h2 className="panel-title">CIRCADIAN ESTIMATE</h2>
                <div className="chart-container-lg">
                  <canvas id="circadianChart"></canvas>
                </div>
              </div>
            </div>
          </section>

          {/* ── Data Import ── */}
          <section id="data-import" className="view-section">
            <div className="bento-card span-full">
              <h2 className="panel-title">DATA IMPORT</h2>
              <div id="import-status" className="import-status-box hidden">
                <p id="import-status-text" className="import-status-text">Processing...</p>
              </div>
              <div className="large-drop-zone" id="large-drop-zone">
                <div className="drop-text">
                  <h4>Drop your export.xml here</h4>
                  <p>or click to select file from your computer</p>
                </div>
                <button className="btn-primary" id="browse-btn">Browse Files</button>
              </div>
            </div>
          </section>
        </main>

        {/* FAB */}
        <button id="fab-quick-log" className="fab-btn" onClick={() => typeof toggleQuickLogModal !== 'undefined' && toggleQuickLogModal(true)}>
          <span className="fab-icon">+</span>
        </button>

        {/* Quick Log Modal */}
        <div id="quick-log-modal" className="modal-overlay hidden">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Quick Log Habit</h3>
              <button className="btn-close" onClick={() => typeof toggleQuickLogModal !== 'undefined' && toggleQuickLogModal(false)}>✕</button>
            </div>
            <div className="modal-toggle-group">
              <button className="toggle-btn active" id="ql-toggle-today" onClick={() => typeof setQuickLogDay !== 'undefined' && setQuickLogDay('today')}>Today</button>
              <button className="toggle-btn" id="ql-toggle-yesterday" onClick={() => typeof setQuickLogDay !== 'undefined' && setQuickLogDay('yesterday')}>Yesterday</button>
            </div>
            <p className="kpi-subtext" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              Tap a habit to instantly log it for <span id="ql-target-label" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Today</span>.
            </p>
            <div id="ql-tags-grid" className="ql-tags-grid"></div>
            <div id="ql-success-msg" className="kpi-subtext positive hidden" style={{ textAlign: 'center', marginTop: '1rem', fontWeight: 500 }}>
              ✓ Saved to timeline
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
