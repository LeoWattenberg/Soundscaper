/* SPDX-License-Identifier: AGPL-3.0-only */

import { publishedTranslationOrigin, type ContributionSnapshot, type TranslationContribution } from '../../../i18n/community-translations.ts';

interface CommunityTranslationMessageOptions {
	readonly query: string;
	readonly filter: string;
	readonly reviewKeys: ReadonlySet<string>;
	readonly locale: string;
}

export function communityTranslationMessageKeys(
	snapshot: ContributionSnapshot,
	draft: TranslationContribution,
	{ query, filter, reviewKeys, locale }: CommunityTranslationMessageOptions,
	metadata: Readonly<Record<string, Readonly<{ bundledGerman?: string }>>>,
): readonly string[] {
	const needle = query.toLocaleLowerCase();
	const changedKeys = new Set(draft.entries.map(({ key }) => key));
	return [...new Set([...Object.keys(snapshot.entries), ...changedKeys])].sort().filter((key) => {
		const entry = snapshot.entries[key];
		const change = draft.entries.find((item) => item.key === key);
		if (filter === 'changed' && !changedKeys.has(key)) return false;
		if (filter === 'review' && !reviewKeys.has(key)) return false;
		if (filter === 'missing' && publishedTranslationOrigin(entry, locale === 'de'
			? metadata[key]?.bundledGerman : undefined) !== 'missing') return false;
		return [key, entry?.source, entry?.baselineText, change?.translation]
			.some((value) => value?.toLocaleLowerCase().includes(needle));
	});
}
