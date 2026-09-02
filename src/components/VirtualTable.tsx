import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export function VirtualTable({
  count,
  rowHeight = 32,
  rowRenderer,
  header,
}: {
  count: number;
  rowHeight?: number;
  rowRenderer: (index: number) => ReactNode;
  header?: ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  return (
    <div className="vtable">
      {header ? <div className="vtable-head">{header}</div> : null}
      <div className="vtable-body" ref={parentRef}>
        <div
          className="vtable-inner"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              className="vtable-row-abs"
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
}
