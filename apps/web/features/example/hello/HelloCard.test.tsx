import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelloCard } from "./HelloCard";

describe("HelloCard", () => {
  it("shows the loading state", () => {
    render(<HelloCard title="Hello" state="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });
  it("shows the empty state with no content", () => {
    render(<HelloCard title="Hello" state="empty" />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
  it("renders children when ready", () => {
    render(
      <HelloCard title="Hello" state="ready">
        content
      </HelloCard>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
