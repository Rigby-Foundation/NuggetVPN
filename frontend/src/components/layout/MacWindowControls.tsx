import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MacWindowControlsProps {
  onClose: () => void;
  onMinimize: () => void;
  onMaximize?: () => void;
  className?: string;
}

export function MacWindowControls({
  onClose,
  onMinimize,
  onMaximize,
  className,
}: MacWindowControlsProps) {
  const t = useT();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={onClose}
        className="h-3 w-3 rounded-full bg-[#FF5F57] transition-colors hover:bg-[#FF5F57]/80"
        aria-label={t("window.close")}
      />
      <button
        type="button"
        onClick={onMinimize}
        className="h-3 w-3 rounded-full bg-[#FEBC2E] transition-colors hover:bg-[#FEBC2E]/80"
        aria-label={t("window.minimize")}
      />
      <button
        type="button"
        onClick={onMaximize}
        className="h-3 w-3 rounded-full bg-[#28C840] transition-colors hover:bg-[#28C840]/80"
        aria-label={t("window.maximize")}
      />
    </div>
  );
}
