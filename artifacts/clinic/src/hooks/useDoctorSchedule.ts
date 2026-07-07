import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListScheduleDoctors,
  useGetDoctorSchedule,
  useGetScheduleWeek,
  useUpsertWeeklyBlock,
  useUpdateWeeklyBlockStatus,
  useDeleteWeeklyBlock,
  useUpsertScheduleOverride,
  useDeleteScheduleOverride,
  getListScheduleDoctorsQueryKey,
  getGetDoctorScheduleQueryKey,
  getGetScheduleWeekQueryKey,
  type DoctorScheduleSummary,
  type DoctorScheduleDetail,
  type WeekResponse,
  type UpsertWeeklyBlockBody,
  type UpsertOverrideBody,
  type UpdateWeeklyBlockStatusBody,
  type UpsertWeeklyBlockBodyDayOfWeek,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/auth";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/i18n";
import { getWeekStart } from "@/lib/datetime";

export interface UseDoctorScheduleReturn {
  doctors: DoctorScheduleSummary[];
  loadingDoctors: boolean;
  scheduleDetail: DoctorScheduleDetail | undefined;
  loadingDetail: boolean;
  weekData: WeekResponse | undefined;
  activeDoctorId: number | null;
  selectedDoctorId: number | null;
  setSelectedDoctorId: (id: number | null) => void;
  weekStart: string;
  setWeekStart: (ws: string) => void;
  canEdit: boolean;
  isDoctor: boolean;
  /** Rejects on failure so dialog callers can keep the form open for retry. */
  upsertBlock: (doctorId: number, data: UpsertWeeklyBlockBody) => Promise<unknown>;
  upsertBlockPending: boolean;
  toggleBlockStatus: (doctorId: number, day: UpsertWeeklyBlockBodyDayOfWeek, data: UpdateWeeklyBlockStatusBody) => void;
  deleteBlock: (doctorId: number, day: UpsertWeeklyBlockBodyDayOfWeek) => void;
  /** Rejects on failure so dialog callers can keep the form open for retry. */
  upsertOverride: (doctorId: number, data: UpsertOverrideBody) => Promise<unknown>;
  upsertOverridePending: boolean;
  deleteOverride: (doctorId: number, date: string) => void;
}

export function useDoctorSchedule(): UseDoctorScheduleReturn {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const canEdit = user?.role === "super_admin" || user?.role === "admin";
  const isDoctor = user?.role === "doctor";

  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const activeDoctorId = isDoctor ? (user?.id ?? null) : selectedDoctorId;

  const { data: doctors = [], isLoading: loadingDoctors } = useListScheduleDoctors();

  const { data: scheduleDetail, isLoading: loadingDetail } = useGetDoctorSchedule(
    activeDoctorId!,
    { query: { enabled: !!activeDoctorId, queryKey: getGetDoctorScheduleQueryKey(activeDoctorId!) } },
  );

  const { data: weekData } = useGetScheduleWeek(
    { doctorId: activeDoctorId!, weekStart },
    { query: { enabled: !!activeDoctorId, queryKey: getGetScheduleWeekQueryKey({ doctorId: activeDoctorId!, weekStart }) } },
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListScheduleDoctorsQueryKey() });
    if (activeDoctorId) {
      qc.invalidateQueries({ queryKey: getGetDoctorScheduleQueryKey(activeDoctorId) });
      qc.invalidateQueries({ queryKey: getGetScheduleWeekQueryKey({ doctorId: activeDoctorId, weekStart }) });
    }
  }

  const upsertBlockMutation = useUpsertWeeklyBlock({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("save") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const toggleStatusMutation = useUpdateWeeklyBlockStatus({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const deleteBlockMutation = useDeleteWeeklyBlock({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("delete") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const upsertOverrideMutation = useUpsertScheduleOverride({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("save") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const deleteOverrideMutation = useDeleteScheduleOverride({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  return {
    doctors,
    loadingDoctors,
    scheduleDetail,
    loadingDetail,
    weekData,
    activeDoctorId,
    selectedDoctorId,
    setSelectedDoctorId,
    weekStart,
    setWeekStart,
    canEdit,
    isDoctor,
    upsertBlock: (doctorId, data) => upsertBlockMutation.mutateAsync({ doctorId, data }),
    upsertBlockPending: upsertBlockMutation.isPending,
    toggleBlockStatus: (doctorId, day, data) => toggleStatusMutation.mutate({ doctorId, day, data }),
    deleteBlock: (doctorId, day) => deleteBlockMutation.mutate({ doctorId, day }),
    upsertOverride: (doctorId, data) => upsertOverrideMutation.mutateAsync({ doctorId, data }),
    upsertOverridePending: upsertOverrideMutation.isPending,
    deleteOverride: (doctorId, date) => deleteOverrideMutation.mutate({ doctorId, date }),
  };
}
