import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// POST /api/webhooks/manychat — Recibe eventos de ManyChat y loguea chats
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { webhook_token, keyword, contact_name, contact_ig_username, manychat_contact_id } = body

    if (!webhook_token || !keyword) {
      return NextResponse.json({ error: 'Missing webhook_token or keyword' }, { status: 400 })
    }

    // Usar supabase con anon key — la funcion RPC usa SECURITY DEFINER
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data, error } = await supabase.rpc('log_manychat_chat', {
      p_webhook_token: webhook_token,
      p_keyword: keyword,
      p_contact_name: contact_name || null,
      p_contact_ig_username: contact_ig_username || null,
      p_manychat_contact_id: manychat_contact_id || null,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data?.error) {
      return NextResponse.json({ error: data.error }, { status: 401 })
    }

    // Cachear contacto en manychat_contacts para enriquecimiento de leads
    if (contact_ig_username && manychat_contact_id && !manychat_contact_id.includes('{{')) {
      try {
        // Leer API key de BD, fallback a env var
        const { data: mcConn } = await supabase.from('api_connections').select('credentials').eq('platform', 'manychat').limit(1).single()
        const mcApiKey = (mcConn?.credentials as Record<string, string>)?.api_key || process.env.MANYCHAT_API_KEY
        if (mcApiKey) {
          const subRes = await fetch(`https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${manychat_contact_id}`, {
            headers: { 'Authorization': `Bearer ${mcApiKey}` },
          })
          if (subRes.ok) {
            const subData = await subRes.json()
            if (subData.status === 'success' && subData.data) {
              const tags = (subData.data.tags || []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }))
              await supabase.from('manychat_contacts').upsert({
                ig_username: contact_ig_username.toLowerCase(),
                subscriber_id: manychat_contact_id,
                tags: JSON.stringify(tags),
                subscribed_at: subData.data.subscribed,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'ig_username' })
            }
          }
        }
      } catch { /* no fallar si el cacheo falla */ }
    }

    // If tag_name is provided, increment chats on linked content_items
    const tag_name = body.tag_name || body.keyword
    if (tag_name) {
      try {
        await supabase.rpc('increment_content_chats_by_tag', { p_tag_name: tag_name })
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ success: true, chat_id: data?.chat_id })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// GET para que ManyChat pueda verificar que el endpoint existe
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'manychat-webhook' })
}
