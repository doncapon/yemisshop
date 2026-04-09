// ui/src/tests/components/NotFound.test.tsx
// Tests for the 404 page component.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import NotFound from "../../pages/NotFound";

// Stub SiteLayout — we only care about what NotFound renders
vi.mock("../../layouts/SiteLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("NotFound page", () => {
  it("renders the 404 heading", () => {
    renderAtPath("/some-random-path");
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("renders the friendly message", () => {
    renderAtPath("/oops");
    expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument();
  });

  it("shows the bad path in the UI", () => {
    renderAtPath("/bad/path/here");
    expect(screen.getByText(/\/bad\/path\/here/i)).toBeInTheDocument();
  });

  it("has a link to the homepage", () => {
    renderAtPath("/404");
    const link = screen.getByRole("link", { name: /go to homepage/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });

  it("has a link to My orders", () => {
    renderAtPath("/404");
    const link = screen.getByRole("link", { name: /my orders/i });
    expect(link).toBeInTheDocument();
  });
});
