/* SPDX-License-Identifier: AGPL-3.0-only */

const PREFERENCE_PAGES = new Set([
	'general',
	'appearance',
	'editing',
	'workspace',
	'panels',
	'shortcuts',
	'spectrogram',
	'sound-activation',
]);

/**
 * Audacity opens Preferences on its General page, and every page it lists is
 * reachable on every host. The desktop build adds one section to General — the
 * FFmpeg location — rather than a page of its own, so the host no longer
 * decides which pages exist.
 */
export function workspacePreferencesPage(requestedSection: unknown): string {
	if (typeof requestedSection === 'string' && PREFERENCE_PAGES.has(requestedSection)) {
		return requestedSection;
	}
	if (requestedSection === 'snap') return 'editing';
	return 'general';
}
