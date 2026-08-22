import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catch a render crash and say what it was.
 *
 * React unmounts the entire tree when a component throws during render and
 * nothing catches it. In development that is loud; in a production build it is
 * a completely black page with no HUD, no error, and no clue — which is exactly
 * what a player reported, and exactly why it could not be diagnosed remotely.
 *
 * So this is not decoration. An app with no boundary destroys the evidence of
 * its own failure, and the first thing anybody needs is the message.
 *
 * Deliberately shows the error text rather than a friendly apology. The people
 * hitting this are either the operator or somebody who is about to be asked
 * "what did it say", and "Something went wrong" wastes that conversation.
 */

interface Props {
  children: ReactNode;
  /** Names the area that failed, so a report says which part came down. */
  area?: string;
}

interface State {
  error: Error | null;
  info: string;
}

export class Boundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the console too: a player can be asked to paste it, and it
    // carries the component stack, which the panel below deliberately does not.
    console.error(`[${this.props.area ?? "app"}] render crashed`, error, info.componentStack);
    this.setState({ info: (info.componentStack ?? "").split("\n").slice(0, 6).join("\n") });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="overlay center crash">
        <div className="panel crash-panel">
          <span className="wallet-label">QUANTO</span>
          <h2 className="signin-title">The city stopped drawing</h2>

          <p className="dim signin-copy">
            Something in the interface threw an error. Your account, your floors
            and your balance are on the server and are not affected.
          </p>

          <pre className="crash-detail">
            {error.message || String(error)}
            {info ? `\n${info}` : ""}
          </pre>

          <div className="crash-actions">
            <button className="primary-btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>

          <p className="dim tiny signin-note">
            If this keeps happening, send the message above. It names the exact
            component that failed.
          </p>
        </div>
      </div>
    );
  }
}
