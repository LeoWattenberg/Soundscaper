/* SPDX-License-Identifier: AGPL-3.0-only */

const PREFERENCE_PAGES = new Set([
	'general',
	'appearance',
	'audio',
	'playback-recording',
	'editing',
	'effects',
	'media',
	'workspace',
	'shortcuts',
	'spectrogram',
	'sound-activation',
]);

/**
 * Preferences opens on General. Desktop hosts also expose Media; native audio
 * and plugin configuration are reached through the Audio and Effects pages.
 */
export function workspacePreferencesPage(requestedSection: unknown): string {
	if (typeof requestedSection === 'string' && PREFERENCE_PAGES.has(requestedSection)) {
		return requestedSection;
	}
	if (requestedSection === 'snap') return 'editing';
	if (requestedSection === 'panels') return 'workspace';
	return 'general';
}
