import { Suspense, lazy } from "react";
import { Boundary } from "./ui/Boundary";
import { useRoute } from "./site/router";
import { Nav, Footer } from "./site/Chrome";
import { Landing } from "./site/Landing";
import { DocsPage } from "./site/DocsPage";
import { WhitepaperViewer } from "./site/WhitepaperViewer";

/**
 * The game is loaded lazily so the marketing site doesn't ship PixiJS.
 * Vite code-splits on this import, keeping the landing bundle small.
 */
/**
 * The game and its entire auth stack load only when someone enters the city.
 * Keeping Privy out of this bundle is worth roughly a megabyte on the pages
 * people actually land on.
 */
const Game = lazy(() => import("./GameWithAuth"));

export default function App() {
  const route = useRoute();

  if (route === "/play") {
    return (
      <Boundary area="game">
        <Suspense fallback={<Booting />}>
          <Game />
        </Suspense>
      </Boundary>
    );
  }

  // The viewer is full-bleed and carries its own header, so it skips the
  // site chrome entirely.
  if (route === "/whitepaper") return <WhitepaperViewer />;

  return (
    <>
      <Nav route={route} />
      {route === "/docs" && <DocsPage />}
      {route === "/" && <Landing />}
      <Footer />
    </>
  );
}

function Booting() {
  return (
    <div className="booting">
      <div className="booting-inner">
        <span className="pulse live" />
        <p>Entering the city…</p>
      </div>
    </div>
  );
}
