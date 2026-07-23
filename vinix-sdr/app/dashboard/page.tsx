"use client";

// ============================================================================
// PANEL DE CONTROL — Vinix SDR v3
//
// CORRECCIONES DE SINCRONIZACIÓN (la causa de "lo guardado desaparece"):
// 1. La plantilla YA NO se recarga en el polling. Antes, el refresco periódico
//    sobreescribía el textarea con datos del servidor mientras escribías.
//    Ahora el contenido editable solo se carga al cambiar de campaña, y si
//    tiene cambios sin guardar, NUNCA se sobreescribe.
// 2. Guard de respuestas obsoletas: cada ciclo de fetch lleva un número de
//    secuencia; si llega una respuesta antigua después de una nueva, se ignora.
// 3. El polling se pausa con la pestaña oculta, con un modal abierto o durante
//    un lote (evita renders innecesarios y estados pisados).
// 4. beforeunload: aviso del navegador si hay cambios sin guardar o un lote
//    en marcha.
// 5. Campaña seleccionada persistida en localStorage: sobrevive a recargas.
// 6. Doble-submit imposible: import, envío e investigación tienen guards.
//
// DISEÑO: lienzo stone-50, acento petróleo (teal-700) solo en acciones
// primarias, funnel del pipeline como barra segmentada (el elemento firma:
// muestra dónde está cada lead de un vistazo), skeletons en carga inicial,
// toasts con variantes, animaciones sutiles con reduced-motion respetado.
// ============================================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconCheck, IconDownload, IconEdit, IconPlus, IconRefresh, IconSearch, IconSend,
  IconTrash, IconUpload, Skeleton, Spinner, ToastStack,
} from "@/components/ui";
import { UserMenu } from "@/components/user-menu";
import { useToasts } from "@/lib/hooks/use-toasts";

// ── Tipos ───────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  company_name: string;
  company_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  status: string;
  research_sector: string | null;
  research_pain_point: string | null;
  research_error: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  updated_at: string;
}

interface Campaign {
  id: string;
  name: string;
}

interface Reply {
  id: string;
  raw_body: string;
  raw_headers: { from?: string; subject?: string } | null;
  classification: string | null;
  classification_confidence: number;
  agent_response_draft: string | null;
  agent_response_sent: boolean;
  flagged_for_review: boolean;
  review_reason: string | null;
  created_at: string;
  leads: { company_name: string; contact_email: string } | null;
}

interface AccountInfo {
  plan: string;
  isTrial: boolean;
  trialDaysLeft: number;
  limits: { campaigns: number | null; leadsPerMonth: number; followUps: boolean; csvExport: boolean };
  usage: { campaigns: number; leadsThisMonth: number };
  email: string | null;
}

interface Health {
  ok: boolean;
  critical: string[];
  warnings: string[];
  dbOk: boolean;
  dbError: string | null;
}

// ── Estados del pipeline: orden del funnel + color por estado ───────────────
const PIPELINE_ORDER = [
  "pending", "researching", "research_failed", "ready_to_send",
  "sent", "replied", "interested", "meeting_booked", "not_interested", "out_of_scope",
] as const;

const STATUS_META: Record<string, { label: string; dot: string; chip: string; bar: string }> = {
  pending:         { label: "Pendiente",       dot: "bg-stone-400",   chip: "bg-stone-100 text-stone-600",     bar: "bg-stone-300" },
  researching:     { label: "Investigando",    dot: "bg-sky-500",     chip: "bg-sky-50 text-sky-700",          bar: "bg-sky-400" },
  research_failed: { label: "Revisión manual", dot: "bg-amber-500",   chip: "bg-amber-50 text-amber-800",      bar: "bg-amber-400" },
  ready_to_send:   { label: "Borrador listo",  dot: "bg-teal-600",    chip: "bg-teal-50 text-teal-700",        bar: "bg-teal-500" },
  sent:            { label: "Enviado",         dot: "bg-blue-500",    chip: "bg-blue-50 text-blue-700",        bar: "bg-blue-400" },
  replied:         { label: "Respondido",      dot: "bg-indigo-500",  chip: "bg-indigo-50 text-indigo-700",    bar: "bg-indigo-400" },
  interested:      { label: "Interesado",      dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700",  bar: "bg-emerald-500" },
  meeting_booked:  { label: "Agendado",        dot: "bg-emerald-700", chip: "bg-emerald-100 text-emerald-900", bar: "bg-emerald-700" },
  not_interested:  { label: "No interesado",   dot: "bg-rose-400",    chip: "bg-rose-50 text-rose-700",        bar: "bg-rose-300" },
  out_of_scope:    { label: "Fuera de plazo",  dot: "bg-stone-300",   chip: "bg-stone-100 text-stone-500",     bar: "bg-stone-200" },
};

const REVIEW_REASON_LABEL: Record<string, string> = {
  orphaned_reply: "Respuesta sin email original vinculado",
  suspicious_content: "Contenido sospechoso (posible manipulación)",
  ai_classification_failed: "La clasificación automática falló",
};

const CAMPAIGN_STORAGE_KEY = "vinix.selectedCampaign";

// ============================================================================
// Fila de lead memoizada: solo re-renderiza si cambian sus props.
// Con 500 leads y polling, esto evita cientos de renders por ciclo.
// ============================================================================
const LeadRow = memo(function LeadRow({
  lead, busy, batchRunning, onResearch, onOpenDraft, onEdit, onDelete,
}: {
  lead: Lead;
  busy: boolean;
  batchRunning: boolean;
  onResearch: (id: string) => void;
  onOpenDraft: (lead: Lead) => void;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
}) {
  const meta = STATUS_META[lead.status] ?? STATUS_META.pending;
  return (
    <tr className="group border-b border-stone-100 transition-colors last:border-0 hover:bg-stone-50/80">
      <td className="px-5 py-3.5">
        <p className="font-medium text-stone-900">{lead.company_name}</p>
        {lead.company_url && <p className="mt-0.5 max-w-[220px] truncate text-xs text-stone-400">{lead.company_url}</p>}
      </td>
      <td className="px-5 py-3.5">
        <p className="text-stone-700">{lead.contact_name ?? "—"}</p>
        {lead.contact_email && <p className="mt-0.5 text-xs text-stone-400">{lead.contact_email}</p>}
      </td>
      <td className="px-5 py-3.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-xs font-medium ${meta.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        {lead.research_error && (
          <p className="mt-1.5 max-w-[230px] text-xs leading-snug text-amber-700">{lead.research_error}</p>
        )}
      </td>
      <td className="max-w-[250px] px-5 py-3.5 text-xs leading-relaxed text-stone-600">
        {lead.research_sector && <p className="mb-0.5 font-medium text-stone-400">{lead.research_sector}</p>}
        {lead.research_pain_point ?? <span className="text-stone-300">—</span>}
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1.5">
          {(lead.status === "pending" || lead.status === "research_failed") && (
            <button
              disabled={busy || batchRunning}
              onClick={() => onResearch(lead.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition-all hover:border-stone-300 hover:bg-stone-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : lead.status === "pending" ? <IconSearch /> : <IconRefresh />}
              {busy ? "Trabajando" : lead.status === "pending" ? "Investigar" : "Reintentar"}
            </button>
          )}
          {lead.status === "ready_to_send" && (
            <button
              onClick={() => onOpenDraft(lead)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-teal-600 active:scale-[0.98]"
            >
              <IconMailSmall />
              Revisar borrador
            </button>
          )}
          <button
            onClick={() => onEdit(lead)}
            aria-label={`Editar ${lead.company_name}`}
            title="Editar lead"
            className="rounded-lg p-1.5 text-stone-300 opacity-0 transition-all hover:bg-stone-100 hover:text-stone-700 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <IconEdit />
          </button>
          <button
            onClick={() => onDelete(lead)}
            aria-label={`Eliminar ${lead.company_name}`}
            className="rounded-lg p-1.5 text-stone-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <IconTrash />
          </button>
        </div>
      </td>
    </tr>
  );
});

const IconMailSmall = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" />
  </svg>
);

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function Dashboard() {
  // ── Datos ─────────────────────────────────────────────────────────────────
  const [health, setHealth] = useState<Health | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [followUpsDue, setFollowUpsDue] = useState(0);
  const [sendingFollowUps, setSendingFollowUps] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [booting, setBooting] = useState(true);
  const [firstDataLoad, setFirstDataLoad] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // ── Acciones en curso (guards anti doble-submit) ─────────────────────────
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [sending, setSending] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const batchCancelled = useRef(false);

  // ── Plantilla (contenido editable, aislado del polling) ──────────────────
  // Los campos numéricos se guardan como string: permite vaciar el input
  // mientras se escribe sin que el valor salte al mínimo. Se validan al guardar.
  const [template, setTemplate] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [templateDirty, setTemplateDirty] = useState(false);
  const [fuEnabled, setFuEnabled] = useState(true);
  const [fuDays, setFuDays] = useState("3");
  const [fuMax, setFuMax] = useState("2");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [templateSave, setTemplateSave] = useState<"idle" | "saving" | "saved">("idle");

  // ── Modales ───────────────────────────────────────────────────────────────
  const [openDraft, setOpenDraft] = useState<Lead | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: "", value_proposition: "", sender_name: "", sender_email: "" });
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Lead | null>(null);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editLeadForm, setEditLeadForm] = useState({ company_name: "", company_url: "", contact_name: "", contact_email: "" });
  const [savingLead, setSavingLead] = useState(false);

  // ── Toasts ────────────────────────────────────────────────────────────────
  const { toasts, notify, dismiss: dismissToast } = useToasts();

  // ── Guard de respuestas obsoletas: solo la última petición puede escribir ─
  const fetchSeq = useRef(0);

  const loadLiveData = useCallback(async () => {
    if (!campaignId) return;
    const seq = ++fetchSeq.current;
    try {
      const [l, r, fu] = await Promise.all([
        fetch(`/api/leads?campaignId=${campaignId}`).then((res) => res.json()),
        fetch(`/api/replies?campaignId=${campaignId}`).then((res) => res.json()),
        fetch(`/api/agent/followups?campaignId=${campaignId}`).then((res) => res.json()).catch(() => ({ due: 0 })),
      ]);
      if (seq !== fetchSeq.current) return; // llegó tarde: hay datos más nuevos
      if (l?.leads) setLeads(l.leads);
      if (r?.replies) setReplies(r.replies);
      setFollowUpsDue(fu?.due ?? 0);
      setFirstDataLoad(false);
    } catch {
      /* red caída puntual: el siguiente ciclo lo reintenta */
    }
  }, [campaignId]);

  // ── Arranque: salud → campañas → restaurar selección ─────────────────────
  useEffect(() => {
    (async () => {
      try {
        const h: Health = await fetch("/api/health").then((r) => r.json());
        setHealth(h);
        if (h.critical.length > 0 || !h.dbOk) { setBooting(false); return; }

        // Solo aceptamos la respuesta si tiene la forma esperada: un JSON de
        // error ({ error }) rompería el render de la cabecera (account.usage.*)
        fetch("/api/account")
          .then((r) => r.json())
          .then((a) => { if (a?.limits && a?.usage) setAccount(a); })
          .catch(() => {});
        const c = await fetch("/api/campaigns").then((r) => r.json());
        const list: Campaign[] = c.campaigns ?? [];
        setCampaigns(list);

        if (list.length === 0) {
          setShowNewCampaign(true);
        } else {
          // Restaurar la campaña seleccionada tras recarga (si sigue existiendo)
          const stored = localStorage.getItem(CAMPAIGN_STORAGE_KEY);
          setCampaignId(list.some((x) => x.id === stored) ? stored! : list[0].id);
        }
      } catch {
        setHealth({ ok: false, critical: ["El servidor no responde"], warnings: [], dbOk: false, dbError: null });
      }
      setBooting(false);
    })();
  }, []);

  // ── Al cambiar de campaña: persistir + cargar datos + cargar plantilla ────
  useEffect(() => {
    if (!campaignId) return;
    localStorage.setItem(CAMPAIGN_STORAGE_KEY, campaignId);
    setFirstDataLoad(true);
    setStatusFilter("all");
    loadLiveData();

    // La plantilla se carga UNA vez por campaña, nunca en el polling.
    // Si hay cambios sin guardar (cambio rápido de campaña), no se pisan.
    (async () => {
      const t = await fetch(`/api/templates?campaignId=${campaignId}`).then((r) => r.json()).catch(() => null);
      // Nombres de columna reales de `campaigns` (con S en followups_enabled)
      if (t?.campaign) {
        setTemplate(t.campaign.base_template ?? "");
        setValueProp(t.campaign.value_proposition ?? "");
        setFuEnabled(t.campaign.followups_enabled ?? true);
        setFuDays(String(t.campaign.followup_delay_days ?? 3));
        setFuMax(String(t.campaign.followup_max_touches ?? 2));
        setDailyLimit(String(t.campaign.daily_send_limit ?? 20));
        setTemplateDirty(false);
        setTemplateSave("idle");
      }
    })();
  }, [campaignId, loadLiveData]);

  // ── Polling inteligente: pausado si pestaña oculta, modal abierto o lote ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (openDraft || showNewCampaign || confirmDelete || editLead) return;
      if (batch) return; // el lote ya refresca por su cuenta
      loadLiveData();
    }, 15_000);
    return () => clearInterval(interval);
  }, [loadLiveData, openDraft, showNewCampaign, confirmDelete, editLead, batch]);

  // ── beforeunload: no perder cambios ni lotes por accidente ───────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (templateDirty || draftDirty || batch) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [templateDirty, draftDirty, batch]);

  // ── Acciones ──────────────────────────────────────────────────────────────
  async function createCampaign() {
    if (creatingCampaign) return;
    setCreatingCampaign(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCampaign),
      });
      const data = await res.json();
      if (!res.ok) { notify("error", data.error ?? "No se pudo crear la campaña"); return; }
      notify("success", `Campaña "${data.campaign.name}" creada`);
      setShowNewCampaign(false);
      setNewCampaign({ name: "", value_proposition: "", sender_name: "", sender_email: "" });
      const c = await fetch("/api/campaigns").then((r) => r.json());
      setCampaigns(c.campaigns ?? []);
      setCampaignId(data.campaign.id);
    } catch {
      notify("error", "No se pudo crear la campaña: fallo de red");
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function importCSV(file: File) {
    if (importing) return;
    if (!campaignId) { notify("error", "Crea o selecciona una campaña antes de importar"); return; }
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("campaignId", campaignId);
      const res = await fetch("/api/leads/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data.error ?? "La importación falló");
      } else {
        const parts = [`${data.imported} leads importados`];
        if (data.skippedDuplicates > 0) parts.push(`${data.skippedDuplicates} duplicados omitidos`);
        if (data.skippedSuppressed > 0) parts.push(`${data.skippedSuppressed} en lista de supresión`);
        if (data.warnings?.length > 0) parts.push(`${data.warnings.length} avisos (ver consola)`);
        notify(data.imported > 0 ? "success" : "info", parts.join(" · "));
        if (data.warnings?.length > 0) console.warn("Avisos de importación:", data.warnings);
      }
      await loadLiveData();
    } catch {
      notify("error", "La importación falló: fallo de red");
    } finally {
      setImporting(false);
    }
  }

  // Nunca lanza: un fallo de red durante un lote no debe romper el bucle
  const runResearch = useCallback(async (leadId: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/agent/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok && data.status === "ready_to_send";
    } catch {
      return false;
    }
  }, []);

  const researchOne = useCallback(async (leadId: string) => {
    setBusyLead(leadId);
    try {
      const ok = await runResearch(leadId);
      if (ok) notify("success", "Borrador generado, pendiente de aprobación");
      else notify("error", "Investigación fallida: el motivo está en la fila del lead");
    } finally {
      setBusyLead(null);
      loadLiveData();
    }
  }, [runResearch, notify, loadLiveData]);

  async function researchAllPending() {
    const pending = leads.filter((l) => l.status === "pending");
    if (pending.length === 0 || batch) return;
    batchCancelled.current = false;
    setBatch({ done: 0, total: pending.length });
    let okCount = 0;
    try {
      for (let i = 0; i < pending.length; i++) {
        if (batchCancelled.current) break;
        if (await runResearch(pending[i].id)) okCount++;
        setBatch({ done: i + 1, total: pending.length });
        if ((i + 1) % 5 === 0) loadLiveData();
      }
    } finally {
      // El finally garantiza que el lote nunca queda "colgado" en pantalla
      // (batch activo pausa el polling: sin esto, un error congelaba el panel)
      setBatch(null);
    }
    const processed = batchCancelled.current ? "Lote cancelado" : "Lote terminado";
    notify(okCount > 0 ? "success" : "info", `${processed}: ${okCount} borradores listos`);
    loadLiveData();
  }

  const openDraftModal = useCallback((lead: Lead) => {
    setOpenDraft(lead);
    setEditSubject(lead.draft_subject ?? "");
    setEditBody(lead.draft_body ?? "");
    setDraftDirty(false);
  }, []);

  function closeDraftModal() {
    if (draftDirty && !window.confirm("Tienes cambios sin enviar en este borrador. ¿Cerrar igualmente?")) return;
    setOpenDraft(null);
    setDraftDirty(false);
  }

  async function approveAndSend() {
    if (!openDraft || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/agent/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: openDraft.id, subject: editSubject, body: editBody }),
      });
      const data = await res.json();
      if (res.ok) {
        notify("success", `Email enviado a ${openDraft.company_name}`);
        setOpenDraft(null);
        setDraftDirty(false);
      } else {
        notify("error", `No se envió: ${data.error}`);
      }
      await loadLiveData();
    } catch {
      notify("error", "No se envió: fallo de red. El borrador sigue guardado.");
    } finally {
      setSending(false);
    }
  }

  async function sendFollowUps() {
    if (sendingFollowUps || !campaignId) return;
    setSendingFollowUps(true);
    try {
      const res = await fetch("/api/agent/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data.error ?? "No se pudieron enviar los follow-ups");
      } else {
        const parts = [`${data.sent} follow-ups enviados`];
        if (data.closed > 0) parts.push(`${data.closed} secuencias cerradas`);
        if (data.skipped?.length > 0) parts.push(`${data.skipped.length} omitidos (ver consola)`);
        notify(data.sent > 0 ? "success" : "info", parts.join(" · "));
        if (data.skipped?.length > 0) console.warn("Follow-ups omitidos:", data.skipped);
      }
      await loadLiveData();
    } catch {
      notify("error", "No se pudieron enviar los follow-ups: fallo de red");
    } finally {
      setSendingFollowUps(false);
    }
  }

  const requestDelete = useCallback((lead: Lead) => setConfirmDelete(lead), []);

  const openEditLead = useCallback((lead: Lead) => {
    setEditLead(lead);
    setEditLeadForm({
      company_name: lead.company_name,
      company_url: lead.company_url ?? "",
      contact_name: lead.contact_name ?? "",
      contact_email: lead.contact_email ?? "",
    });
  }, []);

  async function saveEditLead() {
    if (!editLead || savingLead) return;
    const email = editLeadForm.contact_email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notify("error", "Email de contacto inválido");
      return;
    }
    setSavingLead(true);
    // Si el lead estaba bloqueado por falta de URL y ahora tiene una, lo reseteamos para investigar
    const wasBlockedByUrl =
      editLead.status === "research_failed" &&
      !editLead.company_url &&
      editLeadForm.company_url.trim().length > 0;
    try {
      const res = await fetch(`/api/leads?id=${editLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: editLeadForm.company_name,
          company_url: editLeadForm.company_url,
          contact_name: editLeadForm.contact_name,
          contact_email: email,
          resetForResearch: wasBlockedByUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify("error", data.error ?? "No se pudo guardar el lead");
        return;
      }
      notify("success", wasBlockedByUrl ? "Lead actualizado; listo para investigar" : "Lead actualizado");
      setEditLead(null);
      await loadLiveData();
    } catch {
      notify("error", "No se pudo guardar el lead: fallo de red");
    } finally {
      setSavingLead(false);
    }
  }

  async function deleteLeadConfirmed() {
    if (!confirmDelete) return;
    const lead = confirmDelete;
    setConfirmDelete(null);
    // Optimista: desaparece al instante; si falla, se restaura con el reload
    setLeads((ls) => ls.filter((l) => l.id !== lead.id));
    try {
      const res = await fetch(`/api/leads?id=${lead.id}`, { method: "DELETE" });
      if (res.ok) notify("success", `"${lead.company_name}" eliminado`);
      else {
        notify("error", "No se pudo eliminar el lead");
        loadLiveData();
      }
    } catch {
      notify("error", "No se pudo eliminar el lead: fallo de red");
      loadLiveData();
    }
  }

  // Valores fuera de rango o vacíos vuelven a su valor por defecto al guardar
  const clampInt = (value: string, fallback: number, min: number, max: number) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && value.trim() !== "" ? Math.min(max, Math.max(min, n)) : fallback;
  };

  async function saveTemplate() {
    if (templateSave === "saving") return;
    setTemplateSave("saving");
    const days = clampInt(fuDays, 3, 1, 30);
    const max = clampInt(fuMax, 2, 0, 5);
    const daily = clampInt(dailyLimit, 20, 1, 500);
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          base_template: template,
          value_proposition: valueProp,
          followups_enabled: fuEnabled,
          followup_delay_days: days,
          followup_max_touches: max,
          daily_send_limit: daily,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // La respuesta trae la fila guardada: reflejamos lo que hay en BD,
        // no lo que creímos enviar (los valores se recortan a rango).
        const saved = data?.campaign;
        setFuDays(String(saved?.followup_delay_days ?? days));
        setFuMax(String(saved?.followup_max_touches ?? max));
        setDailyLimit(String(saved?.daily_send_limit ?? daily));
        if (typeof saved?.followups_enabled === "boolean") setFuEnabled(saved.followups_enabled);

        setTemplateDirty(false);
        setTemplateSave("saved");
        setTimeout(() => setTemplateSave("idle"), 2200);
      } else {
        setTemplateSave("idle");
        // `debug` sólo llega en desarrollo; en producción queda el requestId
        // para localizar el error completo en los logs del servidor.
        if (data?.debug) console.error("[templates:update] detalle del servidor", data.debug);
        const ref = data?.requestId ? ` (ref: ${data.requestId})` : "";
        notify("error", `No se guardó la plantilla: ${data?.error ?? res.status}${ref}`);
      }
    } catch {
      setTemplateSave("idle");
      notify("error", "No se guardó la plantilla: fallo de red");
    }
  }

  // ── Derivados ─────────────────────────────────────────────────────────────
  const filteredLeads = useMemo(
    () => (statusFilter === "all" ? leads : leads.filter((l) => l.status === statusFilter)),
    [leads, statusFilter]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of leads) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  }, [leads]);

  const funnel = useMemo(() => {
    const sent = leads.filter((l) => !["pending", "researching", "research_failed", "ready_to_send"].includes(l.status)).length;
    const replied = leads.filter((l) => ["replied", "interested", "not_interested", "out_of_scope", "meeting_booked"].includes(l.status)).length;
    return {
      total: leads.length,
      sent,
      responseRate: sent > 0 ? Math.round((replied / sent) * 100) : null,
      interested: (statusCounts.interested ?? 0) + (statusCounts.meeting_booked ?? 0),
      booked: statusCounts.meeting_booked ?? 0,
    };
  }, [leads, statusCounts]);

  const planLabel = !account
    ? "Cargando plan…"
    : account.isTrial
      ? `Trial Pro · ${account.trialDaysLeft} día${account.trialDaysLeft === 1 ? "" : "s"}`
      : account.plan === "free"
        ? "Plan Free"
        : `Plan ${account.plan === "pro" ? "Pro" : "Agency"}`;

  const pendingCount = statusCounts.pending ?? 0;
  const draftWordCount = editBody.trim() ? editBody.trim().split(/\s+/).length : 0;
  const flaggedReplies = useMemo(() => replies.filter((r) => r.flagged_for_review), [replies]);
  const normalReplies = useMemo(() => replies.filter((r) => !r.flagged_for_review), [replies]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  // Pantalla de configuración incompleta
  if (!booting && health && (health.critical.length > 0 || !health.dbOk)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="animate-rise-in w-full max-w-xl rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
            </span>
            <h1 className="text-lg font-semibold tracking-tight">Configuración incompleta</h1>
          </div>
          <p className="mb-5 text-sm text-stone-500">Falta lo siguiente para que el panel pueda arrancar:</p>
          <ul className="mb-6 space-y-2">
            {health.critical.map((v) => (
              <li key={v} className="rounded-lg bg-stone-50 px-3.5 py-2.5 font-mono text-sm text-stone-800">{v}</li>
            ))}
            {health.dbError && <li className="rounded-lg bg-stone-50 px-3.5 py-2.5 text-sm text-stone-800">{health.dbError}</li>}
          </ul>
          <div className="mb-6 rounded-xl border border-stone-100 bg-stone-50/60 p-4 text-sm leading-relaxed text-stone-600">
            <p className="mb-2 font-medium text-stone-800">Cómo resolverlo</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Copia <code className="rounded bg-stone-200/70 px-1.5 py-0.5 text-xs">.env.example</code> a <code className="rounded bg-stone-200/70 px-1.5 py-0.5 text-xs">.env.local</code>.</li>
              <li>Rellena las claves (cada variable indica dónde obtenerla).</li>
              <li>Reinicia el servidor: Ctrl+C y <code className="rounded bg-stone-200/70 px-1.5 py-0.5 text-xs">npm run dev</code>.</li>
              <li>Si faltan tablas, ejecuta <code className="rounded bg-stone-200/70 px-1.5 py-0.5 text-xs">supabase/schema.sql</code> en el SQL Editor.</li>
            </ol>
          </div>
          <button
            onClick={() => location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            <IconRefresh /> Reintentar
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-20">
      {/* ── Cabecera sticky ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-stone-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3.5">
          <div className="mr-auto flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">V</span>
            <div>
              <h1 className="text-sm font-semibold leading-none tracking-tight">Vinix SDR</h1>
              <p className="mt-0.5 text-[11px] leading-none text-stone-400">Prospección autónoma</p>
            </div>
            {account && (
              <a
                href="/pricing"
                className={`ml-1 hidden rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors sm:inline-block ${
                  account.isTrial
                    ? "bg-teal-50 text-teal-800 hover:bg-teal-100"
                    : account.plan === "free"
                      ? "bg-stone-100 text-stone-500 hover:bg-stone-200"
                      : "bg-stone-900 text-white hover:bg-stone-700"
                }`}
                title={`${account.usage.leadsThisMonth}/${account.limits.leadsPerMonth} leads este mes`}
              >
                {planLabel}
              </a>
            )}
          </div>

          {booting ? (
            <Skeleton className="h-9 w-64" />
          ) : (
            <>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                aria-label="Campaña activa"
                className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm shadow-sm transition-colors hover:border-stone-300 focus:border-teal-700 focus:outline-none"
              >
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={() => setShowNewCampaign(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50"
              >
                <IconPlus /> <span className="hidden sm:inline">Campaña</span>
              </button>
              {account && !account.limits.csvExport ? (
                <button
                  onClick={() => notify("info", "La exportación CSV es una función del plan Pro. Actívala en /pricing.")}
                  title="Exportación CSV: función del plan Pro"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-stone-400 shadow-sm transition-colors hover:border-stone-300"
                >
                  <IconDownload /> <span className="hidden sm:inline">Exportar</span>
                </button>
              ) : (
                <a
                  href={campaignId ? `/api/leads/export?campaignId=${campaignId}` : undefined}
                  aria-disabled={!campaignId}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 ${!campaignId ? "pointer-events-none opacity-40" : ""}`}
                >
                  <IconDownload /> <span className="hidden sm:inline">Exportar</span>
                </a>
              )}
              <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-600 active:scale-[0.98] ${importing ? "pointer-events-none opacity-70" : ""}`}>
                {importing ? <Spinner className="h-4 w-4" /> : <IconUpload />}
                {importing ? "Importando…" : "Importar CSV"}
                <input
                  type="file" accept=".csv" className="hidden" disabled={importing}
                  onChange={(e) => { if (e.target.files?.[0]) importCSV(e.target.files[0]); e.target.value = ""; }}
                />
              </label>
              <UserMenu email={account?.email ?? null} planLabel={planLabel} />
            </>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6">
        {/* Avisos de configuración opcionales */}
        {health && health.warnings.length > 0 && (
          <div className="animate-fade-in mt-5 rounded-xl border border-stone-200 bg-white px-4 py-3 text-xs leading-relaxed text-stone-500">
            {health.warnings.map((w) => <p key={w}>{w}</p>)}
          </div>
        )}

        {/* ── Funnel del pipeline (elemento firma) ─────────────────────────── */}
        <section className="mt-7">
          {booting || firstDataLoad ? (
            <div className="space-y-3">
              <div className="flex gap-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-28" />)}</div>
              <Skeleton className="h-3 w-full" />
            </div>
          ) : (
            <div className="animate-fade-in">
              <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
                <Metric label="Leads" value={String(funnel.total)} />
                <Metric label="Enviados" value={String(funnel.sent)} />
                <Metric label="Tasa de respuesta" value={funnel.responseRate === null ? "—" : `${funnel.responseRate}%`} />
                <Metric label="Interesados" value={String(funnel.interested)} accent={funnel.interested > 0} />
                <Metric label="Agendados" value={String(funnel.booked)} accent={funnel.booked > 0} />
              </div>

              {funnel.total > 0 && (
                <>
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100">
                    {PIPELINE_ORDER.map((s) => {
                      const n = statusCounts[s] ?? 0;
                      if (n === 0) return null;
                      return (
                        <button
                          key={s}
                          onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                          title={`${STATUS_META[s].label}: ${n}`}
                          aria-label={`Filtrar por ${STATUS_META[s].label} (${n})`}
                          style={{ width: `${(n / funnel.total) * 100}%` }}
                          className={`${STATUS_META[s].bar} min-w-[6px] transition-opacity hover:opacity-75 ${statusFilter !== "all" && statusFilter !== s ? "opacity-30" : ""}`}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    {PIPELINE_ORDER.map((s) => {
                      const n = statusCounts[s] ?? 0;
                      if (n === 0) return null;
                      const active = statusFilter === s;
                      return (
                        <button
                          key={s}
                          onClick={() => setStatusFilter(active ? "all" : s)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors ${active ? "bg-stone-900 text-white" : "text-stone-500 hover:text-stone-800"}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s].dot}`} />
                          {STATUS_META[s].label}
                          <span className={`tabular-nums ${active ? "text-stone-300" : "text-stone-400"}`}>{n}</span>
                        </button>
                      );
                    })}
                    {statusFilter !== "all" && (
                      <button onClick={() => setStatusFilter("all")} className="text-xs text-teal-700 hover:underline">
                        Quitar filtro
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ── Para hoy: acciones pendientes de un vistazo ──────────────────── */}
        {!booting && !firstDataLoad && ((statusCounts.ready_to_send ?? 0) > 0 || followUpsDue > 0 || flaggedReplies.length > 0) && (
          <section className="animate-fade-in mt-6 flex flex-wrap items-center gap-2.5 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Para hoy</span>
            {(statusCounts.ready_to_send ?? 0) > 0 && (
              <button
                onClick={() => setStatusFilter("ready_to_send")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-100"
              >
                {statusCounts.ready_to_send} borrador{(statusCounts.ready_to_send ?? 0) > 1 ? "es" : ""} por aprobar
              </button>
            )}
            {followUpsDue > 0 && (account && !account.limits.followUps ? (
              <a
                href="/pricing"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100"
              >
                {followUpsDue} follow-up{followUpsDue > 1 ? "s" : ""} listos · requiere plan Pro
              </a>
            ) : (
              <button
                onClick={sendFollowUps}
                disabled={sendingFollowUps}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100 disabled:opacity-60"
              >
                {sendingFollowUps ? <Spinner className="h-3.5 w-3.5" /> : <IconSend />}
                {sendingFollowUps ? "Enviando…" : `Enviar ${followUpsDue} follow-up${followUpsDue > 1 ? "s" : ""}`}
              </button>
            ))}
            {flaggedReplies.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                {flaggedReplies.length} respuesta{flaggedReplies.length > 1 ? "s" : ""} por revisar (más abajo)
              </span>
            )}
          </section>
        )}

        {/* ── Lote en curso ────────────────────────────────────────────────── */}
        <section className="mt-6 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-stone-800">Pipeline</h2>
          {batch ? (
            <div className="animate-fade-in flex items-center gap-3">
              <div className="h-1.5 w-44 overflow-hidden rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-teal-600 transition-all duration-300" style={{ width: `${(batch.done / batch.total) * 100}%` }} />
              </div>
              <span className="text-xs tabular-nums text-stone-500">{batch.done}/{batch.total}</span>
              <button onClick={() => (batchCancelled.current = true)} className="text-xs font-medium text-rose-600 hover:underline">
                Cancelar
              </button>
            </div>
          ) : (
            pendingCount > 0 && (
              <button
                onClick={researchAllPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-100"
              >
                <IconSearch /> Investigar pendientes ({pendingCount})
              </button>
            )
          )}
        </section>

        {/* ── Tabla ────────────────────────────────────────────────────────── */}
        <section className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-[11px] font-medium uppercase tracking-wider text-stone-400">
                <th className="px-5 py-3">Empresa</th>
                <th className="px-5 py-3">Contacto</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3">Investigación</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {(booting || firstDataLoad) &&
                [0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0">
                    {[0, 1, 2, 3, 4].map((j) => (
                      <td key={j} className="px-5 py-4"><Skeleton className="h-4 w-full max-w-[140px]" /></td>
                    ))}
                  </tr>
                ))}
              {!booting && !firstDataLoad && filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    {leads.length === 0 ? (
                      <div className="mx-auto max-w-sm">
                        <p className="text-sm font-medium text-stone-700">Empieza importando leads</p>
                        <p className="mt-1.5 text-xs leading-relaxed text-stone-400">
                          Sube un CSV con las columnas <code className="rounded bg-stone-100 px-1">company_name</code>, <code className="rounded bg-stone-100 px-1">company_url</code>, <code className="rounded bg-stone-100 px-1">contact_name</code> y <code className="rounded bg-stone-100 px-1">contact_email</code>. Acepta separador coma o punto y coma.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-stone-400">Ningún lead con ese estado. <button onClick={() => setStatusFilter("all")} className="text-teal-700 hover:underline">Quitar filtro</button></p>
                    )}
                  </td>
                </tr>
              )}
              {!firstDataLoad && filteredLeads.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  busy={busyLead === lead.id}
                  batchRunning={batch !== null}
                  onResearch={researchOne}
                  onOpenDraft={openDraftModal}
                  onEdit={openEditLead}
                  onDelete={requestDelete}
                />
              ))}
            </tbody>
          </table>
        </section>

        {/* ── Respuestas ───────────────────────────────────────────────────── */}
        {(flaggedReplies.length > 0 || normalReplies.length > 0) && (
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-stone-800">Respuestas recibidas</h2>

            {flaggedReplies.length > 0 && (
              <div className="mb-3 space-y-2">
                {flaggedReplies.map((r) => (
                  <div key={r.id} className="animate-fade-in rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-amber-900">
                        Requiere revisión — {REVIEW_REASON_LABEL[r.review_reason ?? ""] ?? r.review_reason}
                      </p>
                      <span className="text-[11px] tabular-nums text-amber-700/80">{new Date(r.created_at).toLocaleString("es-ES")}</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-800/90">
                      De {r.raw_headers?.from ?? "desconocido"} · {r.raw_headers?.subject ?? "sin asunto"}
                    </p>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-stone-700">{r.raw_body}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {normalReplies.map((r) => (
                <div key={r.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-stone-900">{r.leads?.company_name ?? "—"}</span>
                      {r.classification && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-2.5 text-[11px] font-medium ${STATUS_META[r.classification]?.chip ?? "bg-stone-100 text-stone-600"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[r.classification]?.dot ?? "bg-stone-400"}`} />
                          {STATUS_META[r.classification]?.label ?? r.classification}
                          <span className="tabular-nums opacity-70">{Math.round(r.classification_confidence * 100)}%</span>
                        </span>
                      )}
                      {r.agent_response_sent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <IconSend /> respondida por el agente
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] tabular-nums text-stone-400">{new Date(r.created_at).toLocaleString("es-ES")}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-stone-600">{r.raw_body}</p>
                  {r.agent_response_draft && !r.agent_response_sent && (
                    <div className="mt-2.5 rounded-lg border border-stone-100 bg-stone-50 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Respuesta propuesta (no enviada)</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-stone-700">{r.agent_response_draft}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Plantilla (guardado fiable, aislado del polling) ─────────────── */}
        {campaignId && !booting && (
          <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-stone-800">Plantilla de la campaña</h2>
              {templateDirty && (
                <span className="animate-fade-in inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Cambios sin guardar
                </span>
              )}
            </div>
            <p className="mb-4 text-xs leading-relaxed text-stone-400">
              El agente respeta esta estructura y la personaliza con la investigación de cada lead. Vacía, el agente decide libremente.
            </p>
            <textarea
              value={template}
              onChange={(e) => { setTemplate(e.target.value); setTemplateDirty(true); }}
              rows={5}
              placeholder="Ej.: abre con el hook, una frase sobre cómo ayudamos a [tipo de empresa], cierra con pregunta de sí/no."
              className="mb-5 w-full rounded-xl border border-stone-200 p-3.5 text-sm leading-relaxed transition-colors placeholder:text-stone-300 focus:border-teal-700 focus:outline-none"
            />
            <h3 className="text-sm font-semibold tracking-tight text-stone-800">Propuesta de valor</h3>
            <p className="mb-2 mt-0.5 text-xs text-stone-400">Qué vendes y con qué resultado medible. El agente la necesita para redactar.</p>
            <textarea
              value={valueProp}
              onChange={(e) => { setValueProp(e.target.value); setTemplateDirty(true); }}
              rows={2}
              placeholder="Ej.: llenamos el calendario de discovery calls de agencias; 5-10 reuniones cualificadas al mes."
              className="mb-5 w-full rounded-xl border border-stone-200 p-3.5 text-sm leading-relaxed transition-colors placeholder:text-stone-300 focus:border-teal-700 focus:outline-none"
            />
            {/* Configuración de la secuencia de follow-ups y ritmo de envío */}
            <div className="mb-5 rounded-xl border border-stone-100 bg-stone-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight text-stone-800">Follow-ups automáticos</h3>
                  <p className="mt-0.5 text-xs text-stone-400">Reintenta con leads sin respuesta. La mayoría de reuniones salen del 2º-3º toque.</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-600">
                  <input
                    type="checkbox"
                    checked={fuEnabled}
                    onChange={(e) => { setFuEnabled(e.target.checked); setTemplateDirty(true); }}
                    className="h-4 w-4 accent-teal-700"
                  />
                  Activados
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs text-stone-500">
                  Días de espera entre toques
                  <input
                    type="number" min={1} max={30} value={fuDays}
                    onChange={(e) => { setFuDays(e.target.value); setTemplateDirty(true); }}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white p-2 text-sm focus:border-teal-700 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-stone-500">
                  Máximo de follow-ups por lead
                  <input
                    type="number" min={0} max={5} value={fuMax}
                    onChange={(e) => { setFuMax(e.target.value); setTemplateDirty(true); }}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white p-2 text-sm focus:border-teal-700 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-stone-500">
                  Límite diario de envíos
                  <input
                    type="number" min={1} max={500} value={dailyLimit}
                    onChange={(e) => { setDailyLimit(e.target.value); setTemplateDirty(true); }}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white p-2 text-sm focus:border-teal-700 focus:outline-none"
                  />
                </label>
              </div>
              {account && !account.limits.followUps && (
                <p className="mt-3 text-xs text-amber-700">
                  Los follow-ups automáticos requieren el plan Pro. <a href="/pricing" className="font-medium underline">Ver planes</a>
                </p>
              )}
            </div>

            <button
              onClick={saveTemplate}
              disabled={templateSave === "saving" || !templateDirty}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm transition-all active:scale-[0.98] disabled:cursor-not-allowed ${
                templateSave === "saved"
                  ? "bg-emerald-600 text-white"
                  : "bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-40"
              }`}
            >
              {templateSave === "saving" && <Spinner className="h-4 w-4" />}
              {templateSave === "saved" && <IconCheck />}
              {templateSave === "saving" ? "Guardando…" : templateSave === "saved" ? "Guardado" : "Guardar cambios"}
            </button>
          </section>
        )}
      </div>

      {/* ══ Modal: borrador editable ══════════════════════════════════════ */}
      {openDraft && (
        <Modal onClose={closeDraftModal}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Borrador para</p>
          <h3 className="text-lg font-semibold tracking-tight">{openDraft.company_name}</h3>
          <p className="mb-5 mt-0.5 text-xs text-stone-400">
            {openDraft.contact_email ? `Se enviará a ${openDraft.contact_email}` : "Este lead no tiene email de contacto"}
          </p>

          <label className="mb-1.5 block text-xs font-medium text-stone-500">Asunto</label>
          <input
            value={editSubject}
            onChange={(e) => { setEditSubject(e.target.value); setDraftDirty(true); }}
            className="mb-4 w-full rounded-xl border border-stone-200 p-3 text-sm transition-colors focus:border-teal-700 focus:outline-none"
          />

          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-stone-500">Cuerpo</label>
            <span className={`text-[11px] tabular-nums ${draftWordCount > 120 ? "font-semibold text-rose-600" : "text-stone-400"}`}>
              {draftWordCount} / 120 palabras
            </span>
          </div>
          <textarea
            value={editBody}
            onChange={(e) => { setEditBody(e.target.value); setDraftDirty(true); }}
            rows={9}
            className="mb-6 w-full rounded-xl border border-stone-200 p-3.5 text-sm leading-relaxed transition-colors focus:border-teal-700 focus:outline-none"
          />

          <div className="flex justify-end gap-2.5">
            <button onClick={closeDraftModal} className="rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50">
              Cerrar
            </button>
            <button
              onClick={approveAndSend}
              disabled={sending || !openDraft.contact_email || !editSubject.trim() || !editBody.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? <Spinner className="h-4 w-4" /> : <IconSend />}
              {sending ? "Enviando…" : "Aprobar y enviar"}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ Modal: nueva campaña ══════════════════════════════════════════ */}
      {showNewCampaign && (
        <Modal onClose={() => campaigns.length > 0 && setShowNewCampaign(false)}>
          <h3 className="text-lg font-semibold tracking-tight">
            {campaigns.length === 0 ? "Crea tu primera campaña" : "Nueva campaña"}
          </h3>
          <p className="mb-5 mt-1 text-xs leading-relaxed text-stone-400">
            Una campaña agrupa leads con una misma oferta. El agente usa estos datos para redactar y firmar.
          </p>

          {([
            { key: "name", label: "Nombre de la campaña", placeholder: "Agencias web Barcelona" },
            { key: "sender_name", label: "Nombre del remitente (firma los emails)", placeholder: "Jorge" },
            { key: "sender_email", label: "Email remitente (dominio verificado en Resend)", placeholder: "jorge@tudominio.com" },
          ] as const).map((f) => (
            <div key={f.key} className="mb-3.5">
              <label className="mb-1.5 block text-xs font-medium text-stone-500">{f.label}</label>
              <input
                value={newCampaign[f.key]}
                onChange={(e) => setNewCampaign({ ...newCampaign, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full rounded-xl border border-stone-200 p-3 text-sm transition-colors placeholder:text-stone-300 focus:border-teal-700 focus:outline-none"
              />
            </div>
          ))}
          <div className="mb-6">
            <label className="mb-1.5 block text-xs font-medium text-stone-500">Propuesta de valor (qué vendes y con qué resultado)</label>
            <textarea
              value={newCampaign.value_proposition}
              onChange={(e) => setNewCampaign({ ...newCampaign, value_proposition: e.target.value })}
              rows={3}
              placeholder="Llenamos el calendario de discovery calls de agencias de marketing; 5-10 reuniones cualificadas al mes."
              className="w-full rounded-xl border border-stone-200 p-3 text-sm leading-relaxed transition-colors placeholder:text-stone-300 focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2.5">
            {campaigns.length > 0 && (
              <button onClick={() => setShowNewCampaign(false)} className="rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50">
                Cancelar
              </button>
            )}
            <button
              onClick={createCampaign}
              disabled={creatingCampaign}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-600 active:scale-[0.98] disabled:opacity-50"
            >
              {creatingCampaign ? <Spinner className="h-4 w-4" /> : <IconPlus />}
              {creatingCampaign ? "Creando…" : "Crear campaña"}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ Modal: editar lead (arreglar URL / contacto y reintentar) ═════ */}
      {editLead && (
        <Modal onClose={() => setEditLead(null)}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Editar lead</p>
          <h3 className="text-lg font-semibold tracking-tight">{editLead.company_name}</h3>
          {editLead.status === "research_failed" && !editLead.company_url && (
            <p className="mb-4 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Este lead no tiene URL. Añade una y se resetea a &ldquo;pendiente&rdquo; para poder investigarlo.
            </p>
          )}
          <div className="mt-4 space-y-3.5">
            {([
              { key: "company_name", label: "Nombre de la empresa", type: "text", placeholder: "" },
              { key: "company_url", label: "URL de la empresa", type: "url", placeholder: "https://ejemplo.com" },
              { key: "contact_name", label: "Nombre del contacto (opcional)", type: "text", placeholder: "" },
              { key: "contact_email", label: "Email del contacto (opcional)", type: "email", placeholder: "" },
            ] as const).map((f) => (
              <div key={f.key}>
                <label className="mb-1.5 block text-xs font-medium text-stone-500">{f.label}</label>
                <input
                  type={f.type}
                  value={editLeadForm[f.key]}
                  onChange={(e) => setEditLeadForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full rounded-xl border border-stone-200 p-3 text-sm transition-colors placeholder:text-stone-300 focus:border-teal-700 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-2.5">
            <button
              onClick={() => setEditLead(null)}
              className="rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              onClick={saveEditLead}
              disabled={savingLead || !editLeadForm.company_name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-600 active:scale-[0.98] disabled:opacity-50"
            >
              {savingLead ? <Spinner className="h-4 w-4" /> : <IconCheck />}
              {savingLead ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ Modal: confirmar eliminación ══════════════════════════════════ */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} size="sm">
          <h3 className="text-base font-semibold tracking-tight">¿Eliminar &ldquo;{confirmDelete.company_name}&rdquo;?</h3>
          <p className="mb-6 mt-1.5 text-sm leading-relaxed text-stone-500">
            Se eliminarán también sus emails enviados y respuestas. Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-2.5">
            <button onClick={() => setConfirmDelete(null)} className="rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50">
              Cancelar
            </button>
            <button
              onClick={deleteLeadConfirmed}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-rose-500 active:scale-[0.98]"
            >
              <IconTrash /> Eliminar
            </button>
          </div>
        </Modal>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

// ── Métrica del funnel ──────────────────────────────────────────────────────
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-semibold tabular-nums tracking-tight ${accent ? "text-teal-700" : "text-stone-900"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-stone-400">{label}</p>
    </div>
  );
}

// ── Modal accesible con animación y cierre por Escape ───────────────────────
function Modal({ children, onClose, size = "md" }: { children: React.ReactNode; onClose: () => void; size?: "sm" | "md" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`animate-rise-in w-full ${size === "sm" ? "max-w-sm" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl shadow-stone-900/10`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
