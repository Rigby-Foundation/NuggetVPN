import { createContext, type ReactNode } from "react";
import { Server, UserGroup, Settings } from "lucide-react";
import { Workspace } from "@/components/Workspace";
export const SubPageContext = createContext(false);
interface Props {
  title: string;
  description?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  className?: string;
  memoryKey?: string;
  width?: "standard" | "narrow" | "full";
}
export default function PageShell({
  title,
  description,
  leading,
  actions,
  children,
  memoryKey,
}: Props) {
  const icon =
    memoryKey === "configuration"
      ? Server
      : memoryKey === "proxies"
        ? UserGroup
        : Settings;
  return (
    <Workspace
      title={title}
      description={description ?? ""}
      icon={icon}
      actions={actions}
    >
      {leading}
      {children}
    </Workspace>
  );
}
