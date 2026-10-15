import { useEffect, useState } from 'react'
import {
  askQuestion,
  getApiBase,
  health,
  sendDecision,
  streamAssessment,
} from './api'
import './App.css'

const PROFILES = ['aggressive', 'balanced', 'conservative']
const HORIZONS = ['short', 'medium', 'long']

function statusLabel(status) {
  return {
    awaiting_approval: 'Awaiting approval',
    completed: 'Completed',
    incomplete: 'Incomplete',
    not_found: 'Not found',
    running: 'Running',
  }[status] || status || 'Idle'
}

export default function App() {
  const [query, setQuery] = useState('Assess Apple and Microsoft for me')
  const [profile, setProfile] = useState('balanced')
  const [horizon, setHorizon] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [apiOk, setApiOk] = useState(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState([])
  const [result, setResult] = useState(null)
  const [comment, setComment] = useState('')
  const [question, setQuestion] = useState('')
  const [chat, setChat] = useState([])

  useEffect(() => {
    health()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false))
  }, [])

  const threadId = result?.thread_id
  const status = busy && result?.status === 'running' ? 'running' : (busy && !result ? 'running' : result?.status)

  async function startRun(e) {
    e.preventDefault()
    setError('')
    setProgress([])
    setResult(null)
    setChat([])
    setComment('')
    setBusy(true)
    try {
      await streamAssessment(
        { query: query.trim(), profile, horizon },
        {
          onStarted: (data) => setResult({ thread_id: data.thread_id, status: 'running' }),
          onProgress: (ev) =>
            setProgress((prev) => [...prev, ev.label || ev.node || 'step']),
          onResult: (data) => setResult(data),
          onError: (data) => {
            setError(data.message || 'Assessment failed.')
            setResult((prev) => ({ ...(prev || {}), status: 'incomplete' }))
          },
        },
      )
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function decide(decision) {
    if (!threadId) return
    setError('')
    setBusy(true)
    try {
      const next = await sendDecision(threadId, decision, comment.trim())
      setResult(next)
      setComment('')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendQuestion(e) {
    e.preventDefault()
    if (!threadId || !question.trim()) return
    const q = question.trim()
    setQuestion('')
    setError('')
    setBusy(true)
    const history = chat.map(({ role, content }) => ({ role, content }))
    try {
      const { answer } = await askQuestion(threadId, q, history)
      setChat((prev) => [...prev, { role: 'user', content: q }, { role: 'ai', content: answer }])
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Investing agent</p>
          <h1>Stock assessment</h1>
        </div>
        <div className={`api-pill ${apiOk === true ? 'ok' : apiOk === false ? 'bad' : ''}`}>
          API {apiOk === true ? 'online' : apiOk === false ? 'offline' : 'checking'}
          <span>{getApiBase()}</span>
        </div>
      </header>

      <form className="card" onSubmit={startRun}>
        <label>
          What should we assess?
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            maxLength={1000}
            required
            disabled={busy}
          />
        </label>
        <div className="row">
          <label>
            Risk profile
            <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={busy}>
              {PROFILES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Horizon
            <select value={horizon} onChange={(e) => setHorizon(e.target.value)} disabled={busy}>
              {HORIZONS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy || !query.trim()}>
          {busy && (!result || result.status === 'running') ? 'Running…' : 'Run assessment'}
        </button>
      </form>

      {error && <p className="banner error">{error}</p>}

      {(progress.length > 0 || result) && (
        <section className="card">
          <div className="status-row">
            <h2>Run</h2>
            <span className={`badge ${status || ''}`}>{statusLabel(status)}</span>
          </div>
          {threadId && <p className="muted">Thread {threadId}</p>}
          {progress.length > 0 && (
            <ol className="steps">
              {progress.map((label, i) => (
                <li key={`${label}-${i}`}>{label}</li>
              ))}
            </ol>
          )}
          {result?.tickers?.length > 0 && (
            <p className="muted">Tickers: {result.tickers.join(', ')}</p>
          )}
          {result?.warnings?.length > 0 && (
            <ul className="warn-list">
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {result?.answer && !result.report_markdown && (
            <p className="answer">{result.answer}</p>
          )}
        </section>
      )}

      {result?.report_markdown && (
        <section className="card">
          <h2>Report</h2>
          <pre className="report">{result.report_markdown}</pre>
        </section>
      )}

      {result?.status === 'awaiting_approval' && (
        <section className="card">
          <h2>Decision</h2>
          <label>
            Optional comment
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={1000}
              disabled={busy}
            />
          </label>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => decide('approved')}>
              Approve
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => decide('rejected')}>
              Reject
            </button>
          </div>
        </section>
      )}

      {result?.status === 'completed' && result.report_markdown && (
        <section className="card">
          <h2>Ask about this report</h2>
          <div className="chat">
            {chat.map((turn, i) => (
              <div key={i} className={`bubble ${turn.role}`}>
                <strong>{turn.role === 'user' ? 'You' : 'Agent'}</strong>
                <p>{turn.content}</p>
              </div>
            ))}
          </div>
          <form className="row" onSubmit={sendQuestion}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              maxLength={1000}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !question.trim()}>Send</button>
          </form>
        </section>
      )}
    </div>
  )
}
