import type { HTMLAttributes, ReactNode } from "react";

/** A bordered box with its title set into the top border. */
export function Panel({
  title,
  actions,
  brand,
  className,
  children,
  ...rest
}: {
  title?: ReactNode;
  actions?: ReactNode;
  /** On the forest-green brand surface. */
  brand?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={`box panel ${brand ? "on-brand" : ""} ${className ?? ""}`} {...rest}>
      {title && (
        <div className="panel-title">
          <h3 className="label">{title}</h3>
        </div>
      )}
      {actions && <div className="panel-actions">{actions}</div>}
      {children}
    </section>
  );
}
