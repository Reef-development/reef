import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * jsdom lacks a few browser APIs the Radix dropdowns call. These stand-ins do nothing, which is
 * all a test needs.
 */
export function installBrowserShims() {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Renders one screen inside a real router and query client, the way the app does, so hooks
 * like useNavigate and useMutation behave as they do for a person using it.
 */
export async function renderScreen(Screen: ComponentType, url = "/") {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/", component: Screen });
  const other = createRoute({ getParentRoute: () => root, path: "$", component: () => <p>Left the form</p> });
  const router = createRouter({
    routeTree: root.addChildren([page, other]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await router.load();
  return { ...view, user, router, queryClient };
}

/** Opens a dropdown and picks an option by its visible text, as a person would. */
export async function pick(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

/** A promise the test resolves when it chooses, to hold a save "in flight". */
export function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
