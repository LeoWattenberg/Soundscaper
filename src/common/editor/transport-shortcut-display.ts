/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pause uses the same context-sensitive key as Play, including during recording. */
export function transportShortcutDisplayActionId(actionId: string): string {
	return actionId === 'action://playback/pause' || actionId === 'action://record/pause'
		? 'action://playback/play'
		: actionId;
}
