// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installBrowserShims } from "./helpers";

const sendMessage = vi.fn<(m: { text: string }) => Promise<void>>();

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: "ready",
    stop: () => {},
    error: undefined,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { ReefieChat } from "@/components/ReefieChat";

const box = () => screen.getByRole("textbox", { name: "Message Reefie" }) as HTMLTextAreaElement;

beforeAll(() => {
  installBrowserShims();
  // jsdom has no matchMedia; the chat asks whether a fine pointer is present to focus the box.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
beforeEach(() => {
  window.sessionStorage.clear();
  sendMessage.mockReset();
  sendMessage.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Reefie keeps an unsent question for each conversation", () => {
  it("brings a half-typed question back when the conversation is reopened", async () => {
    const user = userEvent.setup();
    const first = render(<ReefieChat threadId="a" initialMessages={[]} />);
    await user.type(box(), "How much diesel did we burn");
    first.unmount();

    render(<ReefieChat threadId="a" initialMessages={[]} />);
    expect(box().value).toBe("How much diesel did we burn");
  });

  it("does not leak one conversation's draft into another", async () => {
    const user = userEvent.setup();
    const view = render(<ReefieChat threadId="a" initialMessages={[]} />);
    await user.type(box(), "only for A");
    view.rerender(<ReefieChat threadId="b" initialMessages={[]} />);
    expect(box().value).toBe("");
  });

  it("empties the box and forgets the draft once the question is sent", async () => {
    const user = userEvent.setup();
    render(<ReefieChat threadId="a" initialMessages={[]} />);
    await user.type(box(), "What is our headcount?");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ text: "What is our headcount?" }),
    );
    await waitFor(() => expect(box().value).toBe(""));
    expect(window.sessionStorage.getItem("reefie:draft:a")).toBeNull();
  });

  it("does not bring a sent question back after a restored draft was edited and sent", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem("reefie:draft:a", "How many");
    render(<ReefieChat threadId="a" initialMessages={[]} />);
    expect(box().value).toBe("How many");

    await user.type(box(), " tonnes today?");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await waitFor(() => expect(box().value).toBe(""));
    expect(window.sessionStorage.getItem("reefie:draft:a")).toBeNull();
  });

  it("keeps the question for another try when sending fails", async () => {
    const user = userEvent.setup();
    sendMessage.mockRejectedValue(new Error("offline"));
    render(<ReefieChat threadId="a" initialMessages={[]} />);
    await user.type(box(), "Try again later");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await waitFor(() =>
      expect(window.sessionStorage.getItem("reefie:draft:a")).toBe("Try again later"),
    );
  });
});
