import type { ReactNode } from "react";

interface HeroAction {
  href: string;
  label: string;
}

interface HeroProps {
  title?: string;
  lead: string;
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  id?: string;
  children?: ReactNode;
}

export function Hero({
  title,
  lead,
  primaryAction,
  secondaryAction,
  id = "hero-title",
  children,
}: HeroProps) {
  return (
    <header className="hero" aria-labelledby={id}>
      {children ? (
        children
      ) : title ? (
        <h1 id={id} className="hero-title">
          {title}
        </h1>
      ) : null}
      <p className="lead">{lead}</p>
      {(primaryAction || secondaryAction) && (
        <p className="home-actions">
          {primaryAction && (
            <a className="button" href={primaryAction.href}>
              {primaryAction.label}
            </a>
          )}
          {secondaryAction && (
            <a className="hero-secondary-link" href={secondaryAction.href}>
              {secondaryAction.label}
            </a>
          )}
        </p>
      )}
    </header>
  );
}
