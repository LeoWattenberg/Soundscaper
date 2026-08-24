/* SPDX-License-Identifier: AGPL-3.0-only */

const SHARED_PREFERENCE_PAGES = new Set([
	'appearance',
	'editing',
	'workspace',
	'panels',
	'shortcuts',
	'spectrogram',
	'sound-activation',
]);

export function workspacePreferencesPage(
	requestedSection: unknown,
	isDesktop: boolean,
): string {
	if (requestedSection === 'general' && isDesktop) return 'general';
	if (typeof requestedSection === 'string' && SHARED_PREFERENCE_PAGES.has(requestedSection)) {
		return requestedSection;
	}
	if (requestedSection === 'snap') return 'editing';
	return isDesktop ? 'general' : 'shortcuts';
}
