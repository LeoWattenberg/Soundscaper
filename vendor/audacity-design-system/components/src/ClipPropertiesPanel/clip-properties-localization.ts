/* SPDX-License-Identifier: GPL-3.0-only */
import { createContext, useContext } from 'react';
export const ClipPropertiesLabels = createContext<Readonly<Record<string, string>>>({});
export function useClipPropertiesText() {
  const labels = useContext(ClipPropertiesLabels);
  return (text: string): string => labels[text] ?? text;
}
