import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

const interactiveSelector = "button,input,textarea,select,a,audio,video,[role='button'],[role='textbox'],[contenteditable='true'],.ant-btn,.ant-input,.ant-select,.ant-switch,.ant-upload";

export function useDraggableLayer(open = true) {
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!open) setOffset({ x: 0, y: 0 });
    }, [open]);

    const onPointerDown = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            if (event.button !== 0) return;
            if (event.target instanceof Element && event.target.closest(interactiveSelector)) return;
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX;
            const startY = event.clientY;
            const startOffset = offset;
            const move = (moveEvent: PointerEvent) => {
                moveEvent.preventDefault();
                setOffset({ x: startOffset.x + moveEvent.clientX - startX, y: startOffset.y + moveEvent.clientY - startY });
            };
            const stop = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", stop);
                window.removeEventListener("pointercancel", stop);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
        },
        [offset],
    );

    const style = { transform: `translate(${offset.x}px, ${offset.y}px)` } satisfies CSSProperties;
    const handleProps = { onPointerDown, className: "cursor-move select-none" };
    return { style, handleProps };
}
