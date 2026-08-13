/* SPDX-License-Identifier: AGPL-3.0-only */

export type VideoKeyframeTransferShortcut = 'copy' | 'paste' | null;

/** Shared keyboard routing for the advertised curve-transfer shortcuts. */
export function videoKeyframeTransferShortcut(
	value: Readonly<{ readonly key?: unknown; readonly ctrlKey?: unknown; readonly shiftKey?: unknown }>,
	disabled = false,
): VideoKeyframeTransferShortcut {
	if (disabled || value.ctrlKey !== true || value.shiftKey !== true || typeof value.key !== 'string') return null;
	if (value.key.toLowerCase() === 'c') return 'copy';
	if (value.key.toLowerCase() === 'v') return 'paste';
	return null;
}
