import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export type CanvasContextMenuAction = {
    id: string;
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    children?: CanvasContextMenuAction[];
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
    const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
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
    const activeSubmenuIndex = menuActions.findIndex((action) => action.id === activeSubmenuId && action.children?.length);
    const activeSubmenuAction = activeSubmenuIndex >= 0 ? menuActions[activeSubmenuIndex] : null;
    const submenuActions = activeSubmenuAction?.children || [];
    const submenuWidth = 208;
    const submenuHeight = Math.min(420, 16 + submenuActions.length * 38 + submenuActions.filter((action) => action.dividerBefore).length * 12);
    const submenuGap = 8;
    const submenuLeft = left + estimatedWidth + submenuGap + submenuWidth <= window.innerWidth - 12 ? left + estimatedWidth + submenuGap : left - submenuWidth - submenuGap;
    const submenuTop = clamp(top + 8 + activeSubmenuIndex * 38, 12, window.innerHeight - submenuHeight - 12);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover,.ant-modal,.ant-dropdown,.ant-select-dropdown")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    useEffect(() => {
        setActiveSubmenuId(null);
    }, [menu.x, menu.y, menu.type]);

    return (
        <>
            <div
                className="fixed z-[80] w-[196px] overflow-hidden rounded-[14px] border p-2 shadow-2xl backdrop-blur-xl"
                style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 18px 52px rgba(0,0,0,.26)" }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {menuActions.map((action) => (
                    <MenuButton key={action.id} action={action} active={activeSubmenuId === action.id} onHover={() => setActiveSubmenuId(action.children?.length ? action.id : null)} onClose={onClose} />
                ))}
            </div>
            {submenuActions.length ? (
                <div
                    className="fixed z-[81] w-[208px] overflow-hidden rounded-[14px] border p-2 shadow-2xl backdrop-blur-xl"
                    style={{ left: submenuLeft, top: submenuTop, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 18px 52px rgba(0,0,0,.26)" }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseEnter={() => setActiveSubmenuId(activeSubmenuAction?.id || null)}
                >
                    {submenuActions.map((action) => (
                        <MenuButton key={action.id} action={action} onHover={() => undefined} onClose={onClose} />
                    ))}
                </div>
            ) : null}
        </>
    );
}

function MenuButton({ action, active = false, onHover, onClose }: { action: CanvasContextMenuAction; active?: boolean; onHover: () => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const color = action.disabled ? theme.node.muted : action.danger ? "#f87171" : theme.node.text;

    return (
        <>
            {action.dividerBefore ? <div className="my-1 h-px" style={{ background: theme.toolbar.border }} /> : null}
            <button
                type="button"
                className="flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-[13px] font-semibold transition disabled:cursor-default disabled:opacity-45"
                style={{ color, background: active ? theme.toolbar.itemHover : "transparent" }}
                disabled={action.disabled}
                onMouseEnter={(event) => {
                    onHover();
                    if (action.disabled) return;
                    event.currentTarget.style.background = theme.toolbar.itemHover;
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.background = active ? theme.toolbar.itemHover : "transparent";
                }}
                onClick={() => {
                    if (action.children?.length) return;
                    if (action.disabled) return;
                    action.onClick();
                    onClose();
                }}
            >
                <span className="flex min-w-0 items-center gap-2">
                    {action.icon ? <span className="grid size-4 shrink-0 place-items-center opacity-85">{action.icon}</span> : null}
                    <span className="min-w-0 truncate">{action.label}</span>
                </span>
                {action.children?.length ? <span className="shrink-0 text-base leading-none opacity-45">›</span> : action.shortcut ? <span className="shrink-0 text-xs font-medium opacity-40">{action.shortcut}</span> : null}
            </button>
        </>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
