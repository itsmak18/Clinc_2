import { useState } from "react";
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
import { FlaskConical, Scan, Activity } from "lucide-react";

type OrderKind = "lab" | "xray" | "ultrasound";

interface OrderRow {
  id: number;
  kind: OrderKind;
  patientId: number;
  patientName: string;
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

export default function DoctorOrders() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [filterKind, setFilterKind] = useState<OrderKind | "all">("all");
  const [search, setSearch] = useState("");

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
        detail: l.testName ?? "-",
        status: l.status, result: l.results ?? null, createdAt: l.createdAt,
      })),
    ...(xrays ?? [])
      .filter((x: any) => x.requestedById === myId)
      .map((x: any): OrderRow => ({
        id: x.id, kind: "xray", patientId: x.patientId,
        patientName: x.patient?.fullName ?? `#${x.patientId}`,
        detail: x.bodyPart ?? "-",
        status: x.status, result: x.report ?? null, createdAt: x.createdAt,
      })),
    ...(us ?? [])
      .filter((u: any) => u.requestedById === myId)
      .map((u: any): OrderRow => ({
        id: u.id, kind: "ultrasound", patientId: u.patientId,
        patientName: u.patient?.fullName ?? `#${u.patientId}`,
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
              render: r => r.result
                ? <span className="text-[12px] text-[var(--ink-muted)] line-clamp-1 max-w-[280px]">{r.result}</span>
                : <span className="text-[12px] text-[var(--ink-muted)]">—</span>,
            },
            { key: "status", header: t("status"), render: r => <StatusBadge status={r.status} /> },
            { key: "date",   header: t("date"),   render: r => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(r.createdAt)}</span> },
          ]}
        />
      </div>
    </div>
  );
}
