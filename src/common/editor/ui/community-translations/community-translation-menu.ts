/* SPDX-License-Identifier: AGPL-3.0-only */

export const COMMUNITY_TRANSLATIONS_REQUEST_EVENT = 'scape:community-translations-open';

export function createCommunityTranslationMenuItems(
	copy: Readonly<Record<string, string | undefined>>,
	productId: string,
) {
	return [Object.freeze({
		id: 'community-translations',
		label: copy['ui.communityTranslations.menu'] || 'Contribute translations',
		onClick: () => globalThis.dispatchEvent(new CustomEvent(COMMUNITY_TRANSLATIONS_REQUEST_EVENT, {
			detail: { productId },
		})),
	})];
}
