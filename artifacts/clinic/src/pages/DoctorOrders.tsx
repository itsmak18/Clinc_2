import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListLabTests, useListXrayImages, useListUltrasoundRecords,
  getListLabTestsQueryKey, getListXrayImagesQueryKey, getListUltrasoundRecordsQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LabParam } from "@/lib/print";
import { FlaskConical, Scan, Activity, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";

type OrderKind = "lab" | "xray" | "ultrasound";

interface OrderRow {
  id: number;
  kind: OrderKind;
  patientId: number;
  patientName: string;
  mrn: string | null;
  detail: string;
  status: string;
  result: string | null;
  createdAt: string;
}

const KIND_ICONS = {
  lab:        FlaskConical,
  xray:       Scan,
  ultrasound: Activity,
};

const KIND_BADGE: Record<OrderKind, string> = {
  lab:        "badge-teal",
  xray:       "badge-sage",
  ultrasound: "badge-sand",
};

// A row's expand identity must be unique across kinds — lab/xray/ultrasound
// each have their own auto-increment ids that can collide.
const rowKey = (r: OrderRow) => `${r.kind}:${r.id}`;

function parseLabResult(raw: string | null): { params: LabParam[]; notes: string } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p?.v === 1) return { params: p.params ?? [], notes: p.notes ?? "" };
  } catch { /* legacy plain text */ }
  return { params: [], notes: raw };
}

function parseImagingReport(raw: string | null): { findings: string; impression: string } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p?.v === 1) return { findings: p.findings ?? "", impression: p.impression ?? "" };
  } catch { /* legacy plain text */ }
  return { findings: raw, impression: "" };
}

// Human-readable one-line preview for the collapsed table — never raw JSON.
function resultPreview(row: OrderRow): string {
  if (!row.result) return "";
  if (row.kind === "lab") {
    const r = parseLabResult(row.result);
    if (!r) return "";
    if (r.params.length) {
      const head = r.params.slice(0, 3)
        .map(p => `${p.name} ${p.value}${p.unit ? " " + p.unit : ""}`.trim())
        .filter(Boolean)
        .join(" · ");
      return head || r.notes;
    }
    return r.notes;
  }
  const r = parseImagingReport(row.result);
  if (!r) return "";
  return r.findings || r.impression;
}

const flagColor = (flag: string) =>
  flag === "H" ? "text-[var(--rose-600)] font-bold" : flag === "L" ? "text-blue-600 font-bold" : "text-[var(--teal-700)]";

export default function DoctorOrders() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [filterKind, setFilterKind] = useState<OrderKind | "all">("all");
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { data: labs,  isLoading: labLoading  } = useListLabTests({},        { query: { queryKey: getListLabTestsQueryKey({}) } });
  const { data: xrays, isLoading: xrayLoading } = useListXrayImages({},       { query: { queryKey: getListXrayImagesQueryKey({}) } });
  const { data: us,    isLoading: usLoading   } = useListUltrasoundRecords({}, { query: { queryKey: getListUltrasoundRecordsQueryKey({}) } });

  const myId = user?.id;

  const allOrders: OrderRow[] = [
    ...(labs ?? [])
      .filter((l: any) => l.requestedById === myId)
      .map((l: any): OrderRow => ({
        id: l.id, kind: "lab", patientId: l.patientId,
        patientName: l.patient?.fullName ?? `#${l.patientId}`,
        mrn: l.patient?.mrn ?? null,
        detail: l.testName ?? "-",
        status: l.status, result: l.results ?? null, createdAt: l.createdAt,
      })),
    ...(xrays ?? [])
      .filter((x: any) => x.requestedById === myId)
      .map((x: any): OrderRow => ({
        id: x.id, kind: "xray", patientId: x.patientId,
        patientName: x.patient?.fullName ?? `#${x.patientId}`,
        mrn: x.patient?.mrn ?? null,
        detail: x.bodyPart ?? "-",
        status: x.status, result: x.report ?? null, createdAt: x.createdAt,
      })),
    ...(us ?? [])
      .filter((u: any) => u.requestedById === myId)
      .map((u: any): OrderRow => ({
        id: u.id, kind: "ultrasound", patientId: u.patientId,
        patientName: u.patient?.fullName ?? `#${u.patientId}`,
        mrn: u.patient?.mrn ?? null,
        detail: `${u.examType ?? ""} ${u.bodyPart ? "· " + u.bodyPart : ""}`.trim() || "-",
        status: u.status, result: u.report ?? null, createdAt: u.createdAt,
      })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const filtered = allOrders.filter(o => {
    if (filterKind !== "all" && o.kind !== filterKind) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return o.patientName.toLowerCase().includes(q) || o.detail.toLowerCase().includes(q);
  });

  const isLoading = labLoading || xrayLoading || usLoading;

  function toggleExpand(row: OrderRow) {
    setExpandedKey(k => (k === rowKey(row) ? null : rowKey(row)));
  }

  function renderDetail(row: OrderRow) {
    const Icon = KIND_ICONS[row.kind];
    const lab = row.kind === "lab" ? parseLabResult(row.result) : null;
    const img = row.kind !== "lab" ? parseImagingReport(row.result) : null;
    const hasContent =
      (lab && (lab.params.length > 0 || lab.notes)) ||
      (img && (img.findings || img.impression));

    return (
      <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--line)] space-y-3">
        {/* Patient / order meta strip */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            <span className="font-medium text-[var(--ink)]">{row.detail}</span>
          </div>
          <div><span className="text-[var(--ink-muted)]">{t("patient")}: </span><span className="font-medium text-[var(--ink)]">{row.patientName}</span></div>
          {row.mrn && <div><span className="text-[var(--ink-muted)]">{t("mrn")}: </span><span className="font-mono text-[var(--ink)]">{row.mrn}</span></div>}
          <div><span className="text-[var(--ink-muted)]">{t("date")}: </span><span className="text-[var(--ink)]">{formatDate(row.createdAt)}</span></div>
          <div className="flex items-center gap-1"><span className="text-[var(--ink-muted)]">{t("status")}:</span> <StatusBadge status={row.status} /></div>
        </div>

        {/* Result body */}
        {!hasContent ? (
          <p className="text-xs text-[var(--ink-muted)] italic px-1">{t("resultPending")}</p>
        ) : lab ? (
          <div className="space-y-3">
            {lab.params.length > 0 && (
              <div className="border border-[var(--line)] rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--surface-2)]">
                    <tr>
                      <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)]">{t("parameter")}</th>
                      <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)] w-24">{t("value")}</th>
                      <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)] w-20">{t("unit")}</th>
                      <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)] w-28">{t("refRange")}</th>
                      <th className="text-center px-2 py-1.5 font-medium text-[var(--ink-muted)] w-14">{t("flag")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lab.params.map((p, i) => (
                      <tr key={i} className={cn("border-t border-[var(--line)]", p.flag === "H" ? "bg-[var(--rose-50)]" : p.flag === "L" ? "bg-blue-50/50" : "")}>
                        <td className="px-2 py-1.5 text-[var(--ink)]">{p.name}</td>
                        <td className={cn("px-2 py-1.5 font-medium", p.flag === "H" ? "text-[var(--rose-600)]" : p.flag === "L" ? "text-blue-600" : "text-[var(--ink)]")}>{p.value}</td>
                        <td className="px-2 py-1.5 text-[var(--ink-muted)]">{p.unit}</td>
                        <td className="px-2 py-1.5 text-[var(--ink-muted)]">{p.refRange}</td>
                        <td className={cn("px-2 py-1.5 text-center", flagColor(p.flag))}>{p.flag || "N"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {lab.notes && (
              <div className="text-xs">
                <span className="text-[var(--ink-muted)]">{t("notes")}: </span>
                <span className="text-[var(--ink)] whitespace-pre-wrap">{lab.notes}</span>
              </div>
            )}
          </div>
        ) : img ? (
          <div className="space-y-3 text-xs">
            {img.findings && (
              <div>
                <div className="font-semibold text-[var(--ink-muted)] uppercase tracking-wide text-[10px] mb-0.5">{t("findings")}</div>
                <p className="text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{img.findings}</p>
              </div>
            )}
            {img.impression && (
              <div>
                <div className="font-semibold text-[var(--ink-muted)] uppercase tracking-wide text-[10px] mb-0.5">{t("impression")}</div>
                <p className="text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{img.impression}</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Footer: jump to the patient chart */}
        <div className="flex justify-end pt-1">
          <button
            className="btn btn-outline btn-sm gap-1.5"
            onClick={e => { e.stopPropagation(); setLocation(`/patients/${row.patientId}`); }}
            data-testid={`button-view-patient-${row.kind}-${row.id}`}
          >
            {t("viewPatient")} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h1 className="font-semibold text-[var(--ink)] text-[15px]">{t("myOrders")}</h1>
          <p className="text-[12px] text-[var(--ink-muted)]">{allOrders.length} {t("orders")}</p>
        </div>
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientOrTest")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label={t("searchByPatientOrTest")}
        />
        <Select value={filterKind} onValueChange={v => setFilterKind(v as any)}>
          <SelectTrigger className="h-8 text-sm w-32" aria-label={t("orderType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="lab">{t("lab")}</SelectItem>
            <SelectItem value="xray">{t("xray")}</SelectItem>
            <SelectItem value="ultrasound">{t("ultrasound")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={filtered}
          emptyMessage={t("noOrdersPlaced")}
          onRowClick={toggleExpand}
          rowClassName={r => (rowKey(r) === expandedKey ? "bg-[var(--surface-2)]" : "")}
          expandedRow={expandedKey ? (row) => (rowKey(row) === expandedKey ? renderDetail(row) : null) : undefined}
          columns={[
            {
              key: "kind",
              header: t("orderType"),
              render: r => {
                const Icon = KIND_ICONS[r.kind];
                return (
                  <span className={cn("badge text-xs gap-1", KIND_BADGE[r.kind])}>
                    <Icon className="w-3 h-3" />
                    {t(r.kind as any)}
                  </span>
                );
              },
            },
            {
              key: "patient",
              header: t("patient"),
              render: r => <span className="text-[13px] font-medium text-[var(--ink)]">{r.patientName}</span>,
            },
            { key: "detail", header: t("examType"), render: r => <span className="text-[13px] text-[var(--ink)]">{r.detail}</span> },
            {
              key: "result",
              header: t("result"),
              render: r => {
                const preview = resultPreview(r);
                return preview
                  ? <span className="text-[12px] text-[var(--ink-muted)] line-clamp-1 max-w-[280px]">{preview}</span>
                  : <span className="text-[12px] text-[var(--ink-muted)]">—</span>;
              },
            },
            { key: "status", header: t("status"), render: r => <StatusBadge status={r.status} /> },
            { key: "date",   header: t("date"),   render: r => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(r.createdAt)}</span> },
            {
              key: "chevron",
              header: "",
              className: "w-8",
              render: r => (
                <span className="text-[var(--ink-muted)]">
                  {rowKey(r) === expandedKey ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
