import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { StepFlow } from "../api/sox";

const STATUS_COLOR: Record<string, string> = {
  empty: "#cbd5e1",
  pending: "#94a3b8",
  in_progress: "#3b82f6",
  failed: "#ef4444",
  passed: "#10b981",
};

export function FlowDiagram({
  steps,
  selected,
  onSelect,
  onAdd,
  onDelete,
  editable = true,
}: {
  steps: StepFlow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onDelete: (id: string) => void;
  editable?: boolean;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAdd(newName.trim());
    setNewName("");
  };

  return (
    <div className="flow-wrap">
      <div className="flow-track">
        {steps.map((s, i) => (
          <div className="flow-node-group" key={s.id}>
            {i > 0 && <span className="flow-arrow">‹</span>}
            <button
              type="button"
              className={`flow-node ${selected === s.id ? "active" : ""}`}
              onClick={() => onSelect(s.id)}
              title={t(`flow.status.${s.status}`)}
            >
              <span className="flow-node-dot" style={{ background: STATUS_COLOR[s.status] }} />
              <span className="flow-node-name">{s.name_he}</span>
              <span className="flow-node-meta">
                <span title={t("flow.risks")}>🛑 {s.risk_count}</span>
                <span title={t("flow.controls")}>🛡️ {s.control_count}</span>
                {s.tests_failed > 0 && (
                  <span className="text-danger" title={t("flow.status.failed")}>
                    ✗ {s.tests_failed}
                  </span>
                )}
                {s.tests_passed > 0 && (
                  <span className="text-success" title={t("flow.status.passed")}>
                    ✓ {s.tests_passed}
                  </span>
                )}
              </span>
              {editable && (
                <span
                  role="button"
                  className="flow-node-del"
                  title={t("flow.delete_step")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          </div>
        ))}
        {steps.length === 0 && <span className="text-muted small">{t("flow.empty")}</span>}
      </div>
      {editable && (
        <form className="flow-add" onSubmit={submitAdd}>
          <input
            className="form-control form-control-sm"
            placeholder={t("flow.add_step") ?? ""}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-sm btn-outline-primary">+</button>
        </form>
      )}
      <div className="flow-legend">
        {["passed", "in_progress", "failed", "pending", "empty"].map((k) => (
          <span key={k}>
            <span className="flow-node-dot" style={{ background: STATUS_COLOR[k] }} />
            {t(`flow.status.${k}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
