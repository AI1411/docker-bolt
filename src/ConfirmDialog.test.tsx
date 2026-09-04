import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeAll, expect, test } from "vitest";
import { ConfirmDialog } from "./components/ConfirmDialog";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

test("danger class comes from confirmVariant, not the Delete label", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <ConfirmDialog
        title="Delete container"
        body="Delete x?"
        confirmLabel="Delete"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
  });
  const buttons = [...el.querySelectorAll("button")];
  const confirm = buttons[buttons.length - 1];
  expect(confirm?.className).not.toContain("danger");
  expect(confirm?.className).toContain("primary");
  act(() => {
    root.unmount();
  });
  el.remove();
});

test("confirmVariant danger marks the confirm control", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <ConfirmDialog
        title="Down compose project"
        body="Down?"
        confirmLabel="Down"
        confirmVariant="danger"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
  });
  const buttons = [...el.querySelectorAll("button")];
  const confirm = buttons[buttons.length - 1];
  expect(confirm?.className).toContain("danger");
  act(() => {
    root.unmount();
  });
  el.remove();
});
