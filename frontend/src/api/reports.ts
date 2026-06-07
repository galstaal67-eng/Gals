import { getToken } from "./client";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

/** Download a report file (CSV/XLSX) with the auth header, triggering a save. */
export async function downloadReport(
  kind: "controls-matrix" | "test-status",
  auditYearId: string,
  format: "csv" | "xlsx",
): Promise<void> {
  const resp = await fetch(
    `${API_BASE}/reports/${kind}?audit_year_id=${auditYearId}&format=${format}`,
    { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
  );
  if (!resp.ok) throw new Error(`report failed: ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
