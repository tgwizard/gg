import type { HTMLAttributes, ReactNode } from "react";
import type { IconName } from "./icons";
import { PixelIcon } from "./PixelIcon";

/** A bordered box with a dithered shadow and its title set into the top border. */
export function Panel({
  title,
  icon,
  actions,
  night,
  className,
  children,
  ...rest
}: {
  title?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  night?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={`box panel ${night ? "on-night" : ""} ${className ?? ""}`} {...rest}>
      {title && (
        <div className="panel-title">
          {icon && <PixelIcon name={icon} />}
          <h3 className="label">{title}</h3>
        </div>
      )}
      {actions && <div className="panel-actions">{actions}</div>}
      {children}
    </section>
  );
}
