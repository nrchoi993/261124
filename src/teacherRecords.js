const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})
const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function timestampMillis(value) {
  if (value == null) return null
  const ms = typeof value.toMillis === 'function' ? value.toMillis()
    : typeof value === 'number' ? value
      : typeof value.seconds === 'number' ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6 : NaN
  return Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime()) ? ms : null
}

export function normalizeActivity(record) {
  const timestamp = [record.submittedAtClient, record.savedAt, record.chatEndedAt, record.chatStartedAt]
    .map(timestampMillis).find(value => value !== null)
  const parts = timestamp == null ? [] : dateFormatter.formatToParts(timestamp)
  const part = type => parts.find(item => item.type === type)?.value
  const dateKey = timestamp == null ? 'unknown' : `${part('year')}-${part('month')}-${part('day')}`
  const stamp = timestamp == null ? '날짜 정보 없음' : `${dateKey} ${timeFormatter.format(timestamp)}`
  const displayName = typeof record.displayName === 'string' && record.displayName.trim() ? record.displayName : '이름 정보 없음'
  return { ...record, displayName, timestamp: timestamp ?? -Infinity, dateKey, label: `${displayName} (${stamp})` }
}

export function availableDates(records) {
  return [...new Set(records.map(record => record.dateKey))].sort((a, b) => a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a))
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '기록 없음'
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}
