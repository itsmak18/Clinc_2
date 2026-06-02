import { useState } from "react";
import {
  useListPatientConsents, getListPatientConsentsQueryKey,
  useGrantPatientConsent, useRevokePatientConsent,
  type Consent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Plus, X } from "lucide-react";

const VIEW_ROLES = ["super_admin", "admin", "compliance_officer", "doctor", "nurse"];
const GRANT_ROLES = ["super_admin", "admin", "nurse", "front_desk"];
const REVOKE_ROLES = ["super_admin", "admin", "compliance_officer"];

const CONSENT_TYPES = ["treatment", "data_sharing", "research", "marketing"] as const;
const TYPE_LABEL: Record<string, string> = {
  treatment: "consentTreatment",
  data_sharing: "consentDataSharing",
  research: "consentResearch",
  marketing: "consentMarketing",
};

export default function PatientConsentCard({ patientId }: { patientId: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const role = user?.role ?? "";

  const canView = VIEW_ROLES.includes(role);
  const canGrant = GRANT_ROLES.includes(role);
  const canRevoke = REVOKE_ROLES.includes(role);

  const [showForm, setShowForm] = useState(false);
  const [consentType, setConsentType] = useState<string>("treatment");
  const [documentVersion, setDocumentVersion] = useState("v1.0");
  const [notes, setNotes] = useState("");

  const listKey = getListPatientConsentsQueryKey(patientId);
  const { data: consents } = useListPatientConsents(patientId, {
    query: { enabled: canView && !!patientId, queryKey: listKey },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const grantMutation = useGrantPatientConsent({
    mutation: {
      onSuccess: () => {
        toast({ title: t("consentGrantedToast") });
        setShowForm(false);
        setNotes("");
        invalidate();
      },
    },
  });

  const revokeMutation = useRevokePatientConsent({
    mutation: {
      onSuccess: () => {
        toast({ title: t("consentRevokedToast") });
        invalidate();
      },
    },
  });

  const submitGrant = () => {
    if (documentVersion.trim().length === 0) return;
    grantMutation.mutate({
      patientId,
      data: { consentType: consentType as any, documentVersion: documentVersion.trim(), notes: notes.trim() || null },
    });
  };

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <ShieldCheck className="w-4 h-4" /> {t("consentManagement")}
        </h3>
        {canGrant && (
          <button className="btn btn-outline btn-sm gap-1.5" onClick={() => setShowForm(s => !s)}>
            {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {t("grantConsent")}
          </button>
        )}
      </div>

      {canGrant && showForm && (
        <div className="border border-[var(--line)] rounded-md p-3 mb-3 flex flex-col gap-2.5 bg-[var(--surface-2)]">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("consentType")}</Label>
              <Select value={consentType} onValueChange={setConsentType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSENT_TYPES.map(ct => <SelectItem key={ct} value={ct}>{t(TYPE_LABEL[ct] as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("documentVersion")}</Label>
              <Input className="h-8 text-sm" value={documentVersion} onChange={e => setDocumentVersion(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("consentNotesLabel")}</Label>
            <Input className="h-8 text-sm" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button
              className="btn btn-primary btn-sm"
              onClick={submitGrant}
              disabled={grantMutation.isPending || documentVersion.trim().length === 0}
            >
              {grantMutation.isPending ? t("loading") : t("grantConsent")}
            </button>
          </div>
        </div>
      )}

      {canView ? (
        (consents ?? []).length === 0 ? (
          <p className="text-xs text-[var(--ink-muted)] italic">{t("noConsents")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(consents ?? []).map((c: Consent) => {
              const active = !c.revokedAt;
              return (
                <div key={c.id} className="flex items-center gap-3 border border-[var(--line)] rounded-md px-3 py-2">
                  <span className="badge badge-teal text-[10px] whitespace-nowrap">{t(TYPE_LABEL[c.consentType] as any)}</span>
                  <span className={`badge text-[10px] ${active ? "badge-sage" : "badge-rose"}`}>
                    {active ? t("consentActive") : t("consentRevokedStatus")}
                  </span>
                  <span className="text-[11px] text-[var(--ink-muted)] truncate">
                    {t("grantedOn")} {formatDate(c.grantedAt)} · {c.documentVersion}
                    {c.revokedAt && ` · ${t("revokedOn")} ${formatDate(c.revokedAt)}`}
                  </span>
                  {canRevoke && active && (
                    <button
                      className="btn btn-ghost btn-sm h-6 ms-auto text-[var(--rose-500)]"
                      disabled={revokeMutation.isPending}
                      onClick={() => {
                        if (window.confirm(t("confirmRevokeConsent"))) {
                          revokeMutation.mutate({ patientId, consentId: c.id });
                        }
                      }}
                    >
                      {t("revoke")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <p className="text-xs text-[var(--ink-muted)] italic">{t("consentRequiredHint")}</p>
      )}
    </div>
  );
}
