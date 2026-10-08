import type { ReactNode } from "react";

export interface StepItem {
  number: number | string;
  title: string;
  content: ReactNode;
  id?: string;
}

interface StepRailProps {
  steps: StepItem[];
}

export function StepRail({ steps }: StepRailProps) {
  return (
    <div className="step-rail">
      {steps.map((step) => {
        const titleId = step.id || `step-${step.number}-title`;
        return (
          <section key={String(step.number)} className="step-row" aria-labelledby={titleId}>
            <div className="step-numeral" aria-hidden="true">
              {step.number}
            </div>
            <div className="step-card">
              <h2 id={titleId} className="step-title">
                {step.title}
              </h2>
              <div className="step-body">{step.content}</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
