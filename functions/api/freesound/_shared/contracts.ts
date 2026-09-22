/* SPDX-License-Identifier: AGPL-3.0-only */

export type FreesoundLicenseCode = 'cc0' | 'cc-by' | 'cc-by-nc' | 'sampling-plus';

export interface FreesoundLicense {
	readonly code: FreesoundLicenseCode;
	readonly name: string;
	readonly url: string;
	readonly requiresAttribution: boolean;
	readonly commercialUseAllowed: boolean;
}

export interface FreesoundSound {
	readonly id: number;
	readonly name: string;
	readonly pageUrl: string;
	readonly creator: Readonly<{ username: string; pageUrl: string }>;
	readonly description: string;
	readonly tags: readonly string[];
	readonly category: string | null;
	readonly subcategory: string | null;
	readonly createdAt: string;
	readonly license: FreesoundLicense;
	readonly generativeAiPreference: string | null;
	readonly explicit: boolean;
	readonly durationSeconds: number;
	readonly originalFile: Readonly<{
		format: string;
		channels: number;
		byteLength: number;
		sampleRate: number;
		md5: string;
	}>;
	readonly statistics: Readonly<{
		downloads: number;
		averageRating: number;
		ratingCount: number;
	}>;
	readonly preview: Readonly<{
		available: true;
		format: 'ogg';
		quality: 'high';
		approximateBitrateKbps: 192;
	}>;
}

export interface NormalizedFreesoundSound {
	readonly sound: FreesoundSound;
	/** Trusted internal fetch target. This value must never enter a public JSON response. */
	readonly previewUrl: URL;
}

export interface FreesoundSearchPage {
	readonly query: string;
	readonly page: number;
	readonly pageSize: number;
	readonly totalCount: number;
	readonly totalPages: number;
	readonly hasNextPage: boolean;
	readonly hasPreviousPage: boolean;
	readonly results: readonly FreesoundSound[];
}

export class FreesoundContractError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'FreesoundContractError';
	}
}

const LICENSES: Readonly<Record<string, FreesoundLicense>> = Object.freeze({
	'creative commons 0': Object.freeze({
		code: 'cc0',
		name: 'Creative Commons 0',
		url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false,
		commercialUseAllowed: true,
	}),
	attribution: Object.freeze({
		code: 'cc-by',
		name: 'Attribution',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		requiresAttribution: true,
		commercialUseAllowed: true,
	}),
	'attribution noncommercial': Object.freeze({
		code: 'cc-by-nc',
		name: 'Attribution NonCommercial',
		url: 'https://creativecommons.org/licenses/by-nc/4.0/',
		requiresAttribution: true,
		commercialUseAllowed: false,
	}),
	'sampling+': Object.freeze({
		code: 'sampling-plus',
		name: 'Sampling+ 1.0',
		url: 'https://creativecommons.org/licenses/sampling+/1.0/',
		requiresAttribution: true,
		commercialUseAllowed: false,
	}),
});

// Freesound's API serializes license.deed_url, including HTTP and historical 3.0 deeds.
const LICENSE_DEEDS: Readonly<Record<string, Readonly<{ base: string; version?: string }>>> = Object.freeze({
	'https://creativecommons.org/publicdomain/zero/1.0/': { base: 'creative commons 0' },
	'https://creativecommons.org/licenses/by/3.0/': { base: 'attribution', version: '3.0' },
	'https://creativecommons.org/licenses/by/4.0/': { base: 'attribution', version: '4.0' },
	'https://creativecommons.org/licenses/by-nc/3.0/': { base: 'attribution noncommercial', version: '3.0' },
	'https://creativecommons.org/licenses/by-nc/4.0/': { base: 'attribution noncommercial', version: '4.0' },
	'https://creativecommons.org/licenses/sampling+/1.0/': { base: 'sampling+' },
});

const ORIGINAL_FORMATS = new Set(['wav', 'aif', 'aiff', 'ogg', 'mp3', 'm4a', 'flac']);
const PREVIEW_HOST = 'cdn.freesound.org';
const MAX_SAFE_API_INTEGER = Number.MAX_SAFE_INTEGER;

export function normalizeFreesoundLicense(value: unknown): FreesoundLicense {
	const label = boundedString(value, 'license', 80).trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
	const license = LICENSES[label];
	if (license !== undefined) return license;
	const canonical = label.replace(/^http:/u, 'https:');
	const deed = LICENSE_DEEDS[canonical];
	const base = deed === undefined ? undefined : LICENSES[deed.base];
	if (base === undefined) throw new FreesoundContractError(`Freesound returned an unsupported license: ${label}.`);
	return {
		...base,
		name: deed?.version === undefined ? base.name : `${base.name} ${deed.version}`,
		url: canonical,
	};
}

export function normalizeFreesoundSound(value: unknown): NormalizedFreesoundSound {
	const source = record(value, 'sound');
	const id = integer(source.id, 'sound.id', 1, MAX_SAFE_API_INTEGER);
	const username = boundedString(source.username, 'sound.username', 128);
	const format = boundedString(source.type, 'sound.type', 16).toLocaleLowerCase('en-US');
	if (!ORIGINAL_FORMATS.has(format)) {
		throw new FreesoundContractError(`Freesound returned an unsupported sound.type: ${format}.`);
	}
	const previews = record(source.previews, 'sound.previews');
	const previewUrl = trustedPreviewUrl(previews['preview-hq-ogg']);
	const md5 = boundedString(source.md5, 'sound.md5', 32).toLocaleLowerCase('en-US');
	if (!/^[a-f0-9]{32}$/u.test(md5)) throw new FreesoundContractError('Freesound returned an invalid sound.md5.');

	return {
		sound: {
			id,
			name: boundedString(source.name, 'sound.name', 512),
			pageUrl: `https://freesound.org/s/${String(id)}/`,
			creator: {
				username,
				pageUrl: `https://freesound.org/people/${encodeURIComponent(username)}/`,
			},
			description: boundedString(source.description, 'sound.description', 65_536, true),
			tags: stringArray(source.tags, 'sound.tags', 200, 128),
			category: nullableString(source.category, 'sound.category', 256),
			subcategory: nullableString(source.subcategory, 'sound.subcategory', 256),
			createdAt: dateString(source.created, 'sound.created'),
			license: normalizeFreesoundLicense(source.license),
			generativeAiPreference: nullableString(
				source.gen_ai_preference,
				'sound.gen_ai_preference',
				80,
			),
			explicit: boolean(source.is_explicit, 'sound.is_explicit'),
			durationSeconds: finiteNumber(source.duration, 'sound.duration', 0, 86_400),
			originalFile: {
				format,
				channels: integer(source.channels, 'sound.channels', 1, 64),
				byteLength: integer(source.filesize, 'sound.filesize', 0, MAX_SAFE_API_INTEGER),
				sampleRate: integer(source.samplerate, 'sound.samplerate', 1_000, 768_000),
				md5,
			},
			statistics: {
				downloads: integer(source.num_downloads, 'sound.num_downloads', 0, MAX_SAFE_API_INTEGER),
				averageRating: finiteNumber(source.avg_rating, 'sound.avg_rating', 0, 5),
				ratingCount: integer(source.num_ratings, 'sound.num_ratings', 0, MAX_SAFE_API_INTEGER),
			},
			preview: {
				available: true,
				format: 'ogg',
				quality: 'high',
				approximateBitrateKbps: 192,
			},
		},
		previewUrl,
	};
}

export function normalizeFreesoundSearch(
	value: unknown,
	request: Readonly<{ query: string; page: number; pageSize: number }>,
): FreesoundSearchPage {
	const source = record(value, 'search response');
	const totalCount = integer(source.count, 'search response.count', 0, MAX_SAFE_API_INTEGER);
	if (!Array.isArray(source.results)) {
		throw new FreesoundContractError('Freesound search response.results must be an array.');
	}
	if (source.results.length > request.pageSize) {
		throw new FreesoundContractError('Freesound search results exceed the requested page size.');
	}
	const results = source.results.map((result) => normalizeFreesoundSound(result).sound);
	if (results.length > totalCount) {
		throw new FreesoundContractError('Freesound search results exceed the reported result count.');
	}
	const totalPages = Math.ceil(totalCount / request.pageSize);
	return {
		query: request.query,
		page: request.page,
		pageSize: request.pageSize,
		totalCount,
		totalPages,
		hasNextPage: request.page < totalPages,
		hasPreviousPage: request.page > 1 && totalCount > 0,
		results,
	};
}

function trustedPreviewUrl(value: unknown): URL {
	const raw = boundedString(value, 'sound preview URL', 2_048);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new FreesoundContractError('Freesound returned an invalid preview URL.');
	}
	if (
		url.protocol !== 'https:'
		|| url.hostname !== PREVIEW_HOST
		|| url.port !== ''
		|| !url.pathname.startsWith('/previews/')
		|| !url.pathname.endsWith('.ogg')
		|| url.username !== ''
		|| url.password !== ''
		|| url.hash !== ''
	) {
		throw new FreesoundContractError('Freesound returned an untrusted preview URL.');
	}
	return url;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new FreesoundContractError(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)) {
		throw new FreesoundContractError(`${label} must be a bounded string.`);
	}
	return value;
}

function nullableString(value: unknown, label: string, maximum: number): string | null {
	return value === null ? null : boundedString(value, label, maximum, true);
}

function stringArray(value: unknown, label: string, maximumItems: number, maximumLength: number): string[] {
	if (!Array.isArray(value) || value.length > maximumItems) {
		throw new FreesoundContractError(`${label} must be a bounded string array.`);
	}
	return value.map((item, index) => boundedString(item, `${label}[${String(index)}]`, maximumLength));
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new FreesoundContractError(`${label} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
	const number = finiteNumber(value, label, minimum, maximum);
	if (!Number.isInteger(number)) throw new FreesoundContractError(`${label} must be an integer.`);
	return number;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new FreesoundContractError(`${label} must be a boolean.`);
	return value;
}

function dateString(value: unknown, label: string): string {
	const date = boundedString(value, label, 64);
	if (!Number.isFinite(Date.parse(date))) throw new FreesoundContractError(`${label} must be a date string.`);
	return date;
}
