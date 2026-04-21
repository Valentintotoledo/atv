'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'

type DailyMetric = {
  id?: string
  date: string
  chats_unicos: number
  conversaciones: number
  vsl_enviados: number
  agendas: number
  llamadas_del_dia: number
  shows: number
  cierres: number
  total_cc_in_call: number
  total_senados: number
  seguimientos: number
  respuesta_1er_msj: number
  // Calculated
  tasa_envio_vsl: number
  tasa_agendamiento: number
  close_rate: number
  show_up_rate: number
  aov: number
  cash_por_agenda: number
  cash_por_show: number
  ticket_promedio: number
}

const INPUT_FIELDS = [
  { key: 'chats_unicos', label: 'Chats únicos', type: 'int' },
  { key: 'conversaciones', label: 'Conversaciones', type: 'int' },
  { key: 'vsl_enviados', label: 'VSL enviados', type: 'int' },
  { key: 'agendas', label: 'Agendas', type: 'int' },
  { key: 'llamadas_del_dia', label: 'Llamadas', type: 'int' },
  { key: 'shows', label: 'Shows', type: 'int' },
  { key: 'cierres', label: 'Cierres', type: 'int' },
  { key: 'total_cc_in_call', label: 'CC in call', type: 'cash' },
  { key: 'total_senados', label: 'Señados', type: 'cash' },
  { key: 'seguimientos', label: 'Seguim.', type: 'int' },
  { key: 'respuesta_1er_msj', label: 'Resp 1er msj', type: 'int' },
] as const

const CALC_FIELDS = [
  { key: 'tasa_envio_vsl', label: 'Envío VSL', format: 'pct' },
  { key: 'tasa_agendamiento', label: 'Agendamiento', format: 'pct' },
  { key: 'close_rate', label: 'Close rate', format: 'pct' },
  { key: 'show_up_rate', label: 'Show up', format: 'pct' },
  { key: 'aov', label: 'AOV', format: 'cash' },
  { key: 'cash_por_agenda', label: '$/agenda', format: 'cash' },
  { key: 'cash_por_show', label: '$/show', format: 'cash' },
  { key: 'ticket_promedio', label: 'Ticket prom', format: 'cash' },
] as const

function calcRates(m: DailyMetric): DailyMetric {
  const conv = m.conversaciones || 0
  const agendas = m.agendas || 0
  const shows = m.shows || 0
  const cierres = m.cierres || 0
  const cc = Number(m.total_cc_in_call) || 0

  return {
    ...m,
    tasa_envio_vsl: conv > 0 ? (m.vsl_enviados / conv) * 100 : 0,
    tasa_agendamiento: conv > 0 ? (agendas / conv) * 100 : 0,
    close_rate: shows > 0 ? (cierres / shows) * 100 : 0,
    show_up_rate: agendas > 0 ? (shows / agendas) * 100 : 0,
    aov: cierres > 0 ? cc / cierres : 0,
    cash_por_agenda: agendas > 0 ? cc / agendas : 0,
    cash_por_show: shows > 0 ? cc / shows : 0,
    ticket_promedio: cierres > 0 ? cc / cierres : 0,
  }
}

function getDaysInMonth(month: string): string[] {
  const [year, m] = month.split('-').map(Number)
  const days = new Date(year, m, 0).getDate()
  return Array.from({ length: days }, (_, i) => {
    const d = i + 1
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  })
}

function getWeekNumber(dayOfMonth: number): number {
  return Math.ceil(dayOfMonth / 7)
}

const emptyRow = (date: string): DailyMetric => ({
  date,
  chats_unicos: 0, conversaciones: 0, vsl_enviados: 0, agendas: 0,
  llamadas_del_dia: 0, shows: 0, cierres: 0, total_cc_in_call: 0,
  total_senados: 0, seguimientos: 0, respuesta_1er_msj: 0,
  tasa_envio_vsl: 0, tasa_agendamiento: 0, close_rate: 0, show_up_rate: 0,
  aov: 0, cash_por_agenda: 0, cash_por_show: 0, ticket_promedio: 0,
})

export default function MetricasVentasPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [rows, setRows] = useState<DailyMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const { data } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('month', month)
      .order('date', { ascending: true })

    const existing = new Map((data || []).map((r: Record<string, unknown>) => [r.date as string, r]))
    const days = getDaysInMonth(month)
    const merged = days.map(date => {
      const saved = existing.get(date)
      if (saved) return { ...emptyRow(date), ...saved, date } as DailyMetric
      return emptyRow(date)
    })
    setRows(merged)
    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const updateCell = async (date: string, field: string, value: number) => {
    if (!userId) return
    const idx = rows.findIndex(r => r.date === date)
    if (idx === -1) return

    const updated = { ...rows[idx], [field]: value }
    const calculated = calcRates(updated)
    const newRows = [...rows]
    newRows[idx] = calculated
    setRows(newRows)

    setSaving(date)
    const row: Record<string, unknown> = { user_id: userId, date, month }
    INPUT_FIELDS.forEach(f => { row[f.key] = calculated[f.key as keyof DailyMetric] })
    CALC_FIELDS.forEach(f => { row[f.key] = calculated[f.key as keyof DailyMetric] })
    row.updated_at = new Date().toISOString()

    if (calculated.id) {
      await supabase.from('daily_metrics').update(row).eq('id', calculated.id)
    } else {
      const { data } = await supabase.from('daily_metrics').insert(row).select('id').single()
      if (data) {
        newRows[idx] = { ...calculated, id: data.id }
        setRows([...newRows])
      }
    }
    setSaving(null)
  }

  // Weekly subtotals
  const weekGroups: { week: number; startDay: number; endDay: number }[] = []
  const daysInMonth = getDaysInMonth(month).length
  for (let i = 1; i <= daysInMonth; i += 7) {
    weekGroups.push({ week: Math.ceil(i / 7), startDay: i, endDay: Math.min(i + 6, daysInMonth) })
  }

  const getWeekRows = (startDay: number, endDay: number) =>
    rows.filter(r => {
      const d = parseInt(r.date.split('-')[2], 10)
      return d >= startDay && d <= endDay
    })

  const sumField = (weekRows: DailyMetric[], field: string) =>
    weekRows.reduce((s, r) => s + (Number(r[field as keyof DailyMetric]) || 0), 0)

  const fmtPct = (v: number) => v > 0 ? `${v.toFixed(1)}%` : ''
  const fmtCash = (v: number) => v > 0 ? formatCash(v) : ''
  const fmtInt = (v: number) => v > 0 ? String(v) : ''

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Metricas <span className="text-[var(--text2)]">Diarias de ventas</span></h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="text-[12px] border-collapse" style={{ width: 50 + (INPUT_FIELDS.length + CALC_FIELDS.length) * 90, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 50 }} />
            {INPUT_FIELDS.map(f => <col key={f.key} style={{ width: 90 }} />)}
            {CALC_FIELDS.map(f => <col key={f.key} style={{ width: 90 }} />)}
          </colgroup>
          <thead>
            <tr className="bg-[var(--bg3)] border-b border-[var(--border)]">
              <th className="bg-[var(--bg3)] px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</th>
              {INPUT_FIELDS.map(f => (
                <th key={f.key} className="px-1 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{f.label}</th>
              ))}
              {CALC_FIELDS.map(f => (
                <th key={f.key} className="px-1 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekGroups.map(wg => {
              const weekRows = getWeekRows(wg.startDay, wg.endDay)
              return (
                <React.Fragment key={wg.week}>
                  {/* Day rows */}
                  {weekRows.map(row => {
                    const day = parseInt(row.date.split('-')[2], 10)
                    const isSaving = saving === row.date
                    return (
                      <tr key={row.date} className={`border-b border-[var(--border)] hover:bg-[var(--bg3)] transition-colors ${isSaving ? 'opacity-60' : ''}`}>
                        <td className="bg-[var(--bg2)] px-2 py-1.5 font-mono-num text-[var(--text2)] font-medium">{day}</td>
                        {INPUT_FIELDS.map(f => {
                          const val = Number(row[f.key as keyof DailyMetric]) || 0
                          return (
                            <td key={f.key} className="px-1 py-0.5">
                              <input
                                type="number"
                                value={val === 0 ? '' : val}
                                onChange={e => updateCell(row.date, f.key, Number(e.target.value) || 0)}
                                className="w-full bg-transparent text-center font-mono-num text-[12px] text-[var(--text)] outline-none py-1 rounded hover:bg-[var(--bg4)] focus:bg-[var(--bg4)] focus:ring-1 focus:ring-[var(--accent)]"
                                placeholder="0"
                              />
                            </td>
                          )
                        })}
                        {CALC_FIELDS.map(f => {
                          const val = Number(row[f.key as keyof DailyMetric]) || 0
                          return (
                            <td key={f.key} className="px-1 py-1.5 text-center font-mono-num text-[11px] text-[var(--text3)]">
                              {f.format === 'pct' ? fmtPct(val) : fmtCash(val)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {/* Week subtotal row */}
                  <tr className="bg-[var(--bg3)] border-b-2 border-[var(--border2)]">
                    <td className="bg-[var(--bg3)] px-2 py-2 text-[11px] font-semibold text-[var(--text2)]">
                      S{wg.week} ({String(wg.startDay).padStart(2, '0')}-{String(wg.endDay).padStart(2, '0')})
                    </td>
                    {INPUT_FIELDS.map(f => (
                      <td key={f.key} className="px-1 py-2 text-center font-mono-num text-[11px] font-semibold text-[var(--text)]">
                        {f.type === 'cash' ? fmtCash(sumField(weekRows, f.key)) : fmtInt(sumField(weekRows, f.key))}
                      </td>
                    ))}
                    {CALC_FIELDS.map(f => {
                      // Calculate averages for rates, sums for cash
                      const weekCalc = calcRates({
                        ...emptyRow(''),
                        conversaciones: sumField(weekRows, 'conversaciones'),
                        vsl_enviados: sumField(weekRows, 'vsl_enviados'),
                        agendas: sumField(weekRows, 'agendas'),
                        shows: sumField(weekRows, 'shows'),
                        cierres: sumField(weekRows, 'cierres'),
                        total_cc_in_call: sumField(weekRows, 'total_cc_in_call'),
                      })
                      const val = Number(weekCalc[f.key as keyof DailyMetric]) || 0
                      return (
                        <td key={f.key} className="px-1 py-2 text-center font-mono-num text-[11px] font-semibold text-[var(--accent)]">
                          {f.format === 'pct' ? fmtPct(val) : fmtCash(val)}
                        </td>
                      )
                    })}
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Monthly totals */}
      <div className="mt-4 glass-card p-4">
        <div className="flex items-center gap-6 text-[12px]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Total mes</span>
          {INPUT_FIELDS.slice(0, 7).map(f => (
            <div key={f.key} className="text-center">
              <div className="text-[10px] text-[var(--text3)]">{f.label}</div>
              <div className="font-mono-num font-semibold">{sumField(rows, f.key)}</div>
            </div>
          ))}
          <div className="text-center">
            <div className="text-[10px] text-[var(--text3)]">CC in call</div>
            <div className="font-mono-num font-semibold text-[var(--green)]">{formatCash(sumField(rows, 'total_cc_in_call'))}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
