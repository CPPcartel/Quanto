import { useEffect, useState } from "react";
import { LINKS } from "./links";
import { Mark } from "./Chrome";

/**
 * PDF viewer.
 *
 * Download managers (IDM and similar) hook links by file extension and
 * content type, and they do it in the browser — no server header can prevent
 * it, because the interception happens before the response is ever rendered.
 * `Content-Disposition: inline` is correct and still set, but it cannot win an
 * argument with a native download hook.
 *
 * So this route never navigates to a .pdf URL at all. It fetches the file with
 * XHR/fetch, wraps the bytes in a blob: URL, and renders that in an iframe.
 * A blob: URL has no extension and no network request for the manager to
 * observe, so the document opens in the browser's own PDF viewer as intended.
 * The explicit download button is still there for people who actually want the
 * file — that choice should be theirs, not a manager's.
 */

type State = "loading" | "ready" | "error";

export function WhitepaperViewer() {
  const [state, setState] = useState<State>("loading");
  const [blobUrl, setBlobUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let created = "";

    (async () => {
      try {
        const res = await fetch(LINKS.whitepaperPdf, { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;

        // Force the MIME type: a blob typed application/pdf renders in the
        // built-in viewer regardless of how the server labelled it.
        created = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setBlobUrl(created);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, []);

  const download = () => {
    const a = document.createElement("a");
    a.href = blobUrl || LINKS.whitepaperPdf;
    a.download = "quanto-whitepaper.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="pdf-shell">
      <header className="pdf-bar">
        <a className="brand" href="/">
          <Mark size={18} />
          <span>
            QUAN<em>TO</em>
          </span>
        </a>

        <span className="pdf-title">Whitepaper · v1.0</span>

        <div className="pdf-actions">
          <button className="ghost" onClick={download} disabled={state !== "ready"}>
            Download
          </button>
          <a className="ghost-link" href="/">
            Back to site
          </a>
        </div>
      </header>

      <div className="pdf-body">
        {state === "loading" && (
          <div className="pdf-msg">
            <span className="pulse live" />
            <p>Loading document…</p>
          </div>
        )}

        {state === "error" && (
          <div className="pdf-msg">
            <p>Couldn't load the document in the viewer.</p>
            <a className="ghost-link" href={LINKS.whitepaperPdf} target="_blank" rel="noreferrer">
              Open the file directly
            </a>
          </div>
        )}

        {state === "ready" && (
          <iframe className="pdf-frame" src={blobUrl} title="Quanto Whitepaper" />
        )}
      </div>
    </div>
  );
}
