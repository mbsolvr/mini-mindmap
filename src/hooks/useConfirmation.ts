import { useEffect, useRef, useState } from "react";
import type { Confirmation } from "../components/ConfirmDialog.tsx";

export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<((confirmed: boolean) => void) | null>(null);
  function confirm(prompt: Confirmation): Promise<boolean> {
    if (confirmationRef.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      confirmationRef.current = resolve;
      setConfirmation(prompt);
    });
  }
  function chooseConfirmation(value: boolean) {
    const resolve = confirmationRef.current;
    confirmationRef.current = null;
    setConfirmation(null);
    resolve?.(value);
  }
  useEffect(
    () => () => {
      confirmationRef.current?.(false);
      confirmationRef.current = null;
    },
    [],
  );
  return { confirmation, confirm, chooseConfirmation };
}
