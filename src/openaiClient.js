import { CHAT_MODEL, MAX_TURNS, SYSTEM_PROMPT } from './chatConfig.js'

const ENDPOINT = 'https://api.openai.com/v1/responses'

function apiError(status, code) {
  if (status === 401) return 'API 키를 확인할 수 없어요. 키를 다시 입력해 주세요.'
  if (status === 403) return '이 키에 모델 사용 권한이 없어요. OpenAI 프로젝트 권한을 확인해 주세요.'
  if (status === 404) return `${CHAT_MODEL} 모델을 사용할 수 없어요. 모델 접근 권한을 확인해 주세요.`
  if (status === 429 && code === 'insufficient_quota') return 'API 잔액 또는 사용 한도가 부족해요. OpenAI 결제 설정을 확인해 주세요.'
  if (status === 429) return '요청이 잠시 몰렸어요. 조금 기다린 후 다시 보내 주세요.'
  if (status >= 500) return 'OpenAI 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.'
  return '요청을 완료하지 못했어요. API 키의 권한과 연결 상태를 확인해 주세요.'
}

// 키는 호출 인자로만 전달하며 파일, URL, 브라우저 저장소에 기록하지 않습니다.
export async function requestReply({ apiKey, messages, turn = 0, signal }) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(abort, 60000)
  try {
    const phase = turn === 0
      ? '학생이 활동을 시작했어. 짧게 환영하고 오늘 학교 공부가 어땠는지 첫 질문을 해. 이 인사는 대화 횟수에 포함되지 않아.'
      : `지금은 학생의 ${turn}번째 이야기에 답하는 중이야. ${turn >= MAX_TURNS ? '마지막 응답이니 새 질문을 하지 말고 오늘 이야기를 한두 문장으로 따뜻하게 마무리해. 화면의 종료 버튼을 누르면 그림을 그릴 수 있다고 안내해.' : '앞선 대화를 참고해 자연스럽게 이어 가. 학생은 3회부터 종료 버튼을 누를 수 있으니 더 말하도록 강요하지 마.'}`
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        instructions: `${SYSTEM_PROMPT}\n${phase}`,
        input: messages.length ? messages : [{ role: 'user', content: '활동을 시작할게요.' }],
        reasoning: { effort: 'none' },
        max_output_tokens: 1000,
        store: false,
      }),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(apiError(response.status, data?.error?.code))
    if (data?.status !== 'completed') throw new Error('답변이 끝까지 도착하지 않았어요. 같은 이야기를 다시 보내 주세요. 대화 횟수는 늘어나지 않았어요.')
    const text = (data.output ?? [])
      .filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content ?? [])
      .map(item => item.type === 'output_text' ? item.text : item.type === 'refusal' ? item.refusal : '')
      .filter(Boolean).join('\n').trim()
    if (!text) throw new Error('비어 있는 답변이 도착했어요. 다시 시도해 주세요. 대화 횟수는 늘어나지 않았어요.')
    return text
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('연결 시간이 초과되었거나 요청이 취소되었어요. 다시 시도해 주세요.')
    if (error instanceof TypeError) throw new Error('OpenAI에 연결하지 못했어요. 인터넷 연결과 브라우저의 네트워크 제한을 확인해 주세요.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
