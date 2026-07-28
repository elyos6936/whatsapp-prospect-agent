import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Évite l'écran noir si un composant (shader, analytics…) plante au montage. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Klanvio] UI crash', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center text-[#0a0f1a]">
          <h1 className="text-lg font-semibold">Interface temporairement indisponible</h1>
          <p className="max-w-md text-sm text-[#46566b]">
            Rechargez la page. Si le problème continue, videz le cache du navigateur ou ouvrez
            l’onglet en navigation privée.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-[#2057ce] px-4 py-2 text-sm font-medium text-white hover:bg-[#1845a8]"
          >
            Recharger
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
