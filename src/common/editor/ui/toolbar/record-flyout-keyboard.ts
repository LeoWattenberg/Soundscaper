/* SPDX-License-Identifier: AGPL-3.0-only */

interface RecordingSettingsNavigationEvent {
	readonly key: string;
	readonly defaultPrevented?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
}

/** Keep native settings navigation inside its containing recording flyout. */
export function recordingSettingsOwnNavigation(event: RecordingSettingsNavigationEvent): boolean {
	if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
	return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key);
}
