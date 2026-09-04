import { useLayoutEffect, useRef, useImperativeHandle, forwardRef, type ReactNode, type UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { isPinnedToBottom } from "../lib/scroll";

export type VirtualTableHandle = {
  scrollToIndex: (index: number) => void;
};

export const VirtualTable = forwardRef<
  VirtualTableHandle,
  {
    count: number;
    rowHeight?: number;
    rowRenderer: (index: number) => ReactNode;
    header?: ReactNode;
    follow?: boolean;
  }
>(function VirtualTable({ count, rowHeight = 40, rowRenderer, header, follow = false }, ref) {
  const parentRef = useRef<HTMLDivElement>(null);
  const pinToBottom = useRef(true);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        virtualizer.scrollToIndex(index, { align: "center" });
      },
    }),
    [virtualizer],
  );

  if (count === 0) pinToBottom.current = true;

  useLayoutEffect(() => {
    if (!follow || count < 1 || !pinToBottom.current) return;
    virtualizer.scrollToIndex(count - 1, { align: "end" });
    const el = parentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [follow, count, virtualizer]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!follow) return;
    const el = event.currentTarget;
    pinToBottom.current = isPinnedToBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
  }

  return (
    <div className="vtable" role="grid">
      {header ? <div className="vtable-head">{header}</div> : null}
      <div className="vtable-body" ref={parentRef} onScroll={onScroll}>
        <div
          className="vtable-inner"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              className="vtable-row-abs"
              role="presentation"
              style={{
                height: `${item.size}px`,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {rowRenderer(item.index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
