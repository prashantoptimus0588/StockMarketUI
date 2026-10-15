const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

async function parseError(res) {
  const text = await res.text()
  try {
    const data = JSON.parse(text)
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail)) {
      return data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
    }
    return text || res.statusText
  } catch {
    return text || res.statusText
  }
}

async function jsonRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export function getApiBase() {
  return API_BASE
}

export function health() {
  return jsonRequest('/health')
}

export function sendDecision(threadId, decision, comment) {
  return jsonRequest(`/assessments/${threadId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment: comment || null }),
  })
}

export function askQuestion(threadId, question, history) {
  return jsonRequest(`/assessments/${threadId}/qna`, {
    method: 'POST',
    body: JSON.stringify({ question, history }),
  })
}

export async function streamAssessment({ query, profile, horizon }, callbacks) {
  const res = await fetch(`${API_BASE}/assessments/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ query, profile, horizon }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  if (!res.body) throw new Error('No response body from stream endpoint.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flush = (block) => {
    const lines = block.split('\n')
    let event = 'message'
    const dataLines = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return
    let data = {}
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      data = { raw: dataLines.join('\n') }
    }
    if (event === 'started') callbacks.onStarted?.(data)
    else if (event === 'progress') callbacks.onProgress?.(data)
    else if (event === 'result') callbacks.onResult?.(data)
    else if (event === 'error') callbacks.onError?.(data)
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      if (part.trim()) flush(part)
    }
  }
  if (buffer.trim()) flush(buffer)
}
