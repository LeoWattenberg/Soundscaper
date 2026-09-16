/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	assessTranslationContribution, type ContributionSnapshot, type TranslationContribution,
	type TranslationCatalogEntry, type CommunityTranslationAttribution,
} from '../src/common/i18n/community-translations.ts';

export interface CommunityWritableCatalog {
	readonly schemaVersion: number;
	readonly locale: string;
	readonly provenance: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly entries: Readonly<Record<string, TranslationCatalogEntry>>;
	readonly community?: Readonly<Record<string, CommunityTranslationAttribution>>;
}

/** A maintainer explicitly chooses reviewed keys; no conflict has an automatic winner. */
export function selectCommunityTranslations(
	contribution: TranslationContribution,
	snapshot: ContributionSnapshot,
	catalog: CommunityWritableCatalog | null,
	selectedKeys: readonly string[],
) {
	if (!selectedKeys.length) throw new TypeError('Applying translations requires an explicit non-empty --keys selection.');
	const clean = new Map(assessTranslationContribution(contribution, snapshot).clean.map((entry) => [entry.key, entry]));
	const entries = { ...catalog?.entries };
	const community = { ...catalog?.community };
	for (const key of new Set(selectedKeys)) {
		const entry = clean.get(key);
		if (!entry) throw new TypeError(`Translation ${key} is not a clean reviewed change.`);
		const previousEntry = entry.baselineEntry;
		const sourceOrigin = previousEntry?.[0] ?? (entry.baselineText === entry.source ? 'missing' : 'bundled');
		const upstreamProvenance = sourceOrigin === 'audacity'
			? catalog?.provenance.audacity : community[key]?.upstreamProvenance;
		const contributor = entry.contributor ?? contribution.contributor;
		community[key] = {
			sourceOrigin, previousEntry,
			...(contributor ? { contributor } : {}),
			...(entry.note ? { note: entry.note } : {}),
			...(upstreamProvenance ? { upstreamProvenance } : {}),
		};
		entries[key] = ['human', entry.source, entry.translation];
	}
	return { schemaVersion: 2, locale: contribution.locale, provenance: catalog?.provenance ?? {}, entries, community };
}
