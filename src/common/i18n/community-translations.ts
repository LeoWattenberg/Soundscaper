/* SPDX-License-Identifier: AGPL-3.0-only */
import { COMMITTED_LOCALE_TAGS } from './locales.js';
import { normalizeBcp47Locale } from './locale.js';
import { acceptableTranslation } from './translation-catalog.js';
import { isTranslatableMessageKey } from './translation-scope.ts';

export type TranslationOrigin = 'machine' | 'audacity' | 'human';
export type TranslationCatalogEntry = readonly [TranslationOrigin, string, string];
export interface CommunityTranslationAttribution {
	readonly contributor?: string;
	readonly note?: string;
	readonly sourceOrigin: TranslationOrigin | 'bundled' | 'missing';
	readonly previousEntry: TranslationCatalogEntry | null;
	readonly upstreamProvenance?: Readonly<Record<string, unknown>>;
}
export interface ContributionBaseline {
	readonly key: string;
	readonly source: string;
	readonly baselineText: string;
	readonly baselineEntry: TranslationCatalogEntry | null;
}

/** Retired entries remain in the review baseline but no longer supply displayed text. */
export function publishedTranslationOrigin(
	baseline: ContributionBaseline | undefined, bundledTranslation?: string,
): TranslationOrigin | 'bundled' | 'missing' {
	const entry = baseline?.baselineEntry;
	if (entry && entry[1] === baseline?.source && entry[2] === baseline?.baselineText) return entry[0];
	return bundledTranslation !== undefined && baseline?.baselineText === bundledTranslation ? 'bundled' : 'missing';
}

export interface ContributionSnapshot {
	readonly version: 1;
	readonly locale: string;
	readonly snapshotId: string;
	readonly entries: Readonly<Record<string, ContributionBaseline>>;
	readonly upstreamNotices?: Readonly<Record<string, unknown>>;
	readonly community?: Readonly<Record<string, CommunityTranslationAttribution>>;
}
export interface ContributionEntry extends ContributionBaseline {
	readonly translation: string;
	readonly note?: string;
	readonly contributor?: string;
}
export interface TranslationContribution {
	readonly version: 1;
	readonly locale: string;
	readonly snapshotId: string;
	readonly contributor?: string;
	readonly entries: readonly ContributionEntry[];
}
export interface ContributionCatalog {
	readonly locale: string;
	readonly entries: Readonly<Record<string, TranslationCatalogEntry>>;
	readonly provenance?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly community?: Readonly<Record<string, CommunityTranslationAttribution>>;
}
export interface ContributionAssessment {
	readonly clean: readonly ContributionEntry[];
	readonly stale: readonly ContributionEntry[];
	readonly conflicts: readonly ContributionEntry[];
	readonly invalid: readonly ContributionEntry[];
}

export function assertCommunityLocale(locale: string): string {
	if (normalizeBcp47Locale(locale) !== locale || !COMMITTED_LOCALE_TAGS.includes(locale) || locale === 'en') {
		throw new TypeError('Choose an existing non-English application language.');
	}
	return locale;
}

/** Captures the published catalog before applying any local drafts. */
export function createContributionSnapshot(
	locale: string,
	englishCopy: Readonly<Record<string, string>>,
	publishedCopy: Readonly<Record<string, string>>,
	catalog: ContributionCatalog | null = null,
): ContributionSnapshot {
	assertCommunityLocale(locale);
	if (catalog && catalog.locale !== locale) throw new TypeError('Catalog language does not match the draft.');
	const entries = Object.fromEntries(Object.keys(englishCopy).filter(isTranslatableMessageKey).sort().map((key) => {
		const source = englishCopy[key]!;
		const tuple = catalog?.entries[key];
		const baselineEntry = tuple ? Object.freeze([...tuple]) as TranslationCatalogEntry : null;
		return [key, Object.freeze({ key, source, baselineText: publishedCopy[key] ?? source, baselineEntry })];
	}));
	const upstreamNotices = catalog?.provenance?.audacity;
	return Object.freeze({ version: 1, locale, snapshotId: crypto.randomUUID(), entries: Object.freeze(entries),
		...(upstreamNotices ? { upstreamNotices: freezeRecord(structuredClone(upstreamNotices)) } : {}),
		...(catalog?.community ? { community: freezeRecord(structuredClone(catalog.community)) as Readonly<Record<string, CommunityTranslationAttribution>> } : {}),
	});
}

export function createTranslationDraft(snapshot: ContributionSnapshot): TranslationContribution {
	return Object.freeze({ version: 1, locale: snapshot.locale, snapshotId: snapshot.snapshotId, entries: Object.freeze([]) });
}

export function updateTranslationDraft(
	draft: TranslationContribution,
	snapshot: ContributionSnapshot,
	key: string,
	translation: string,
	note?: string,
): TranslationContribution {
	if (draft.locale !== snapshot.locale) throw new TypeError('Draft language does not match the snapshot.');
	const baseline = snapshot.entries[key];
	if (!baseline) throw new ReferenceError(`Unknown translation key: ${key}`);
	const existing = draft.entries.find((entry) => entry.key === key);
	// Existing edits keep their original baseline even after the application updates.
	const original = existing ?? baseline;
	const entries = draft.entries.filter((entry) => entry.key !== key);
	if (translation !== original.baselineText) entries.push(Object.freeze({
		key, source: original.source, baselineText: original.baselineText,
		baselineEntry: original.baselineEntry, translation,
		...(note?.trim() ? { note: note.trim() } : {}),
		...(existing?.contributor !== undefined ? { contributor: existing.contributor } : {}),
	}));
	entries.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
	return Object.freeze({ ...draft, entries: Object.freeze(entries) });
}

export function parseTranslationContribution(input: unknown): TranslationContribution {
	const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
	const object = asObject(value);
	if (object.version !== 1) throw new TypeError('Unsupported community translation file version.');
	const locale = assertCommunityLocale(requiredString(object.locale, 'locale'));
	const snapshotId = requiredString(object.snapshotId, 'snapshotId');
	if (!Array.isArray(object.entries)) throw new TypeError('Translation entries must be an array.');
	const seen = new Set<string>();
	const entries = object.entries.map((raw: unknown): ContributionEntry => {
		const entry = asObject(raw);
		const baseline = parseBaseline(entry);
		if (seen.has(baseline.key)) throw new TypeError(`Duplicate translation key: ${baseline.key}`);
		seen.add(baseline.key);
		const translation = requiredString(entry.translation, 'translation', true);
		return Object.freeze({ ...baseline, translation, ...optionalText(entry, 'note'), ...optionalText(entry, 'contributor') });
	});
	return Object.freeze({ version: 1, locale, snapshotId, ...optionalText(object, 'contributor'), entries: Object.freeze(entries) });
}

export function parseContributionSnapshot(input: unknown): ContributionSnapshot {
	const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
	const object = asObject(value);
	if (object.version !== 1) throw new TypeError('Unsupported translation manifest version.');
	const locale = assertCommunityLocale(requiredString(object.locale, 'locale'));
	const snapshotId = requiredString(object.snapshotId, 'snapshotId');
	const entries = Object.fromEntries(Object.entries(asObject(object.entries)).map(([key, raw]) => {
		const baseline = parseBaseline(asObject(raw));
		if (baseline.key !== key) throw new TypeError('Manifest key does not match its entry.');
		return [key, baseline];
	}));
	return Object.freeze({ version: 1, locale, snapshotId, entries: Object.freeze(entries),
		...(object.upstreamNotices ? { upstreamNotices: freezeRecord(asObject(object.upstreamNotices)) } : {}),
		...(object.community ? { community: freezeRecord(asObject(object.community)) as Readonly<Record<string, CommunityTranslationAttribution>> } : {}),
	});
}

export function assessTranslationContribution(
	draft: TranslationContribution, snapshot: ContributionSnapshot,
): ContributionAssessment {
	if (draft.locale !== snapshot.locale) throw new TypeError('Draft language does not match the snapshot.');
	const clean: ContributionEntry[] = [];
	const stale: ContributionEntry[] = [];
	const conflicts: ContributionEntry[] = [];
	const invalid: ContributionEntry[] = [];
	for (const entry of draft.entries) {
		const current = snapshot.entries[entry.key];
		if (!isTranslatableMessageKey(entry.key)) invalid.push(entry);
		else if (!current || current.source !== entry.source) stale.push(entry);
		else if (!acceptableTranslation(entry.source, entry.translation)) invalid.push(entry);
		else if (current.baselineText !== entry.baselineText
			|| JSON.stringify(current.baselineEntry) !== JSON.stringify(entry.baselineEntry)) conflicts.push(entry);
		else if (entry.translation !== entry.baselineText) clean.push(entry);
	}
	return Object.freeze({ clean: Object.freeze(clean), stale: Object.freeze(stale), conflicts: Object.freeze(conflicts), invalid: Object.freeze(invalid) });
}

export function previewTranslationDraft(draft: TranslationContribution, snapshot: ContributionSnapshot): Readonly<Record<string, string>> {
	return Object.freeze(Object.fromEntries(assessTranslationContribution(draft, snapshot).clean.map((entry) => [entry.key, entry.translation])));
}

export function serializeTranslationContribution(draft: TranslationContribution): string {
	return `${JSON.stringify(parseTranslationContribution(draft), null, '\t')}\n`;
}

/** Imports are additive; conflicting local work is never overwritten implicitly. */
export function mergeTranslationContributions(existing: TranslationContribution, incoming: TranslationContribution): TranslationContribution {
	const left = parseTranslationContribution(existing);
	const right = parseTranslationContribution(incoming);
	if (left.locale !== right.locale) throw new TypeError('Imported translation language does not match the draft.');
	const entries = new Map(left.entries.map((entry) => [entry.key, creditTranslationEntry(entry, left.contributor)]));
	for (const raw of right.entries) {
		const entry = creditTranslationEntry(raw, right.contributor);
		const previous = entries.get(entry.key);
		if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new TypeError(`Imported translation conflicts with local draft: ${entry.key}`);
		entries.set(entry.key, entry);
	}
	return Object.freeze({ ...left, ...(right.contributor ? { contributor: right.contributor } : {}),
		entries: Object.freeze([...entries.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) });
}

function creditTranslationEntry(entry: ContributionEntry, fallback?: string): ContributionEntry {
	const contributor = entry.contributor ?? fallback;
	return contributor === undefined ? entry : Object.freeze({ ...entry, contributor });
}

function parseBaseline(entry: Record<string, unknown>): ContributionBaseline {
	const key = requiredString(entry.key, 'key');
	const source = requiredString(entry.source, 'source', true);
	const baselineText = requiredString(entry.baselineText, 'baselineText', true);
	const tuple = entry.baselineEntry;
	if (tuple !== null && (!Array.isArray(tuple) || tuple.length !== 3
		|| typeof tuple[0] !== 'string' || !['human', 'audacity', 'machine'].includes(tuple[0])
		|| typeof tuple[1] !== 'string' || typeof tuple[2] !== 'string')) {
		throw new TypeError('Translation baseline must contain an origin/source/text triple or null.');
	}
	const baselineEntry = tuple === null ? null : Object.freeze([...tuple as unknown[]]) as TranslationCatalogEntry;
	return Object.freeze({ key, source, baselineText, baselineEntry });
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Translation file must contain an object.');
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && !value)) throw new TypeError(`Translation ${label} must be a string.`);
	return value;
}

function optionalText(object: Record<string, unknown>, field: 'note' | 'contributor'): Partial<Record<typeof field, string>> {
	if (object[field] === undefined) return {};
	return { [field]: requiredString(object[field], field, true) };
}

function freezeRecord(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	for (const value of Object.values(record)) {
		if (value && typeof value === 'object') freezeRecord(value as Record<string, unknown>);
	}
	return Object.freeze(record);
}
