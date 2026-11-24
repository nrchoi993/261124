import { teacherData } from './teacherData.js'
import { availableDates, formatDuration, normalizeActivity } from './teacherRecords.js'

export function mountTeacherDashboard() {
  const $ = id => document.getElementById(id)
  let records = []
  let selectedDates = new Set()
  let allDates = true
  let selectedId = null
  let unsubscribe = null
  let subscriptionVersion = 0
  let imageVersion = 0
  let imageUrl = null
  let deleteTarget = null
  let deleting = false
  let alive = true
  const listeners = []
  const dialog = $('delete-activity-dialog')

  function listen(element, event, handler) {
    element.addEventListener(event, handler)
    listeners.push(() => element.removeEventListener(event, handler))
  }
  function status(id, text, error = false) {
    $(id).textContent = text
    $(id).classList.toggle('is-error', error)
  }
  function visibleRecords() { return records.filter(record => selectedDates.has(record.dateKey)) }
  function clearImage() {
    imageVersion += 1
    $('teacher-drawing-image').hidden = true
    $('teacher-drawing-image').removeAttribute('src')
    $('retry-teacher-image').hidden = true
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    imageUrl = null
  }
  function clearDetails() {
    selectedId = null
    clearImage()
    $('selected-activity-label').textContent = '왼쪽에서 활동 기록을 선택해 주세요.'
    $('selected-activity-email').textContent = ''
    $('activity-durations').hidden = true
    const placeholder = document.createElement('p')
    placeholder.className = 'detail-placeholder'
    placeholder.textContent = '학생이 남긴 이야기가 이곳에 표시돼요.'
    $('teacher-messages').replaceChildren(placeholder)
    status('teacher-image-status', '활동 기록을 선택하면 그림을 볼 수 있어요.')
  }

  async function loadImage(record) {
    clearImage()
    const version = imageVersion
    status('teacher-image-status', '그림을 불러오고 있어요.')
    try {
      const blob = await teacherData.loadDrawing(record)
      if (!alive || version !== imageVersion || selectedId !== record.id) return
      imageUrl = URL.createObjectURL(blob)
      const image = $('teacher-drawing-image')
      image.onload = () => {
        if (alive && version === imageVersion) status('teacher-image-status', '')
      }
      image.onerror = () => {
        if (!alive || version !== imageVersion) return
        image.hidden = true
        status('teacher-image-status', '그림을 표시하지 못했어요. 다시 불러와 주세요.', true)
        $('retry-teacher-image').hidden = false
      }
      image.alt = `${record.label} 학생이 제출한 그림`
      image.src = imageUrl
      image.hidden = false
    } catch (error) {
      if (!alive || version !== imageVersion) return
      status('teacher-image-status', error.code === 'storage/object-not-found'
        ? '저장된 그림을 찾을 수 없어요.'
        : '그림을 불러오지 못했어요. 저장소 권한과 연결 상태를 확인해 주세요.', true)
      $('retry-teacher-image').hidden = false
    }
  }

  function showDetails(record) {
    selectedId = record.id
    $('selected-activity-label').textContent = record.label
    $('selected-activity-email').textContent = typeof record.email === 'string' ? record.email : ''
    $('activity-durations').hidden = false
    $('selected-chat-duration').textContent = formatDuration(record.chatDurationMs)
    $('selected-drawing-duration').textContent = formatDuration(record.drawingDurationMs)
    const fragment = document.createDocumentFragment()
    for (const message of Array.isArray(record.messages) ? record.messages : []) {
      if (typeof message?.content !== 'string') continue
      const article = document.createElement('article')
      article.className = `monitor-message${message.role === 'user' ? ' monitor-message-user' : ''}`
      const author = document.createElement('p')
      author.className = 'monitor-message-author'
      author.textContent = message.role === 'user' ? record.displayName : '마음 챗봇'
      const text = document.createElement('p')
      text.className = 'monitor-message-content'
      text.textContent = message.content
      article.append(author, text)
      fragment.append(article)
    }
    if (!fragment.childNodes.length) {
      const empty = document.createElement('p')
      empty.className = 'detail-placeholder'
      empty.textContent = '저장된 대화가 없어요.'
      fragment.append(empty)
    }
    $('teacher-messages').replaceChildren(fragment)
    $('teacher-messages').scrollTop = 0
    loadImage(record)
  }

  function renderDates() {
    const focusedDate = document.activeElement?.dataset.date
    const dates = availableDates(records)
    const fragment = document.createDocumentFragment()
    for (const date of dates) {
      const label = document.createElement('label')
      label.className = 'activity-date-option'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.dataset.date = date
      input.checked = selectedDates.has(date)
      input.setAttribute('aria-label', date === 'unknown' ? '날짜 정보 없음' : date)
      const text = document.createElement('span')
      text.textContent = `${date === 'unknown' ? '날짜 정보 없음' : date} (${records.filter(record => record.dateKey === date).length}건)`
      label.append(input, text)
      fragment.append(label)
    }
    $('activity-dates').replaceChildren(fragment)
    $('select-all-dates').disabled = !dates.length
    $('clear-all-dates').disabled = !dates.length
    if (focusedDate) [...$('activity-dates').querySelectorAll('input')].find(input => input.dataset.date === focusedDate)?.focus()
  }

  function renderList() {
    const visible = visibleRecords()
    if (selectedId && !visible.some(record => record.id === selectedId)) clearDetails()
    const fragment = document.createDocumentFragment()
    for (const record of visible) {
      const li = document.createElement('li')
      li.className = 'activity-row'
      const select = document.createElement('button')
      select.type = 'button'
      select.className = 'activity-select'
      select.dataset.activityId = record.id
      select.setAttribute('aria-pressed', String(selectedId === record.id))
      select.textContent = record.label
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'activity-delete monitor-text-button'
      remove.dataset.deleteId = record.id
      remove.textContent = '삭제'
      remove.setAttribute('aria-label', `${record.label} 기록 삭제`)
      remove.disabled = deleting
      li.append(select, remove)
      fragment.append(li)
    }
    const scrollTop = $('activity-list').scrollTop
    $('activity-list').replaceChildren(fragment)
    $('activity-list').scrollTop = scrollTop
    $('activity-count').textContent = `${visible.length}건 / 전체 ${records.length}건`
    status('activity-list-status', !records.length ? '아직 제출된 활동이 없어요.'
      : !selectedDates.size ? '확인할 날짜를 선택해 주세요.' : !visible.length ? '선택한 날짜에 활동이 없어요.' : '')
  }

  function applyRecords(incoming) {
    records = incoming.map(normalizeActivity).sort((a, b) => (b.timestamp - a.timestamp) || a.id.localeCompare(b.id))
    const dates = availableDates(records)
    selectedDates = allDates ? new Set(dates) : new Set([...selectedDates].filter(date => dates.includes(date)))
    renderDates()
    renderList()
    const selected = records.find(record => record.id === selectedId)
    if (selected) showDetails(selected)
  }

  async function refresh() {
    const version = ++subscriptionVersion
    unsubscribe?.()
    unsubscribe = null
    status('activity-list-status', '기록을 불러오고 있어요.')
    try {
      const stop = await teacherData.watchActivities(incoming => {
        if (alive && version === subscriptionVersion) applyRecords(incoming)
      }, error => {
        if (!alive || version !== subscriptionVersion) return
        applyRecords([])
        status('activity-list-status', error.code === 'permission-denied'
          ? '조회 권한이 없어요. Firebase 관리자 규칙을 확인한 뒤 새로고침해 주세요.'
          : '기록을 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.', true)
      })
      if (!alive || version !== subscriptionVersion) stop()
      else unsubscribe = stop
    } catch {
      if (!alive || version !== subscriptionVersion) return
      applyRecords([])
      status('activity-list-status', '기록을 불러오지 못했어요. 권한과 연결 상태를 확인하고 새로고침해 주세요.', true)
    }
  }

  listen($('activity-dates'), 'change', event => {
    const date = event.target.dataset.date
    if (!date) return
    allDates = false
    if (event.target.checked) selectedDates.add(date)
    else selectedDates.delete(date)
    renderList()
  })
  listen($('select-all-dates'), 'click', () => {
    allDates = true
    selectedDates = new Set(availableDates(records))
    renderDates()
    renderList()
  })
  listen($('clear-all-dates'), 'click', () => {
    allDates = false
    selectedDates.clear()
    renderDates()
    renderList()
  })
  listen($('refresh-activities'), 'click', refresh)
  listen($('activity-list'), 'click', event => {
    const select = event.target.closest('[data-activity-id]')
    const remove = event.target.closest('[data-delete-id]')
    if (select) {
      const record = records.find(item => item.id === select.dataset.activityId)
      if (record) {
        showDetails(record)
        renderList()
        const active = [...$('activity-list').querySelectorAll('[data-activity-id]')].find(button => button.dataset.activityId === record.id)
        active?.focus({ preventScroll: true })
      }
    } else if (remove && !deleting) {
      deleteTarget = records.find(item => item.id === remove.dataset.deleteId)
      if (!deleteTarget) return
      $('delete-activity-label').textContent = deleteTarget.label
      $('confirm-delete-activity').textContent = '기록과 그림 삭제'
      status('delete-dialog-status', '')
      dialog.showModal()
      $('cancel-delete-activity').focus()
    }
  })
  listen($('retry-teacher-image'), 'click', () => {
    const selected = records.find(record => record.id === selectedId)
    if (selected) loadImage(selected)
  })
  listen($('cancel-delete-activity'), 'click', () => { if (!deleting) dialog.close() })
  listen(dialog, 'cancel', event => { if (deleting) event.preventDefault() })
  listen($('confirm-delete-activity'), 'click', async () => {
    if (deleting || !deleteTarget) return
    const target = deleteTarget
    deleting = true
    $('confirm-delete-activity').disabled = true
    $('cancel-delete-activity').disabled = true
    status('delete-dialog-status', '기록과 그림을 삭제하고 있어요.')
    try {
      await teacherData.deleteActivity(target)
      if (!alive) return
      applyRecords(records.filter(record => record.id !== target.id))
      dialog.close()
      deleteTarget = null
      status('teacher-action-status', `${target.label} 기록과 그림을 삭제했어요.`)
    } catch (error) {
      if (!alive) return
      status('delete-dialog-status', error.partialDeletion
        ? '그림은 삭제했지만 활동 기록을 지우지 못했어요. 다시 삭제하면 남은 기록을 정리해요.'
        : '삭제하지 못했어요. 권한과 연결 상태를 확인한 후 다시 시도해 주세요.', true)
      $('confirm-delete-activity').textContent = '다시 삭제하기'
    } finally {
      deleting = false
      if (alive) {
        $('confirm-delete-activity').disabled = false
        $('cancel-delete-activity').disabled = false
        renderList()
      }
    }
  })
  refresh()

  return {
    destroy() {
      alive = false
      subscriptionVersion += 1
      unsubscribe?.()
      listeners.forEach(remove => remove())
      records = []
      clearDetails()
      $('activity-list').replaceChildren()
      $('activity-dates').replaceChildren()
      if (dialog.open) dialog.close()
    },
  }
}
