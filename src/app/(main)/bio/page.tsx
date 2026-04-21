'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'

type ManyChatChat = {
  id: string
  keyword: string
  contact_name: string | null
  contact_ig_username: string | null
  received_at: string
}

type BioEntry = { id: string; name: string | null; date: string | null; chats: number; cash: number; notes: string | null }

type ManyChatTag = { id: number; name: string }

type LeadRow = { ig_handle: string | null; status: string | null; program_purchased: string | null; payment: number | null; entry_channel: string | null }

export default function BioPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [autoChats, setAutoChats] = useState<ManyChatChat[]>([])
  const [manualEntries, setManualEntries] = useState<BioEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Record<string, string>>({ chats: '0' })
  const [tab, setTab] = useState<'auto' | 'manual'>('auto')
  const [leads, setLeads] = useState<LeadRow[]>([])

  // Tags state
  const [tags, setTags] = useState<ManyChatTag[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [activeTag, setActiveTag] = useState<{ id: number; name: string } | null>(null)
  const [showTagSelector, setShowTagSelector] = useState(false)
  const [connectionId, setConnectionId] = useState<string | null>(null)

  // Automation response rate
  const [autoResponseTag, setAutoResponseTag] = useState<{ id: number; name: string } | null>(null)
  const [autoResponseCount, setAutoResponseCount] = useState<number | null>(null)
  const [showAutoTagSelector, setShowAutoTagSelector] = useState(false)
  const [autoTagLoading, setAutoTagLoading] = useState(false)

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)

    // Fetch auto chats from manychat_chats
    const { data: chats } = await supabase
      .from('manychat_chats')
      .select('*')
      .eq('month', month)
      .order('received_at', { ascending: false })
    setAutoChats((chats as ManyChatChat[]) || [])

    // Fetch manual entries (legacy)
    const { data: entries } = await supabase
      .from('bio_entries')
      .select('*')
      .eq('month', month)
      .order('created_at', { ascending: false })
    setManualEntries((entries as BioEntry[]) || [])

    // Fetch leads for the month
    const { data: leadsData } = await supabase
      .from('leads')
      .select('ig_handle, status, program_purchased, payment, entry_channel')
      .eq('month', month)
    setLeads((leadsData as LeadRow[]) || [])

    // Check ManyChat connection
    const { data: conn } = await supabase
      .from('api_connections')
      .select('id, credentials')
      .eq('platform', 'manychat')
      .maybeSingle()
    setIsConnected(!!conn?.credentials?.webhook_token)
    setHasApiKey(!!conn?.credentials?.api_key)
    setConnectionId(conn?.id || null)
    if (conn?.credentials?.bio_tag_id) {
      setActiveTag({ id: conn.credentials.bio_tag_id, name: conn.credentials.bio_tag_name || '' })
    }
    if (conn?.credentials?.auto_response_tag_id) {
      setAutoResponseTag({ id: conn.credentials.auto_response_tag_id, name: conn.credentials.auto_response_tag_name || '' })
    }

    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // Fetch automation response count when tag is set
  useEffect(() => {
    if (!autoResponseTag || !hasApiKey) return
    setAutoTagLoading(true)
    fetch(`/api/sync/manychat?action=tag_contacts&tag_id=${autoResponseTag.id}`)
      .then(r => r.json())
      .then(d => {
        const contacts = d.contacts || []
        setAutoResponseCount(Array.isArray(contacts) ? contacts.length : 0)
      })
      .catch(() => setAutoResponseCount(0))
      .finally(() => setAutoTagLoading(false))
  }, [autoResponseTag, hasApiKey])

  const addManualEntry = async () => {
    if (!userId) return
    await supabase.from('bio_entries').insert({
      user_id: userId, month,
      name: form.semana || null, date: form.date || null,
      chats: Number(form.chats) || 0, cash: Number(form.cash) || 0,
      notes: form.notes || null,
    })
    toast('Semana agregada ✓')
    setForm({ chats: '0' }); fetchData()
  }

  const deleteManualEntry = async (id: string) => {
    await supabase.from('bio_entries').delete().eq('id', id)
    toast('Eliminado ✓'); fetchData()
  }

  const deleteAutoChat = async (id: string) => {
    await supabase.from('manychat_chats').delete().eq('id', id)
    toast('Eliminado ✓'); fetchData()
  }

  const fetchTags = async () => {
    setTagsLoading(true)
    try {
      const resp = await fetch('/api/sync/manychat?action=tags')
      const data = await resp.json()
      if (data.error) { toast(data.error); return }
      setTags(data.tags || [])
      setShowTagSelector(true)
    } catch { toast('Error al traer etiquetas') }
    finally { setTagsLoading(false) }
  }

  const selectBioTag = async (tag: ManyChatTag) => {
    if (!connectionId) return
    // Update api_connections with the selected tag
    const { data: conn } = await supabase
      .from('api_connections')
      .select('credentials')
      .eq('id', connectionId)
      .single()
    const creds = conn?.credentials || {}
    await supabase
      .from('api_connections')
      .update({ credentials: { ...creds, bio_tag_id: tag.id, bio_tag_name: tag.name }, updated_at: new Date().toISOString() })
      .eq('id', connectionId)
    setActiveTag({ id: tag.id, name: tag.name })
    setShowTagSelector(false)
    toast(`Etiqueta "${tag.name}" seleccionada como keyword de bio ✓`)
  }

  const selectAutoResponseTag = async (tag: ManyChatTag) => {
    if (!connectionId) return
    const { data: conn } = await supabase.from('api_connections').select('credentials').eq('id', connectionId).single()
    const creds = conn?.credentials || {}
    await supabase.from('api_connections').update({
      credentials: { ...creds, auto_response_tag_id: tag.id, auto_response_tag_name: tag.name },
      updated_at: new Date().toISOString(),
    }).eq('id', connectionId)
    setAutoResponseTag({ id: tag.id, name: tag.name })
    setShowAutoTagSelector(false)
    toast(`Etiqueta "${tag.name}" seleccionada para tasa de respuesta ✓`)
  }

  // Totals
  const autoTotal = autoChats.length
  const manualTotal = manualEntries.reduce((s, e) => s + (e.chats || 0), 0)
  const totalChats = autoTotal + manualTotal

  // Group auto chats by keyword
  const byKeyword = autoChats.reduce<Record<string, ManyChatChat[]>>((acc, c) => {
    const kw = c.keyword?.toUpperCase() || 'SIN KEYWORD'
    if (!acc[kw]) acc[kw] = []
    acc[kw].push(c)
    return acc
  }, {})

  // Leads lookup map (ig_handle -> lead data)
  const leadMap = leads.reduce<Record<string, LeadRow>>((acc, l) => {
    if (l.ig_handle) acc[l.ig_handle.replace(/^@/, '').toLowerCase()] = l
    return acc
  }, {})

  // Cash por chat: total cash from BIO leads / totalChats
  const bioCash = leads
    .filter(l => l.entry_channel && /bio/i.test(l.entry_channel))
    .reduce((sum, l) => sum + (l.payment || 0), 0)
  const cashPerChat = totalChats > 0 ? bioCash / totalChats : 0

  // Tasa de respuesta a la automatizacion
  // = gente que respondió al mensaje automático / gente que escribió la keyword
  const autoResponseRate = autoResponseCount !== null && autoTotal > 0
    ? (autoResponseCount / autoTotal) * 100
    : null

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">BIO <span className="text-[var(--text2)]">Canal directo</span></h2>
        <div className="flex items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
          <div className="text-right">
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
            <div className="font-mono-num text-2xl font-bold">{totalChats}</div>
          </div>
        </div>
      </div>

      {/* Connection status + active tag */}
      <div className="glass-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] mb-1">Canal Directo</div>
            <p className="text-[13px] text-[var(--text2)]">
              {isConnected
                ? 'Conectado con ManyChat — los chats se registran automaticamente.'
                : 'Chats que entran por la keyword de tu bio. Conecta ManyChat para trackeo automatico.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Active tag badge */}
            {activeTag && (
              <div className="flex items-center gap-2 rounded-lg bg-[rgba(230,57,70,0.1)] border border-[rgba(230,57,70,0.2)] px-3 py-1.5">
                <span className="text-[11px] text-[var(--text3)] uppercase">Etiqueta:</span>
                <span className="text-[12px] font-semibold text-[var(--accent)]">{activeTag.name}</span>
              </div>
            )}
            {/* Change tag button */}
            {hasApiKey && (
              <button
                onClick={fetchTags}
                disabled={tagsLoading}
                className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
              >
                {tagsLoading ? '...' : activeTag ? 'Cambiar' : 'Elegir etiqueta'}
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[var(--green)] shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-[var(--text3)]'}`} />
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">
                {isConnected ? 'ManyChat activo' : 'Manual'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tag selector modal */}
      {showTagSelector && tags.length > 0 && (
        <div className="glass-card p-5 mb-6 border-[var(--accent)] border">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--accent)]">
              Elegir etiqueta de bio
            </div>
            <button onClick={() => setShowTagSelector(false)} className="text-[var(--text3)] hover:text-[var(--text)] text-sm">✕</button>
          </div>
          <p className="text-[12px] text-[var(--text3)] mb-4">
            Selecciona la etiqueta que ManyChat le pone a los contactos que escriben por tu bio. Los chats futuros se trackean automaticamente.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[300px] overflow-y-auto">
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={() => selectBioTag(tag)}
                className={`rounded-lg p-3 text-left transition-all border ${
                  activeTag?.id === tag.id
                    ? 'border-[var(--accent)] bg-[rgba(230,57,70,0.1)]'
                    : 'border-[var(--border)] bg-[var(--bg3)] hover:border-[var(--border2)]'
                }`}
              >
                <div className="text-[13px] font-semibold truncate">{tag.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Auto response tag selector */}
      {showAutoTagSelector && tags.length > 0 && (
        <div className="glass-card p-5 mb-6 border-amber-500/30 border">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-medium uppercase tracking-widest text-amber-400">
              Elegir etiqueta de respuesta a la automatizacion
            </div>
            <button onClick={() => setShowAutoTagSelector(false)} className="text-[var(--text3)] hover:text-[var(--text)] text-sm">✕</button>
          </div>
          <p className="text-[12px] text-[var(--text3)] mb-4">
            Selecciona la etiqueta que ManyChat le pone a los contactos que RESPONDEN al mensaje automatico. Esto calcula la tasa de respuesta.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[300px] overflow-y-auto">
            {tags.map(tag => (
              <button key={tag.id} onClick={() => selectAutoResponseTag(tag)}
                className={`rounded-lg p-3 text-left transition-all border ${autoResponseTag?.id === tag.id ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--border)] bg-[var(--bg3)] hover:border-[var(--border2)]'}`}>
                <div className="text-[13px] font-semibold truncate">{tag.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats totales</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{totalChats}</div>
          {autoTotal > 0 && manualTotal > 0 && (
            <div className="mt-1 text-[10px] text-[var(--text3)]">{autoTotal} auto + {manualTotal} manual</div>
          )}
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash por chat</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{formatCash(cashPerChat)}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Tasa de respuesta automatizacion</div>
          {autoResponseTag ? (
            <>
              <div className="font-mono-num mt-1 text-3xl font-bold">
                {autoTagLoading ? '...' : autoResponseRate !== null ? `${autoResponseRate.toFixed(0)}%` : '—'}
              </div>
              {autoResponseCount !== null && !autoTagLoading && (
                <div className="mt-1 text-[10px] text-[var(--text3)]">{autoResponseCount} respondieron / {autoTotal} escribieron</div>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[9px] text-[var(--accent)] truncate max-w-[120px]">{autoResponseTag.name}</span>
                {hasApiKey && (
                  <button onClick={() => { if (tags.length === 0) fetchTags().then(() => setShowAutoTagSelector(true)); else setShowAutoTagSelector(true) }}
                    className="text-[9px] text-[var(--text3)] hover:text-[var(--accent)] underline">cambiar</button>
                )}
              </div>
            </>
          ) : (
            <div className="mt-2">
              {hasApiKey ? (
                <button onClick={() => { if (tags.length === 0) fetchTags(); setShowAutoTagSelector(true) }}
                  className="rounded-lg border border-dashed border-[var(--border2)] px-3 py-2 text-[11px] text-[var(--text3)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all w-full text-center">
                  Elegir etiqueta →
                </button>
              ) : (
                <div className="text-[11px] text-[var(--text3)]">Configura ManyChat API key</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg bg-[var(--bg3)] w-fit">
        <button
          onClick={() => setTab('auto')}
          className={`px-4 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-all ${tab === 'auto' ? 'bg-[var(--bg)] text-[var(--text)] shadow-sm' : 'text-[var(--text3)] hover:text-[var(--text2)]'}`}
        >
          Automatico ({autoTotal})
        </button>
        <button
          onClick={() => setTab('manual')}
          className={`px-4 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-all ${tab === 'manual' ? 'bg-[var(--bg)] text-[var(--text)] shadow-sm' : 'text-[var(--text3)] hover:text-[var(--text2)]'}`}
        >
          Manual ({manualTotal})
        </button>
      </div>

      {/* Auto tab */}
      {tab === 'auto' && (
        <>
          {autoChats.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <div className="text-[var(--text3)] text-[13px]">
                {isConnected
                  ? 'Sin chats automaticos este mes. Cuando alguien escriba tu keyword, aparecera aca.'
                  : 'Conecta ManyChat en Conexiones API para trackear chats automaticamente.'}
              </div>
            </div>
          ) : (
            <>
              {/* Keyword breakdown */}
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(byKeyword).map(([kw, chats]) => (
                  <div key={kw} className="rounded-lg bg-[rgba(230,57,70,0.1)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent)]">
                    {kw} <span className="ml-1 font-mono-num opacity-70">{chats.length}</span>
                  </div>
                ))}
              </div>

              {/* Chat list */}
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_0.8fr_0.8fr_0.5fr_30px] gap-3 px-4 py-2">
                  {['Instagram', 'Estado del lead', 'Keyword', 'Fecha', '', ''].map((h, i) => (
                    <div key={`${h}-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{h}</div>
                  ))}
                </div>
                {autoChats.map(c => {
                  const handle = c.contact_ig_username?.toLowerCase() || ''
                  const lead = leadMap[handle]
                  const leadStatus = lead?.status || null
                  const leadProgram = lead?.program_purchased || null
                  return (
                    <div key={c.id} className="glass-card grid grid-cols-[1fr_1fr_0.8fr_0.8fr_0.5fr_30px] gap-3 px-4 py-3 items-center">
                      <div className="text-[13px] text-[var(--text2)] truncate">{c.contact_ig_username ? `@${c.contact_ig_username}` : '—'}</div>
                      <div>
                        {leadStatus ? (
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                            leadStatus === 'Cerrado' ? 'bg-green-500/15 text-green-400' :
                            leadStatus === 'Seguimiento' ? 'bg-amber-500/15 text-amber-400' :
                            'bg-red-500/15 text-red-400'
                          }`}>
                            {leadStatus}{leadProgram ? ` (${leadProgram})` : ''}
                          </span>
                        ) : <span className="text-[11px] text-[var(--text3)] italic">—</span>}
                      </div>
                      <div>
                        <span className="rounded bg-[rgba(230,57,70,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                          {c.keyword?.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[12px] text-[var(--text3)]">
                        {new Date(c.received_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                      </div>
                      <div />
                      <button onClick={() => deleteAutoChat(c.id)} className="text-[var(--text3)] hover:text-[var(--red)] text-sm">×</button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Manual tab */}
      {tab === 'manual' && (
        <>
          <div className="glass-card p-6 mb-6">
            <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] mb-4">Cargar Semana</div>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Semana</label>
                <input type="text" value={form.semana || ''} onChange={e => setForm(p => ({ ...p, semana: e.target.value }))} placeholder="Ej: Semana 1 Mar"
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Keyword activa</label>
                <input type="text" value={form.keyword || ''} onChange={e => setForm(p => ({ ...p, keyword: e.target.value }))} placeholder="Ej: EV, SISTEMA..."
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Chats recibidos</label>
                <input type="number" value={form.chats || '0'} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Notas</label>
                <input type="text" value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Observaciones..."
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
              </div>
            </div>
            <button onClick={addManualEntry} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">+ Agregar Semana</button>
          </div>

          {manualEntries.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[var(--text3)]">Sin entradas manuales este mes.</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1.5fr_1fr_0.5fr_2fr_30px] gap-3 px-4 py-2">
                {['Semana', 'Keyword', 'Chats', 'Notas', ''].map(h => (
                  <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{h}</div>
                ))}
              </div>
              {manualEntries.map(e => (
                <div key={e.id} className="glass-card grid grid-cols-[1.5fr_1fr_0.5fr_2fr_30px] gap-3 px-4 py-3 items-center">
                  <div className="text-[13px]">{e.name || '—'}</div>
                  <div>{e.notes?.includes('EV') || e.notes?.includes('SISTEMA') ? (
                    <span className="rounded bg-[rgba(230,57,70,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">{e.notes?.match(/(EV|SISTEMA|SOP|INFO)/)?.[0] || '—'}</span>
                  ) : '—'}</div>
                  <div className="font-mono-num text-[14px] font-semibold">{e.chats || 0}</div>
                  <div className="text-[12px] text-[var(--text2)]">{e.notes || '—'}</div>
                  <button onClick={() => deleteManualEntry(e.id)} className="text-[var(--text3)] hover:text-[var(--red)] text-sm">×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
