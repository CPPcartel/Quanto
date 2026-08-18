import { useEffect, useState } from "react";

/**
 * A four-route router in thirty lines.
 *
 * react-router would work, but this app has four static paths and no nested
 * layouts, so a dependency would be all cost and no benefit. Vercel is
 * configured to rewrite every path to index.html, and Vite's dev server does
 * the same, so deep links work in both.
 */

/**
 * /whitepaper is an HTML page that renders the PDF, not the PDF itself.
 *
 * Linking straight to /whitepaper.pdf lets download managers intercept the
 * navigation by file extension — no server header prevents that, because the
 * hook runs in the browser. Routing to HTML instead keeps the document in a
 * tab where it belongs.
 */
export type Route = "/" | "/play" | "/docs" | "/whitepaper";

const ROUTES: Route[] = ["/", "/play", "/docs", "/whitepaper"];

function normalise(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return (ROUTES.find((r) => r === clean) ?? "/") as Route;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => normalise(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(normalise(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return route;
}

export function navigate(to: Route) {
  if (normalise(window.location.pathname) === to) return;
  window.history.pushState({}, "", to);
  // pushState doesn't fire popstate; tell our own listeners ourselves.
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

/** Intercepts clicks so internal links don't trigger a full page reload. */
export function linkProps(to: Route) {
  return {
    href: to,
    onClick: (e: React.MouseEvent) => {
      // Let the browser handle modified clicks (new tab, download, etc).
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
