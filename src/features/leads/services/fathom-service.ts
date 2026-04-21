import crypto from 'crypto'

const FATHOM_API_KEY = process.env.FATHOM_API_KEY || ''
const FATHOM_WEBHOOK_SECRET = process.env.FATHOM_WEBHOOK_SECRET || ''
const FATHOM_BASE_URL = 'https://api.fathom.ai/external/v1'

// Verificar firma del webhook de Fathom
export function verifyFathomWebhook(
  body: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string
): boolean {
  if (!FATHOM_WEBHOOK_SECRET) return false

  // Extraer secret sin el prefijo "whsec_"
  const secret = FATHOM_WEBHOOK_SECRET.replace('whsec_', '')
  const secretBytes = Buffer.from(secret, 'base64')

  // Construir signed content: id.timestamp.body
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`

  // HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secretBytes)
  hmac.update(signedContent)
  const expectedSignature = hmac.digest('base64')

  // Verificar contra las firmas (pueden ser múltiples separadas por espacio)
  const signatures = webhookSignature.split(' ')
  return signatures.some(sig => {
    const sigValue = sig.replace(/^v1,/, '')
    return crypto.timingSafeEqual(
      Buffer.from(sigValue),
      Buffer.from(expectedSignature)
    )
  })
}

// Validar que el timestamp no sea mayor a 5 minutos
export function isTimestampValid(timestamp: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  const ts = parseInt(timestamp, 10)
  return Math.abs(now - ts) < 300
}

// Obtener transcripción de un meeting via Fathom API
export async function getFathomTranscript(meetingUrl: string, apiKey?: string): Promise<string> {
  const key = apiKey || FATHOM_API_KEY
  const res = await fetch(`${FATHOM_BASE_URL}/meetings?include_transcript=true`, {
    headers: { 'X-Api-Key': key },
  })

  if (!res.ok) throw new Error(`Fathom API error: ${res.status}`)

  const data = await res.json()
  const meeting = data.items?.find((m: FathomMeeting) => m.url === meetingUrl || m.share_url === meetingUrl)

  if (!meeting?.transcript) throw new Error('Transcript not found')

  // Formatear transcripción como texto legible
  return meeting.transcript
    .map((t: { speaker_name: string; text: string }) => `${t.speaker_name}: ${t.text}`)
    .join('\n')
}

// Tipos del payload de Fathom webhook
export type FathomWebhookPayload = {
  url: string
  share_url: string
  title: string
  meeting_title: string
  created_at: string
  recording_start_time: string
  recording_end_time: string
  calendar_invitees: Array<{
    name: string
    email: string
    is_internal: boolean
  }>
  transcript?: Array<{
    speaker_name: string
    text: string
    timestamp: number
  }>
  default_summary?: {
    template_name: string
    markdown_formatted: string
  }
  action_items?: Array<{
    description: string
    completed: boolean
  }>
}

type FathomMeeting = {
  url: string
  share_url: string
  transcript?: Array<{ speaker_name: string; text: string }>
}

// Extraer email externo del participante (el lead, no el closer)
export function getExternalEmail(payload: FathomWebhookPayload): string | null {
  const external = payload.calendar_invitees?.find(i => !i.is_internal)
  return external?.email || null
}

// Extraer fecha de la llamada
export function getCallDate(payload: FathomWebhookPayload): string {
  const date = payload.recording_start_time || payload.created_at
  return date.split('T')[0]
}
