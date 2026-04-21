'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { getMonthRange, formatCash } from '@/shared/lib/supabase/queries'
import { Doughnut } from '@/shared/components/charts'

/* ---------- Types ---------- */

type ContentItem = {
  id: string
  title: string | null
  content_type: string
  cash: number
  chats: number
  url: string | null
  notes: string | null
  external_id: string | null
  metrics: Record<string, unknown> | null
  classification: { dolor?: string; angulos?: string[]; cta?: string; transcript?: string; summary?: string; description?: string } | null
  published_at: string
}

type Lead = {
  client_name: string | null
  status: string | null
  payment: number | null
  program_purchased: string | null
  agenda_point: string | null
  entry_channel: string | null
  ig_handle: string | null
}

type Secuencia = {
  id: string
  date: string
  stories: ContentItem[]
  cash: number
  chats: number
  thumbs: string[]
  dolor?: string
  angulos: string[]
  cta?: string
}

type TopItem = { name: string; cash: number; count: number }

const TYPE_COLORS: Record<string, string> = { reel: '#EF4444', historia: '#F59E0B', story: '#F59E0B', video: '#3B82F6' }
const ITEMS_VISIBLE = 4

// Parse "Historia DD/MM/YY" or "Reel DD/MM/YY" into content type + date
function parseContentRef(text: string | null): { type: string; date: string } | null {
  if (!text) return null
  const m = text.match(/^(Historia|Reel)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/i)
  if (!m) return null
  const type = m[1].toLowerCase() === 'historia' ? 'historia' : 'reel'
  const day = m[2].padStart(2, '0')
  const mo = m[3].padStart(2, '0')
  const year = m[4].length === 2 ? `20${m[4]}` : m[4]
  return { type, date: `${year}-${mo}-${day}` }
}

/* ---------- Page ---------- */

export default function CashMetricsPage() {
  const { month, options, setMonth } = useMonthContext()
  const { supabase, ready } = useSupabase()
  const [items, setItems] = useState<ContentItem[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [thumbsFixed, setThumbsFixed] = useState(false)

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const { start, end } = getMonthRange(month)
    const [contentRes, leadsRes] = await Promise.all([
      supabase.from('content_items')
        .select('id, title, content_type, platform, cash, chats, url, notes, external_id, metrics, classification, published_at')
        .gte('published_at', start).lte('published_at', end)
        .order('cash', { ascending: false }),
      supabase.from('leads')
        .select('client_name, status, payment, program_purchased, agenda_point, entry_channel, ig_handle')
        .or('agenda_point.ilike.Historia%,agenda_point.ilike.Reel%,agenda_point.eq.Perfil,agenda_point.eq.perfil,agenda_point.eq.referido'),
    ])
    setItems((contentRes.data || []) as ContentItem[])
    setLeads((leadsRes.data || []) as Lead[])
    setExpanded(null)
    setShowAll({})
    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-fix thumbnails once per session
  useEffect(() => {
    if (!ready || thumbsFixed) return
    setThumbsFixed(true)
    fetch('/api/fix-thumbnails', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.fixed > 0) fetchData() })
      .catch(() => {})
  }, [ready, thumbsFixed, fetchData])

  /* ---------- Derived data ---------- */

  const reels = useMemo(() => items.filter(i => i.content_type === 'reel'), [items])
  const videos = useMemo(() => items.filter(i => i.content_type === 'video'), [items])

  // Group historias/stories into sequences
  const secuencias = useMemo((): Secuencia[] => {
    const getThumbs = (item: ContentItem): string[] => {
      const m = item.metrics as Record<string, unknown> | null
      if (!m) return []
      const out: string[] = []
      // metrics.thumbnails (plural) — array of base64 strings for historia/secuencia
      if (Array.isArray(m.thumbnails)) {
        (m.thumbnails as string[]).forEach(t => { if (t && !out.includes(t)) out.push(t) })
      }
      // metrics.thumbnail (singular) — single URL for story/reel items
      if (typeof m.thumbnail === 'string' && m.thumbnail && !out.includes(m.thumbnail)) out.push(m.thumbnail)
      // metrics.thumbnailHistory — array of URLs or {url,date} objects
      if (Array.isArray(m.thumbnailHistory)) {
        (m.thumbnailHistory as (string | Record<string, unknown>)[]).forEach(t => {
          const url = typeof t === 'string' ? t : (t?.url as string)
          if (url && !out.includes(url)) out.push(url)
        })
      }
      return out
    }

    const historiaItems = items.filter(i => i.content_type === 'historia')
    const storyItems = items.filter(i => i.content_type === 'story')

    // Group raw stories by date
    const storiesByDate: Record<string, ContentItem[]> = {}
    storyItems.forEach(s => {
      const date = s.published_at?.split('T')[0] || 'unknown'
      if (!storiesByDate[date]) storiesByDate[date] = []
      storiesByDate[date].push(s)
    })

    // Build sequences from historia items, enriching with story thumbnails when needed
    const historiaDates = new Set<string>()
    const fromHistorias: Secuencia[] = historiaItems.map(h => {
      const date = h.published_at?.split('T')[0] || ''
      historiaDates.add(date)
      let thumbs = getThumbs(h)
      // If historia has no thumbnails, grab from raw stories of the same date
      if (thumbs.length === 0 && storiesByDate[date]) {
        thumbs = storiesByDate[date].flatMap(getThumbs).filter((t, i, arr) => arr.indexOf(t) === i)
      }
      return {
        id: h.id,
        date,
        stories: [h, ...(storiesByDate[date] || [])],
        cash: h.cash || 0,
        chats: h.chats || 0,
        thumbs: thumbs.slice(0, 4),
        dolor: h.classification?.dolor,
        angulos: h.classification?.angulos || [],
        cta: h.classification?.cta,
      }
    })

    // Remaining story groups that have no historia
    const fromStories: Secuencia[] = Object.entries(storiesByDate)
      .filter(([date]) => !historiaDates.has(date))
      .map(([date, group]) => ({
        id: `seq-${date}`,
        date,
        stories: group,
        cash: group.reduce((s, i) => s + (i.cash || 0), 0),
        chats: group.reduce((s, i) => s + (i.chats || 0), 0),
        thumbs: group.flatMap(getThumbs).filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 4),
        dolor: group.find(s => s.classification?.dolor)?.classification?.dolor,
        angulos: [...new Set(group.flatMap(s => s.classification?.angulos || []))],
        cta: group.find(s => s.classification?.cta)?.classification?.cta,
      }))

    return [...fromHistorias, ...fromStories].sort((a, b) => b.cash - a.cash)
  }, [items])

  // Attribute leads.payment to content items by matching agenda_point type+date
  const leadsCashMap = useMemo(() => {
    // Map: content_item_id → total leads payment
    const map = new Map<string, number>()
    // Map: "type:date" → content_item_id (for matching)
    const contentIndex = new Map<string, string>()

    // Index reels by date
    reels.forEach(r => {
      const d = r.published_at?.split('T')[0]
      if (d) contentIndex.set(`reel:${d}`, r.id)
    })
    // Index secuencias (historias) by date
    secuencias.forEach(s => {
      if (s.date) contentIndex.set(`historia:${s.date}`, s.id)
    })

    // Match leads to content
    leads.forEach(l => {
      const payment = Number(l.payment) || 0
      if (payment <= 0) return
      const ref = parseContentRef(l.agenda_point)
      if (!ref) return
      const key = `${ref.type}:${ref.date}`
      const contentId = contentIndex.get(key)
      if (contentId) {
        map.set(contentId, (map.get(contentId) || 0) + payment)
      }
    })
    return map
  }, [reels, secuencias, leads])

  // Get leads-attributed cash for a content item (fallback to content_items.cash if no leads match)
  const getLeadsCash = (id: string) => leadsCashMap.get(id) ?? 0
  const getLeadsCashForSecuencia = (s: Secuencia) => leadsCashMap.get(s.id) ?? 0

  // Donut data — from leads attribution
  const cashByType = useMemo(() => {
    const m: Record<string, number> = {}
    reels.forEach(r => { m['reel'] = (m['reel'] || 0) + getLeadsCash(r.id) })
    secuencias.forEach(s => { m['historia'] = (m['historia'] || 0) + getLeadsCashForSecuencia(s) })
    videos.forEach(v => { m['video'] = (m['video'] || 0) + getLeadsCash(v.id) })
    return Object.entries(m).filter(([, v]) => v > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reels, secuencias, videos, leadsCashMap])
  const totalCash = cashByType.reduce((s, [, v]) => s + v, 0)
  const donutData = {
    labels: cashByType.map(([k]) => k),
    datasets: [{ data: cashByType.length > 0 ? cashByType.map(([, v]) => v) : [1], backgroundColor: cashByType.length > 0 ? cashByType.map(([k]) => TYPE_COLORS[k] || '#888') : ['#1E1E22'], borderWidth: 0 }],
  }

  // Tops (max 5) — using leads-attributed cash
  // IMPORTANT: only use reels+videos from items, historias come from secuencias to avoid double counting
  const buildTop = useCallback((key: 'dolor' | 'cta'): TopItem[] => {
    const map: Record<string, { cash: number; count: number }> = {}
    // Reels + videos only (not historia/story — those go through secuencias)
    items.filter(i => i.content_type === 'reel' || i.content_type === 'video').forEach(i => {
      const val = i.classification?.[key]
      const cash = getLeadsCash(i.id)
      if (val) { map[val] = map[val] || { cash: 0, count: 0 }; map[val].cash += cash; map[val].count++ }
    })
    // Secuencias (historias)
    secuencias.forEach(s => {
      const cash = getLeadsCashForSecuencia(s)
      const val = key === 'dolor' ? s.dolor : s.cta
      if (val) { map[val] = map[val] || { cash: 0, count: 0 }; map[val].cash += cash; map[val].count++ }
    })
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cash - a.cash).slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, secuencias, leadsCashMap])

  const buildTopAngulos = useCallback((): TopItem[] => {
    const map: Record<string, { cash: number; count: number }> = {}
    // Reels + videos only
    items.filter(i => i.content_type === 'reel' || i.content_type === 'video').forEach(i => {
      const cash = getLeadsCash(i.id)
      ;(i.classification?.angulos || []).forEach(a => { map[a] = map[a] || { cash: 0, count: 0 }; map[a].cash += cash; map[a].count++ })
    })
    // Secuencias (historias)
    secuencias.forEach(s => {
      const cash = getLeadsCashForSecuencia(s)
      s.angulos.forEach(a => { map[a] = map[a] || { cash: 0, count: 0 }; map[a].cash += cash; map[a].count++ })
    })
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cash - a.cash).slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, secuencias, leadsCashMap])

  const topDolores = useMemo(() => buildTop('dolor'), [buildTop])
  const topAngulos = useMemo(() => buildTopAngulos(), [buildTopAngulos])
  const topCtas = useMemo(() => buildTop('cta'), [buildTop])

  const toggleShowAll = (key: string) => setShowAll(p => ({ ...p, [key]: !p[key] }))

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Cash Metrics</h2>
          <p className="text-[12px] text-[var(--text3)] mt-0.5">Cash por contenido</p>
        </div>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Row 1: Donut (big) + 3 Tops */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Donut — larger */}
        <div className="glass-card p-6 flex flex-col items-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)] mb-4 self-start">Cash por contenido</div>
          <div className="relative w-40 h-40 mb-4">
            <Doughnut data={donutData} options={{ plugins: { tooltip: { enabled: true } }, responsive: true, maintainAspectRatio: true, cutout: '68%' }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(totalCash)}</div>
              <div className="text-[9px] text-[var(--text3)]">total</div>
            </div>
          </div>
          <div className="w-full space-y-2">
            {cashByType.map(([type, cash]) => {
              const pct = totalCash > 0 ? ((cash / totalCash) * 100).toFixed(0) : '0'
              return (
                <div key={type} className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[type] }} />
                    <span className="text-[var(--text)] capitalize font-medium">{type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num font-semibold">{formatCash(cash)}</span>
                    <span className="text-[10px] text-[var(--text3)] w-8 text-right">{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 3 Top lists */}
        <TopList title="Top Dolores" items={topDolores} color="#E63946" icon="🎯" />
        <TopList title="Top Angulos" items={topAngulos} color="#F59E0B" icon="📐" />
        <TopList title="Top CTAs" items={topCtas} color="#3B82F6" icon="📣" />
      </div>

      {/* Row 2: 3 content columns */}
      <div className="grid grid-cols-3 gap-5">
        {/* Reels */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS.reel }} />
            <span className="text-[12px] font-semibold uppercase tracking-wider">Dinero por Reel</span>
            <span className="text-[10px] text-[var(--text3)]">({reels.length})</span>
          </div>
          <div className="space-y-3">
            {(showAll.reel ? reels : reels.slice(0, ITEMS_VISIBLE)).map(item => (
              <ReelCard key={item.id} item={item} isExpanded={expanded === item.id}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)} leads={leads} leadsCash={getLeadsCash(item.id)} />
            ))}
            {reels.length === 0 && <div className="glass-card p-8 text-center text-[12px] text-[var(--text3)]">Sin reels</div>}
          </div>
          {reels.length > ITEMS_VISIBLE && (
            <button onClick={() => toggleShowAll('reel')} className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg3)] py-2.5 text-[11px] font-medium text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--border2)] transition-all">
              {showAll.reel ? 'Ver menos' : `Ver mas (${reels.length - ITEMS_VISIBLE})`}
            </button>
          )}
        </div>

        {/* Secuencias */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS.historia }} />
            <span className="text-[12px] font-semibold uppercase tracking-wider">Dinero por Secuencia</span>
            <span className="text-[10px] text-[var(--text3)]">({secuencias.length})</span>
          </div>
          <div className="space-y-3">
            {(showAll.historia ? secuencias : secuencias.slice(0, ITEMS_VISIBLE)).map(seq => (
              <SecuenciaCard key={seq.id} seq={seq} isExpanded={expanded === seq.id}
                onToggle={() => setExpanded(expanded === seq.id ? null : seq.id)} leadsCash={getLeadsCashForSecuencia(seq)} />
            ))}
            {secuencias.length === 0 && <div className="glass-card p-8 text-center text-[12px] text-[var(--text3)]">Sin secuencias</div>}
          </div>
          {secuencias.length > ITEMS_VISIBLE && (
            <button onClick={() => toggleShowAll('historia')} className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg3)] py-2.5 text-[11px] font-medium text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--border2)] transition-all">
              {showAll.historia ? 'Ver menos' : `Ver mas (${secuencias.length - ITEMS_VISIBLE})`}
            </button>
          )}
        </div>

        {/* YouTube */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS.video }} />
            <span className="text-[12px] font-semibold uppercase tracking-wider">Dinero por YouTube</span>
            <span className="text-[10px] text-[var(--text3)]">({videos.length})</span>
          </div>
          <div className="space-y-3">
            {(showAll.video ? videos : videos.slice(0, ITEMS_VISIBLE)).map(item => (
              <YouTubeCard key={item.id} item={item} isExpanded={expanded === item.id}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)} leads={leads} leadsCash={getLeadsCash(item.id)} />
            ))}
            {videos.length === 0 && <div className="glass-card p-8 text-center text-[12px] text-[var(--text3)]">Sin videos</div>}
          </div>
          {videos.length > ITEMS_VISIBLE && (
            <button onClick={() => toggleShowAll('video')} className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg3)] py-2.5 text-[11px] font-medium text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--border2)] transition-all">
              {showAll.video ? 'Ver menos' : `Ver mas (${videos.length - ITEMS_VISIBLE})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Reel Card ---------- */

function ReelCard({ item, isExpanded, onToggle, leads, leadsCash }: { item: ContentItem; isExpanded: boolean; onToggle: () => void; leads: Lead[]; leadsCash: number }) {
  const views = Number((item.metrics as Record<string, unknown>)?.views) || 0
  const likes = Number((item.metrics as Record<string, unknown>)?.likes) || 0
  const saves = Number((item.metrics as Record<string, unknown>)?.saves) || 0
  const cls = item.classification
  const cash = leadsCash
  const cpc = item.chats > 0 ? cash / item.chats : 0
  const title = item.title || item.notes?.substring(0, 60) || 'Sin titulo'
  const itemDate = item.published_at?.split('T')[0]
  const related = leads.filter(l => {
    const ref = parseContentRef(l.agenda_point)
    return ref && ref.type === 'reel' && ref.date === itemDate
  })

  return (
    <div className="glass-card overflow-hidden cursor-pointer group" onClick={onToggle}>
      {/* Preview — large thumbnail */}
      <div className="relative">
        <ContentImage item={item} className="w-full h-40" />
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(cash)}</div>
        </div>
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/70 hover:text-white transition-colors backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        )}
      </div>
      <div className="p-3">
        <div className="text-[12px] font-medium truncate">{title}</div>
        <div className="text-[11px] text-[var(--text3)] mt-0.5">{item.chats} chats · CPC {formatCash(cpc)}</div>
      </div>

      {/* Expanded */}
      <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="border-t border-[var(--border)] px-3 py-3 space-y-3">
          {(views > 0 || likes > 0 || saves > 0) && (
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="Views" value={fmtK(views)} />
              <MiniStat label="Likes" value={fmtK(likes)} />
              <MiniStat label="Saves" value={fmtK(saves)} />
            </div>
          )}
          {cls && (
            <div className="flex flex-wrap gap-1.5">
              {cls.dolor && <Tag label={cls.dolor} color="red" />}
              {(cls.angulos || []).map(a => <Tag key={a} label={a} color="amber" />)}
              {cls.cta && <Tag label={cls.cta} color="blue" />}
            </div>
          )}
          {related.length > 0 && <RelatedLeads leads={related} />}
        </div>
      </div>
    </div>
  )
}

/* ---------- Secuencia Card ---------- */

function SecuenciaCard({ seq, isExpanded, onToggle, leadsCash }: { seq: Secuencia; isExpanded: boolean; onToggle: () => void; leadsCash: number }) {
  const cash = leadsCash
  const cpc = seq.chats > 0 ? cash / seq.chats : 0
  const singleHistoria = seq.stories.length === 1 && seq.stories[0].content_type === 'historia'
  const title = singleHistoria
    ? (seq.stories[0].title || seq.stories[0].notes?.substring(0, 50) || `Secuencia ${seq.date}`)
    : `Secuencia ${seq.date}`
  const storyCount = singleHistoria ? (seq.stories[0].notes?.match(/\d+ stories?/)?.[0] || '1 story') : `${seq.stories.length} stories`

  return (
    <div className="glass-card overflow-hidden cursor-pointer" onClick={onToggle}>
      {/* Thumbnail grid */}
      <div className="relative">
        {seq.thumbs.length >= 4 ? (
          <div className="grid grid-cols-2 gap-0.5">
            {seq.thumbs.slice(0, 4).map((t, i) => <img key={i} src={t} alt="" className="w-full h-24 object-cover" />)}
          </div>
        ) : seq.thumbs.length >= 2 ? (
          <div className="grid grid-cols-2 gap-0.5">
            {seq.thumbs.slice(0, 2).map((t, i) => <img key={i} src={t} alt="" className="w-full h-32 object-cover" />)}
          </div>
        ) : seq.thumbs.length === 1 ? (
          <img src={seq.thumbs[0]} alt="" className="w-full h-40 object-cover" />
        ) : (
          <div className="w-full h-28 bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] flex flex-col items-center justify-center gap-1">
            <div className="text-2xl">📱</div>
            <div className="text-[11px] text-[var(--text3)]">{storyCount}</div>
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(cash)}</div>
        </div>
      </div>
      <div className="p-3">
        <div className="text-[12px] font-medium">{title} <span className="text-[var(--text3)]">({storyCount})</span></div>
        <div className="text-[11px] text-[var(--text3)] mt-0.5">{seq.chats} chats · CPC {formatCash(cpc)}</div>
        {/* Tags always visible */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {seq.dolor && <Tag label={seq.dolor} color="red" />}
          {seq.angulos.slice(0, 2).map(a => <Tag key={a} label={a} color="amber" />)}
          {seq.cta && <Tag label={seq.cta} color="blue" />}
        </div>
      </div>

      {/* Expanded */}
      <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="border-t border-[var(--border)] px-3 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Cash" value={formatCash(cash)} accent />
            <MiniStat label="Chats" value={String(seq.chats)} />
            <MiniStat label="CPC" value={formatCash(cpc)} />
          </div>
          {/* All angulos */}
          {seq.angulos.length > 2 && (
            <div className="flex flex-wrap gap-1.5">
              {seq.angulos.slice(2).map(a => <Tag key={a} label={a} color="amber" />)}
            </div>
          )}
          {/* Individual story metrics */}
          <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-1">Stories individuales</div>
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {seq.stories.map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded-md bg-[var(--bg4)] px-2.5 py-1.5 text-[10px]">
                {String((s.metrics as Record<string, unknown>)?.thumbnail || '') !== '' && (
                  <img src={String((s.metrics as Record<string, unknown>)?.thumbnail)} alt="" className="h-6 w-6 rounded object-cover" />
                )}
                <span className="flex-1 truncate text-[var(--text2)]">{s.title || s.notes?.substring(0, 30) || '—'}</span>
                <span className="font-mono-num text-[var(--green)]">{formatCash(s.cash)}</span>
                <span className="text-[var(--text3)]">{s.chats}ch</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- YouTube Card ---------- */

function YouTubeCard({ item, isExpanded, onToggle, leads, leadsCash }: { item: ContentItem; isExpanded: boolean; onToggle: () => void; leads: Lead[]; leadsCash: number }) {
  const views = Number((item.metrics as Record<string, unknown>)?.views) || 0
  const likes = Number((item.metrics as Record<string, unknown>)?.likes) || 0
  const cls = item.classification
  const cash = leadsCash
  const title = item.title || 'Sin titulo'
  const related = leads.filter(l => l.agenda_point && title.length > 3 && l.agenda_point.toLowerCase().includes(title.toLowerCase().substring(0, 20)))

  return (
    <div className="glass-card overflow-hidden cursor-pointer" onClick={onToggle}>
      {/* Thumbnail — 16:9 */}
      <div className="relative">
        <ContentImage item={item} className="w-full" aspectVideo />
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(cash)}</div>
        </div>
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/70 hover:text-white transition-colors backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        )}
      </div>
      <div className="p-3">
        <div className="text-[12px] font-medium line-clamp-2 leading-snug">{title}</div>
        <div className="text-[11px] text-[var(--text3)] mt-1">{item.chats} agendas · {fmtK(views)} views</div>
      </div>

      {/* Expanded */}
      <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="border-t border-[var(--border)] px-3 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Cash" value={formatCash(cash)} accent />
            <MiniStat label="Agendas" value={String(item.chats)} />
            <MiniStat label="Likes" value={fmtK(likes)} />
          </div>
          {cls && (
            <div className="flex flex-wrap gap-1.5">
              {cls.dolor && <Tag label={cls.dolor} color="red" />}
              {(cls.angulos || []).map(a => <Tag key={a} label={a} color="amber" />)}
              {cls.cta && <Tag label={cls.cta} color="blue" />}
            </div>
          )}
          {cls?.summary && (
            <div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-1">Resumen</div>
              <p className="text-[11px] text-[var(--text2)] leading-relaxed line-clamp-4">{cls.summary}</p>
            </div>
          )}
          {related.length > 0 && <RelatedLeads leads={related} />}
        </div>
      </div>
    </div>
  )
}

/* ---------- Shared Components ---------- */

function Tag({ label, color }: { label: string; color: 'red' | 'amber' | 'blue' }) {
  const styles = {
    red: 'bg-red-500/15 text-red-400 border-red-500/20',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  }
  return <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${styles[color]}`}>{label}</span>
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-[var(--bg4)] px-3 py-2 text-center">
      <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">{label}</div>
      <div className={`font-mono-num text-[13px] font-bold ${accent ? 'text-[var(--green)]' : 'text-[var(--text)]'}`}>{value}</div>
    </div>
  )
}

function RelatedLeads({ leads }: { leads: Lead[] }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-1.5">Leads relacionados</div>
      <div className="space-y-1">
        {leads.slice(0, 3).map((l, i) => (
          <div key={i} className="flex items-center justify-between rounded-md bg-[var(--bg4)] px-2.5 py-1.5 text-[10px]">
            <span className="text-[var(--text2)]">{l.client_name || 'Anonimo'}</span>
            <span className={l.status === 'Cerrado' ? 'text-[var(--green)] font-semibold' : 'text-[var(--text3)]'}>{l.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopList({ title, items, color, icon }: { title: string; items: TopItem[]; color: string; icon: string }) {
  const maxCash = items[0]?.cash || 1
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">{title}</span>
      </div>
      {items.length === 0 ? <div className="text-[12px] text-[var(--text3)] py-4 text-center">Sin datos</div> : (
        <div className="space-y-3">
          {items.map((item, i) => {
            const pct = (item.cash / maxCash) * 100
            return (
              <div key={i}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-[var(--text)] truncate mr-2 font-medium" title={item.name}>{item.name}</span>
                  <span className="font-mono-num text-[var(--green)] font-semibold flex-shrink-0">{formatCash(item.cash)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg4)]">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-[9px] text-[var(--text3)] w-6 text-right font-mono-num">{item.count}x</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ---------- Helpers ---------- */

function fmtK(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}

function getShortcode(item: ContentItem): string | null {
  if (item.external_id?.startsWith('apify_')) return item.external_id.replace('apify_', '')
  if (item.url) {
    const match = item.url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/)
    if (match) return match[2]
  }
  return null
}

function ContentImage({ item, className, aspectVideo }: { item: ContentItem; className?: string; aspectVideo?: boolean }) {
  const [srcIdx, setSrcIdx] = useState(0)
  const thumb = (item.metrics as Record<string, unknown>)?.thumbnail as string | undefined
  const shortcode = getShortcode(item)

  const sources: string[] = []
  if (thumb) sources.push(thumb)
  if (shortcode) sources.push(`https://www.instagram.com/p/${shortcode}/media/?size=l`)

  const currentSrc = sources[srcIdx]

  if (!currentSrc) {
    return (
      <div className={`bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] flex flex-col items-center justify-center ${className || ''} ${aspectVideo ? 'aspect-video' : ''}`}>
        <div className="text-2xl mb-1">{item.content_type === 'video' ? '🎬' : '🎥'}</div>
        <div className="text-[10px] text-[var(--text3)] px-4 text-center truncate max-w-full">{item.title || 'Sin preview'}</div>
      </div>
    )
  }

  return (
    <img
      src={currentSrc}
      alt=""
      className={`object-cover ${className || ''} ${aspectVideo ? 'aspect-video' : ''}`}
      onError={() => {
        if (srcIdx < sources.length - 1) setSrcIdx(srcIdx + 1)
        else setSrcIdx(-1) // trigger fallback on next render
      }}
      referrerPolicy="no-referrer"
    />
  )
}
