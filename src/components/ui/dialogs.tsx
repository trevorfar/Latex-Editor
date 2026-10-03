"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface PromptOptions {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to block submission. */
  validate?: (value: string) => string | null;
  /** Select only this many leading characters initially (e.g. the name without extension). */
  selectLength?: number;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogApi {
  prompt: (opts: PromptOptions) => Promise<string | null>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogApi | null>(null);

type State =
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | null;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.initial ?? "");
        setError(null);
        setState({ kind: "prompt", opts, resolve });
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(0, opts.selectLength ?? el.value.length);
          }
        });
      }),
    [],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })),
    [],
  );

  const close = useCallback(() => {
    setState((s) => {
      if (s?.kind === "prompt") s.resolve(null);
      if (s?.kind === "confirm") s.resolve(false);
      return null;
    });
  }, []);

  const submit = () => {
    if (state?.kind === "prompt") {
      const v = value.trim();
      const err = state.opts.validate?.(v) ?? (v ? null : "Required");
      if (err) return setError(err);
      state.resolve(v);
      setState(null);
    } else if (state?.kind === "confirm") {
      state.resolve(true);
      setState(null);
    }
  };

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}
      <Modal
        open={state !== null}
        onClose={close}
        title={state?.opts.title ?? ""}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant={state?.kind === "confirm" && state.opts.danger ? "danger" : "primary"}
              onClick={submit}
              autoFocus={state?.kind === "confirm"}
            >
              {state?.opts.confirmLabel ?? "OK"}
            </Button>
          </>
        }
      >
        {state?.kind === "prompt" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {state.opts.label && <label className="mb-1.5 block text-[13px] text-fg-muted">{state.opts.label}</label>}
            <input
              ref={inputRef}
              value={value}
              placeholder={state.opts.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              className="h-9 w-full rounded-md border border-line-strong bg-bg px-3 text-sm outline-none focus:border-accent"
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          </form>
        )}
        {state?.kind === "confirm" && <div className="text-fg-muted">{state.opts.message}</div>}
      </Modal>
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used inside DialogProvider");
  return ctx;
}
