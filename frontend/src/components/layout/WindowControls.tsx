import { Minus, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface WindowControlsProps {
    onMinimize: () => void;
    onMaximize: () => void;
    onClose: () => void;
}

export function WindowControls({
    onMinimize,
    onMaximize,
    onClose,
}: WindowControlsProps) {
    return (
        <div className="flex justify-end select-none transition-colors duration-200" data-tauri-drag-region>
            <div className="flex items-center text-foreground z-50">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onMinimize}
                    className="h-8 w-10 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-none cursor-default"
                >
                    <Minus size={16} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onMaximize}
                    className="h-8 w-10 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-none cursor-default"
                >
                    <Square size={14} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="h-8 w-10 hover:bg-red-500 hover:text-white rounded-none cursor-default"
                >
                    <X size={16} />
                </Button>
            </div>
        </div>
    );
}
