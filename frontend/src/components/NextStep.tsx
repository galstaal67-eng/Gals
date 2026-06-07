import { Link } from "react-router-dom";

export interface NextStepCta {
  label: string;
  to?: string;
  onClick?: () => void;
}

/**
 * "תמרור" — a signpost banner that tells the user what their next step is,
 * shown on every workflow screen. Tone "do" = actionable next step,
 * "done" = nothing left to do here.
 */
export function NextStep({
  text,
  cta,
  tone = "do",
}: {
  text: string;
  cta?: NextStepCta;
  tone?: "do" | "done";
}) {
  return (
    <div className={`next-step next-step-${tone}`}>
      <span className="next-step-ico" aria-hidden>
        {tone === "done" ? "✓" : "🧭"}
      </span>
      <span className="next-step-text">{text}</span>
      {cta &&
        (cta.to ? (
          <Link className="next-step-cta" to={cta.to}>
            {cta.label}
          </Link>
        ) : (
          <button type="button" className="next-step-cta" onClick={cta.onClick}>
            {cta.label}
          </button>
        ))}
    </div>
  );
}
