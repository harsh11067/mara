import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface PanelHeaderProps {
  title: string;
  icon?: LucideIcon;
  badgeText?: string;
  badgeType?: "success" | "error" | "warning" | "info" | "muted";
  subtitle?: string;
  chip?: ReactNode;
}

const toneMap: Record<string, string> = {
  success: "mc-badge--pos",
  error:   "mc-badge--neg",
  warning: "mc-badge--amber",
  info:    "mc-badge--info",
  muted:   "mc-badge--muted",
};

export default function PanelHeader({ title, icon: Icon, badgeText, badgeType = "muted", subtitle, chip }: PanelHeaderProps) {
  return (
    <header className="mc-modhead">
      {Icon && <span className="ic"><Icon size={20} /></span>}
      <div className="titles" style={{ flex: "0 0 auto" }}>
        <span className="mara-h1">{title}</span>
      </div>
      {subtitle && (
        <div className="titles" style={{ flex: 1, paddingLeft: 14, borderLeft: "1px solid var(--border)" }}>
          <span className="mara-subtitle">{subtitle}</span>
        </div>
      )}
      {chip ? (
        <div style={{ marginLeft: "auto" }}>{chip}</div>
      ) : badgeText ? (
        <div style={{ marginLeft: "auto" }}>
          <span className={`mc-badge ${toneMap[badgeType]}`}>{badgeText}</span>
        </div>
      ) : null}
    </header>
  );
}
