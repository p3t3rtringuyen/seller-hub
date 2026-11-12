import Button from "@mui/material/Button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ConfirmDialog, Modal } from "./Dialogs";
import { EmptyState } from "./EmptyState";
import { ErrorCard } from "./ErrorCard";
import { ToastProvider, useBulkResultToast, useToast } from "./Toast";

const meta = {
  title: "Feedback/Empty, error, toast, dialogs",
  component: EmptyState,
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    title: "Nothing has been changed in this period.",
    description: "Try a longer date range.",
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Nothing has been changed in this period.",
    );
  },
};

export const Error: StoryObj = {
  render: () => (
    <ErrorCard
      message="The report could not be loaded."
      status={503}
      details="request-id: abc-123"
      onRetry={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await expect(root.getByRole("alert")).toHaveTextContent("503");
    await expect(root.getByRole("button", { name: "Retry" })).toBeEnabled();
    await expect(root.getByRole("button", { name: "Copy error content" })).toBeEnabled();
  },
};

function ToastDemo() {
  const { push } = useToast();
  const bulk = useBulkResultToast();
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button onClick={() => push({ tone: "info", message: "Saved" })}>Info</Button>
      <Button onClick={() => bulk({ ok: 8, failed: 2 })}>Partial</Button>
      <Button onClick={() => bulk({ ok: 0, failed: 3 })}>All failed</Button>
    </div>
  );
}

export const Toasts: StoryObj = {
  render: () => (
    <ToastProvider>
      <ToastDemo />
    </ToastProvider>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Partial" }));
    // Partial success is a warning with Successful / Failed counts, never a clean success.
    const alert = await within(document.body).findByRole("alert");
    await expect(alert).toHaveTextContent("8 successful, 2 failed");
  },
};

function ConfirmDemo({ irreversible }: { irreversible?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Archive 3 campaigns</Button>
      <ConfirmDialog
        open={open}
        title="Confirm Archive 3 Campaigns"
        consequence="Archived campaigns stop delivering and cannot be edited."
        confirmLabel="Archive"
        irreversible={irreversible ?? false}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setOpen(false);
          }, 30);
        }}
      />
    </>
  );
}

export const Confirm: StoryObj = {
  render: () => <ConfirmDemo irreversible />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Archive 3 campaigns" }),
    );
    const dialog = await within(document.body).findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Confirm Archive 3 Campaigns");
    await expect(dialog).toHaveTextContent("This cannot be undone.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    // All buttons disable while the write is in flight.
    await expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await waitFor(() => expect(within(document.body).queryByRole("alertdialog")).toBeNull());
  },
};

export const ModalForm: StoryObj = {
  render: () => {
    const Demo = () => {
      const [open, setOpen] = useState(true);
      return (
        <Modal
          open={open}
          title="Edit budget"
          onClose={() => setOpen(false)}
          actions={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          Budget form goes here.
        </Modal>
      );
    };
    return <Demo />;
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Edit budget");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
  },
};
