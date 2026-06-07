import { useTranslation } from "react-i18next";

// Semantic Bootstrap color per status value (control / test / severity).
const COLORS: Record<string, string> = {
  // control statuses
  draft: "secondary",
  needs_validation: "warning",
  needs_fix: "danger",
  validated: "success",
  // test statuses
  pending_receipt: "secondary",
  consultant_handling: "info",
  company_completion: "info",
  additional_evidence: "warning",
  reviewed_approved: "success",
  internally_closed: "success",
  needs_attention: "warning",
  deficiency_open: "danger",
  deficiency_compensated: "warning",
  deficiency_closed: "success",
  round_b_pending: "secondary",
  not_relevant: "light",
  // deficiency severity
  deficiency: "warning",
  material_deficiency: "danger",
  material_weakness: "dark",
};

export function StatusBadge({ value, prefix }: { value: string; prefix: string }) {
  const { t } = useTranslation();
  const color = COLORS[value] ?? "secondary";
  return <span className={`badge text-bg-${color}`}>{t(`${prefix}.${value}`)}</span>;
}
