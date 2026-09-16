/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LocalizedPresentationMessage } from './presentation-message.ts';

/** Percentages remain parameters while the operation retains its own source identity. */
export function percentagePresentationMessage(value: number | undefined, operation: string | LocalizedPresentationMessage): LocalizedPresentationMessage {
	const percent = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
	return { key: 'ui.nativeProjectStatus.progress', fallback: '{operation} {percent}%', parameters: { operation, percent } };
}
