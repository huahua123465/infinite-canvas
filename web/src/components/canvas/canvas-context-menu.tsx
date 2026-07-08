import { useEffect } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export type CanvasContextMenuAction = {
    id: string;
    label: string;
    onClick: () => void;
    shortcut?: string;
    danger?: boolean;
    disabled?: boolean;
    dividerBefore?: boolean;
};

export function CanvasNodeContextMenu({
    menu,
    canvasActions = [],
    onClose,
    onDuplicate,
    onDelete,
}: {
    menu: ContextMenuState;
    canvasActions?: CanvasContextMenuAction[];
    onClose: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isCanvasMenu = menu.type === "canvas";
    const menuActions: CanvasContextMenuAction[] = isCanvasMenu
        ? canvasActions
        : menu.type === "node"
          ? [
                { id: "duplicate", label: "复制节点", onClick: onDuplicate },
                { id: "delete", label: "删除节点", onClick: onDelete, danger: true, dividerBefore: true },
            ]
          : [{ id: "delete", label: "删除连线", onClick: onDelete, danger: true }];
    const estimatedWidth = isCanvasMenu ? 196 : 176;
    const estimatedHeight = Math.min(320, 20 + menuActions.length * 38 + menuActions.filter((action) => action.dividerBefore).length * 12);
    const left = clamp(menu.x, 12, window.innerWidth - estimatedWidth - 12);
    const top = clamp(menu.y, 12, window.innerHeight - estimatedHeight - 12);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover,.ant-modal,.ant-dropdown,.ant-select-dropdown")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] w-[196px] overflow-hidden rounded-[14px] border p-2 shadow-2xl backdrop-blur-xl"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 18px 52px rgba(0,0,0,.26)" }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menuActions.map((action) => (
                <MenuButton key={action.id} action={action} onClose={onClose} />
            ))}
        </div>
    );
}

function MenuButton({ action, onClose }: { action: CanvasContextMenuAction; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const color = action.disabled ? theme.node.muted : action.danger ? "#f87171" : theme.node.text;

    return (
        <>
            {action.dividerBefore ? <div className="my-1 h-px" style={{ background: theme.toolbar.border }} /> : null}
            <button
                type="button"
                className="flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-[13px] font-semibold transition disabled:cursor-default disabled:opacity-45"
                style={{ color, background: "transparent" }}
                disabled={action.disabled}
                onMouseEnter={(event) => {
                    if (action.disabled) return;
                    event.currentTarget.style.background = theme.toolbar.itemHover;
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                }}
                onClick={() => {
                    if (action.disabled) return;
                    action.onClick();
                    onClose();
                }}
            >
                <span className="min-w-0 truncate">{action.label}</span>
                {action.shortcut ? <span className="shrink-0 text-xs font-medium opacity-38">{action.shortcut}</span> : null}
            </button>
        </>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
