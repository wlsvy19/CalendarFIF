import { mountLogin } from './ui/login';

export type Session = { uid: string; email: string };
export type AppDeps = {
  root: HTMLElement;
  onAuthChange(listener: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  mountMain(root: HTMLElement, session: Session): { destroy(): void };
};

export function createApp(deps: AppDeps): { destroy(): void } {
  let current: { destroy(): void } | null = null;
  const show = (session: Session | null) => {
    current?.destroy();
    current = session ? deps.mountMain(deps.root, session) : mountLogin(deps.root, { signIn: deps.signIn });
  };
  const unsubscribe = deps.onAuthChange(show);
  return {
    destroy() {
      unsubscribe();
      current?.destroy();
      current = null;
    },
  };
}
