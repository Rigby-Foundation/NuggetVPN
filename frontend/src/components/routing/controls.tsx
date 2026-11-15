import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { DropdownMenuTrigger as MenuTrigger } from "@/components/ui/dropdown-menu";
import { TooltipTrigger as TipTrigger } from "@/components/ui/tooltip";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
export { Tooltip, TooltipContent } from "@/components/ui/tooltip";
function childProps(asChild: boolean | undefined, children: ReactNode) {
  if (!asChild || !isValidElement(children)) return { children };
  const child = children as ReactElement<{ children?: ReactNode }>;
  return { render: child, children: child.props.children };
}
export function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof MenuTrigger> & { asChild?: boolean }) {
  return <MenuTrigger {...props} {...childProps(asChild, children)} />;
}
export function TooltipTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof TipTrigger> & { asChild?: boolean }) {
  return <TipTrigger {...props} {...childProps(asChild, children)} />;
}
