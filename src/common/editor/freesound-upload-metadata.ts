/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeSourceProvenance,
	type FreesoundLicenseFamily,
	type SourceMetadataValue,
	type SourceProvenanceV1,
} from './source-provenance.ts';

export type FreesoundUploadLicense = 'cc0' | 'cc-by' | 'cc-by-nc';

export interface FreesoundBroadSoundTaxonomyEntry {
	readonly id: string;
	readonly category: string;
	readonly subcategory: string;
}

export const FREESOUND_BROAD_SOUND_TAXONOMY: readonly FreesoundBroadSoundTaxonomyEntry[] = Object.freeze([
	...taxonomy('Music', [['m-sp', 'Solo percussion'], ['m-si', 'Solo instrument'],
		['m-m', 'Multiple instruments'], ['m-other', 'Other']]),
	...taxonomy('Instrument samples', [['is-p', 'Percussion'], ['is-s', 'String'], ['is-w', 'Wind'],
		['is-k', 'Piano / Keyboard instruments'], ['is-e', 'Synths / Electronic'], ['is-other', 'Other']]),
	...taxonomy('Speech', [['sp-s', 'Solo speech'], ['sp-c', 'Conversation / Crowd'],
		['sp-p', 'Processed / Synthetic'], ['sp-other', 'Other']]),
	...taxonomy('Sound effects', [['fx-o', 'Objects / House appliances'], ['fx-v', 'Vehicles'],
		['fx-m', 'Other mechanisms, engines, machines'], ['fx-h', 'Human sounds and actions'],
		['fx-a', 'Animals'], ['fx-n', 'Natural elements and explosions'], ['fx-ex', 'Experimental'],
		['fx-el', 'Electronic / Design'], ['fx-other', 'Other']]),
	...taxonomy('Soundscapes', [['ss-n', 'Nature'], ['ss-i', 'Indoors'], ['ss-u', 'Urban'],
		['ss-s', 'Synthetic / Artificial'], ['ss-other', 'Other']]),
]);

const TAXONOMY_IDS = new Set(FREESOUND_BROAD_SOUND_TAXONOMY.map(({ id }) => id));
const LICENSES: readonly FreesoundUploadLicense[] = Object.freeze(['cc0', 'cc-by', 'cc-by-nc']);
const DESCRIPTION_LIMIT = 65_536;
const DEFAULT_DESCRIPTION_LIMIT = 60_000;

export interface FreesoundUploadLicenseAnalysis {
	readonly allowedLicenses: readonly FreesoundUploadLicense[];
	readonly defaultLicense: FreesoundUploadLicense;
	readonly attributionText: string;
	readonly blockedReason: string | null;
	readonly requiresRightsConfirmation: boolean;
}

export interface FreesoundUploadSourceMetadata {
	readonly name?: string;
	readonly mimeType?: string;
	readonly sampleRate?: number;
	readonly channelCount?: number;
	readonly frameCount?: number;
	readonly provenance?: SourceProvenanceV1;
}

export interface FreesoundUploadClipMetadata {
	readonly title?: string;
	readonly durationFrames?: number;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly reversed?: boolean;
	readonly inverted?: boolean;
	readonly pitchCents?: number;
	readonly speedRatio?: number;
	readonly warpMap?: unknown;
}

export interface FreesoundUploadMetadataDefaults {
	readonly title: string;
	readonly description: string;
	readonly tags: readonly string[];
	readonly license: FreesoundUploadLicense;
	readonly defaultLicense: FreesoundUploadLicense;
	readonly allowedLicenses: readonly FreesoundUploadLicense[];
	readonly attributionText: string;
	readonly blockedReason: string | null;
	readonly requiresRightsConfirmation: boolean;
}

export interface FreesoundUploadMetadataInput {
	readonly title: string;
	readonly description: string;
	readonly tags: readonly string[];
	readonly categoryId: string;
	readonly license: FreesoundUploadLicense;
	readonly rightsConfirmed?: boolean;
}

export function createFreesoundUploadMetadataDefaults(input: Readonly<{
	readonly fileName: string;
	readonly clip?: FreesoundUploadClipMetadata;
	readonly source?: FreesoundUploadSourceMetadata;
}>): FreesoundUploadMetadataDefaults {
	const source = input.source;
	const provenance = source?.provenance ? normalizeSourceProvenance(source.provenance) : undefined;
	const licenseAnalysis = analyzeFreesoundUploadLicenses(
		provenance ? [provenance] : [],
		{ hasUnknownRights: !provenance },
	);
	const title = boundedTitle(input.clip?.title) || boundedTitle(fileStem(input.fileName)) || 'Untitled sound';
	const metadata = provenance ? metadataLines(provenance) : [];
	const tags = provenance ? metadataTags(provenance) : [];
	const lines = [
		...(source?.name ? [`Source: ${singleLine(source.name)}`] : []),
		...technicalLines(source, input.clip),
		...recordingDeviceLines(provenance),
		...(metadata.length ? ['', 'Source metadata:', ...metadata] : []),
		...clipEditLines(input.clip),
	];
	const description = lines.join('\n').trim().slice(0, DEFAULT_DESCRIPTION_LIMIT);
	return Object.freeze({
		title,
		description,
		tags: Object.freeze(tags),
		license: licenseAnalysis.defaultLicense,
		defaultLicense: licenseAnalysis.defaultLicense,
		allowedLicenses: licenseAnalysis.allowedLicenses,
		attributionText: licenseAnalysis.attributionText,
		blockedReason: licenseAnalysis.blockedReason,
		requiresRightsConfirmation: licenseAnalysis.requiresRightsConfirmation,
	});
}

export function analyzeFreesoundUploadLicenses(
	values: readonly SourceProvenanceV1[],
	options: Readonly<{ readonly hasUnknownRights?: boolean }> = {},
): FreesoundUploadLicenseAnalysis {
	let carriesBy = false;
	let carriesNonCommercial = false;
	let blockedReason: string | null = null;
	let requiresRightsConfirmation = options.hasUnknownRights === true;
	const attributions: string[] = [];
	const seenSounds = new Set<number>();
	for (const [index, value] of values.entries()) {
		const provenance = normalizeSourceProvenance(value, `upload provenance[${String(index)}]`);
		for (const contribution of provenance.contributions) {
			if (contribution.origin.kind === 'local-file') {
				requiresRightsConfirmation = true;
				continue;
			}
			const { origin } = contribution;
			switch (origin.license.family) {
				case 'sampling-plus':
					blockedReason ??= 'Freesound Sampling+ material cannot be republished through this workflow.';
					break;
				case 'cc-by-nc': carriesNonCommercial = true; break;
				case 'cc-by': carriesBy = true; break;
				case 'cc0': break;
			}
			if (origin.license.family !== 'cc0' && !seenSounds.has(origin.soundId)) {
				seenSounds.add(origin.soundId);
				attributions.push(freesoundAttribution(origin));
			}
		}
	}
	const allowedLicenses: readonly FreesoundUploadLicense[] = carriesNonCommercial
		? Object.freeze(['cc-by-nc'])
		: carriesBy ? Object.freeze(['cc-by']) : LICENSES;
	return Object.freeze({
		allowedLicenses,
		defaultLicense: carriesNonCommercial ? 'cc-by-nc' : 'cc-by',
		attributionText: attributions.join('\n'),
		blockedReason,
		requiresRightsConfirmation,
	});
}

export function composeFreesoundUploadDescription(
	value: string,
	analysis: Pick<FreesoundUploadLicenseAnalysis, 'attributionText'>,
): string {
	const description = requiredString(value, 'description', DESCRIPTION_LIMIT).trim();
	const attribution = analysis.attributionText.trim();
	if (!attribution) return description;
	const suffix = `\n\nRequired attribution:\n${attribution}`;
	if (description.length + suffix.length > DESCRIPTION_LIMIT) {
		throw new RangeError('Freesound description and required attribution exceed 65,536 characters.');
	}
	return `${description}${suffix}`;
}

export function validateFreesoundUploadMetadata(
	value: FreesoundUploadMetadataInput,
	options: Readonly<{
		readonly licenseAnalysis?: FreesoundUploadLicenseAnalysis;
		readonly requiresRightsConfirmation?: boolean;
	}> = {},
): Readonly<FreesoundUploadMetadataInput> {
	const record = closedMetadataRecord(value);
	const title = requiredString(record.title, 'title', 512).trim();
	const analysis = options.licenseAnalysis;
	if (analysis?.blockedReason) throw new RangeError(analysis.blockedReason);
	const description = composeFreesoundUploadDescription(
		requiredString(record.description, 'description', DESCRIPTION_LIMIT),
		analysis ?? { attributionText: '' },
	);
	if (!Array.isArray(record.tags)) throw new TypeError('Freesound tags must be an array.');
	const tags = record.tags.map((tag, index) => requiredString(tag, `tag ${String(index + 1)}`, 64).trim());
	if (tags.some((tag) => !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag))) {
		throw new RangeError('Freesound tags may contain letters, numbers, underscores, and hyphens.');
	}
	const folded = tags.map((tag) => tag.toLocaleLowerCase('en-US'));
	if (new Set(folded).size !== tags.length) throw new RangeError('Freesound tags must be unique.');
	if (tags.length < 3) throw new RangeError('Freesound publishing requires at least 3 tags.');
	if (tags.length > 30) throw new RangeError('Freesound publishing accepts at most 30 tags.');
	if (tags.join(' ').length > 512) throw new RangeError('Freesound tags exceed the 512-character limit.');
	const categoryId = requiredString(record.categoryId, 'category', 32).trim();
	if (!TAXONOMY_IDS.has(categoryId)) throw new RangeError('A valid Freesound category is required.');
	if (!LICENSES.includes(record.license as FreesoundUploadLicense)) {
		throw new RangeError('A valid Freesound license is required.');
	}
	const license = record.license as FreesoundUploadLicense;
	if (analysis && !analysis.allowedLicenses.includes(license)) {
		throw new RangeError('The selected Freesound license is incompatible with the source material.');
	}
	const requiresRights = options.requiresRightsConfirmation ?? analysis?.requiresRightsConfirmation ?? false;
	if (requiresRights && record.rightsConfirmed !== true) {
		throw new RangeError('You must confirm that you have the rights to publish this sound.');
	}
	return Object.freeze({
		title,
		description,
		tags: Object.freeze(tags),
		categoryId,
		license,
		...(record.rightsConfirmed === true ? { rightsConfirmed: true } : {}),
	});
}

function metadataLines(provenance: SourceProvenanceV1): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const contribution of provenance.contributions) {
		for (const metadata of [contribution.metadata.normalized, contribution.metadata.raw]) {
			collectMetadataLines(metadata, [], lines, seen);
		}
	}
	return lines.slice(0, 128);
}

function collectMetadataLines(
	value: SourceMetadataValue,
	path: readonly string[],
	lines: string[],
	seen: Set<string>,
): void {
	if (lines.length >= 128) return;
	if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		const key = path.at(-1) ?? '';
		if (!key || sensitiveMetadataKey(key)) return;
		const text = singleLine(String(value));
		if (!text || sensitiveMetadataValue(text)) return;
		const line = `${metadataLabel(key)}: ${text}`;
		const folded = line.toLocaleLowerCase('en-US');
		if (!seen.has(folded)) { seen.add(folded); lines.push(line.slice(0, 1_024)); }
		return;
	}
	if (Array.isArray(value)) {
		if (value.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))) {
			collectMetadataLines(value.map(String).join(', '), path, lines, seen);
			return;
		}
		for (const entry of value) collectMetadataLines(entry, path, lines, seen);
		return;
	}
	for (const [key, entry] of Object.entries(value)) collectMetadataLines(entry, [...path, key], lines, seen);
}

function metadataTags(provenance: SourceProvenanceV1): string[] {
	const tags: string[] = [];
	for (const contribution of provenance.contributions) {
		for (const metadata of [contribution.metadata.normalized, contribution.metadata.raw, contribution.metadata.namespaces]) {
			collectTags(metadata, '', tags);
		}
	}
	return [...new Map(tags.map((tag) => [tag.toLocaleLowerCase('en-US'), tag])).values()].slice(0, 30);
}

function collectTags(value: SourceMetadataValue, key: string, tags: string[]): void {
	if (tags.length >= 30) return;
	if (key.toLocaleLowerCase('en-US') === 'tags' && Array.isArray(value)) {
		for (const tag of value) {
			if (typeof tag !== 'string') continue;
			const normalized = normalizeFreesoundUploadTag(tag);
			if (normalized) tags.push(normalized);
		}
		return;
	}
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		for (const [childKey, child] of Object.entries(value)) collectTags(child, childKey, tags);
	}
}

function technicalLines(
	source: FreesoundUploadSourceMetadata | undefined,
	clip: FreesoundUploadClipMetadata | undefined,
): string[] {
	if (!source) return [];
	const sampleRate = positiveFinite(source.sampleRate);
	const channels = positiveInteger(source.channelCount);
	const frames = positiveInteger(clip?.durationFrames) ?? positiveInteger(source.frameCount);
	const details = [
		...(sampleRate ? [`${sampleRate.toLocaleString('en-US')} Hz`] : []),
		...(channels ? [`${String(channels)} ${channels === 1 ? 'channel' : 'channels'}`] : []),
		...(frames && sampleRate ? [`${(frames / sampleRate).toFixed(3)} seconds`] : []),
	];
	return [
		...(source.mimeType ? [`Format: ${singleLine(source.mimeType)}`] : []),
		...(details.length ? [`Audio: ${details.join(', ')}`] : []),
	];
}

function recordingDeviceLines(provenance: SourceProvenanceV1 | undefined): string[] {
	const labels = provenance?.extensions?.soundscaper.recordingDeviceLabels ?? [];
	return labels.length ? [`Recording device: ${labels.map(singleLine).join(', ')}`] : [];
}

function clipEditLines(clip: FreesoundUploadClipMetadata | undefined): string[] {
	if (!clip) return [];
	const edits = [
		...(clip.gain !== undefined && clip.gain !== 1 ? [`Gain: ${String(clip.gain)}`] : []),
		...(positiveInteger(clip.fadeInFrames) ? [`Fade in: ${String(clip.fadeInFrames)} frames`] : []),
		...(positiveInteger(clip.fadeOutFrames) ? [`Fade out: ${String(clip.fadeOutFrames)} frames`] : []),
		...(clip.reversed ? ['Reversed'] : []),
		...(clip.inverted ? ['Phase inverted'] : []),
		...(clip.pitchCents ? [`Pitch: ${String(clip.pitchCents)} cents`] : []),
		...(clip.speedRatio !== undefined && clip.speedRatio !== 1 ? [`Speed ratio: ${String(clip.speedRatio)}`] : []),
		...(clip.warpMap ? ['Warp map applied'] : []),
	];
	return edits.length ? ['', 'Applied clip edits:', ...edits.map((edit) => `- ${edit}`)] : [];
}

function freesoundAttribution(origin: Readonly<{
	readonly title?: string;
	readonly creator: string;
	readonly soundId: number;
	readonly soundUrl: string;
	readonly license: Readonly<{ readonly family: FreesoundLicenseFamily; readonly name: string; readonly url: string }>;
}>): string {
	const title = origin.title ? `“${singleLine(origin.title)}”` : `Freesound sound ${String(origin.soundId)}`;
	return `- ${title} by ${singleLine(origin.creator)} (${origin.soundUrl}), licensed ${licenseLabel(origin.license.family, origin.license.name)} (${origin.license.url}).`;
}

function licenseLabel(family: FreesoundLicenseFamily, fallback: string): string {
	return Object.freeze({ cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-nc': 'CC BY-NC',
		'sampling-plus': 'Sampling+' })[family] || fallback;
}

function sensitiveMetadataKey(value: string): boolean {
	const words = value.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1-$2').toLocaleLowerCase('en-US');
	return /(?:^|[-_])(id|identifier|uuid|hash|digest|checksum|token|secret|key|password|credential|path|directory|url|uri|href)(?:$|[-_])/u.test(words)
		|| /(?:private|internal|binary|picture|artwork)/u.test(words);
}

function sensitiveMetadataValue(value: string): boolean {
	return /(?:https?|file|data):\/\//iu.test(value)
		|| /^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/])/u.test(value)
		|| /^[\da-f]{32,}$/iu.test(value);
}

export function normalizeFreesoundUploadTag(value: string): string {
	const replaced = value.normalize('NFKC').trim()
		.replace(/[^\p{L}\p{N}_-]+/gu, '-')
		.replace(/^[-_]+|[-_]+$/gu, '');
	const bounded = Array.from(replaced).slice(0, 64).join('').replace(/[-_]+$/gu, '');
	return /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(bounded) ? bounded : '';
}

function metadataLabel(value: string): string {
	const labels: Readonly<Record<string, string>> = Object.freeze({ artist: 'Artist', title: 'Title', album: 'Album', comment: 'Comment',
		description: 'Description', genre: 'Genre', date: 'Date', copyright: 'Copyright',
		IART: 'Artist', INAM: 'Title', ICMT: 'Comment', IGNR: 'Genre', ICRD: 'Date' });
	return labels[value]
		?? value.replace(/[_-]+/gu, ' ').replace(/^./u, (letter) => letter.toLocaleUpperCase('en-US'));
}

function taxonomy(
	category: string,
	values: readonly (readonly [id: string, subcategory: string])[],
): FreesoundBroadSoundTaxonomyEntry[] {
	return values.map(([id, subcategory]) => Object.freeze({ id, category, subcategory }));
}

function closedMetadataRecord(value: FreesoundUploadMetadataInput): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Freesound metadata is required.');
	const allowed = new Set(['title', 'description', 'tags', 'categoryId', 'license', 'rightsConfirmed']);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new TypeError(`Freesound metadata field ${key} is not supported.`);
	}
	return value as unknown as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Freesound ${name} is required.`);
	if (value.length > maximum) throw new RangeError(`Freesound ${name} exceeds ${String(maximum)} characters.`);
	return value;
}

function boundedTitle(value: unknown): string {
	return typeof value === 'string' ? singleLine(value).slice(0, 512) : '';
}

function fileStem(value: string): string {
	const name = value.replace(/\\/gu, '/').split('/').at(-1) ?? '';
	return name.replace(/\.[^.]+$/u, '');
}

function singleLine(value: string): string {
	return Array.from(value, (character) => {
		const code = character.codePointAt(0)!;
		return code < 32 || code === 127 ? ' ' : character;
	}).join('').replace(/\s+/gu, ' ').trim();
}

function positiveInteger(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function positiveFinite(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
