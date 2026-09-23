export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

// Soft status pills. Status colors are reserved for state and always carry a text label.
const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-brand-50 text-brand-700",
  neutral: "bg-gray-100 text-gray-600",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}>{children}</span>;
}
