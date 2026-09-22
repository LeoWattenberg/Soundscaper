/* SPDX-License-Identifier: AGPL-3.0-only */

import { createImportedSourceProvenance } from '../../../source-provenance.ts';
import type { EditorProjectToken } from '../../shared/lifecycle.ts';
import type { ImportCompositionState } from './import-composition-types.ts';
import type { NormalizedProjectImportOptions, ProjectImportDestination } from './project-import-options.ts';

const DEFAULT_MAXIMUM_PREVIEW_BYTES = 128 * 1024 * 1024;
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const FREESOUND_SOUND_ID_PATTERN = /^[1-9][0-9]{0,15}$/u;
const FREESOUND_PREVIEW_MIME_TYPES: ReadonlySet<string> = new Set([
	'audio/ogg', 'application/ogg', 'audio/vorbis',
]);

export type FreesoundLicenseFilter = 'all' | 'cc0' | 'cc-by' | 'cc-by-nc';
export type FreesoundSearchSort = 'relevance' | 'newest' | 'rating' | 'downloads';
export type FreesoundLicenseCode = Exclude<FreesoundLicenseFilter, 'all'> | 'sampling-plus';

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
	readonly license: Readonly<{
		readonly code: FreesoundLicenseCode;
		readonly name: string;
		readonly url: string;
		readonly requiresAttribution: boolean;
		readonly commercialUseAllowed: boolean;
	}>;
	readonly generativeAiPreference: string | null;
	readonly explicit: boolean;
	readonly durationSeconds: number;
	readonly originalFile: Readonly<{
		readonly format: string;
		readonly channels: number;
		readonly byteLength: number;
		readonly sampleRate: number;
		readonly md5: string;
	}>;
	readonly statistics: Readonly<{
		readonly downloads: number;
		readonly averageRating: number;
		readonly ratingCount: number;
	}>;
	readonly preview: Readonly<{
		readonly available: boolean;
		readonly format: 'ogg';
		readonly quality: 'high';
		readonly approximateBitrateKbps: number;
	}>;
	readonly waveform: Readonly<{
		readonly available: boolean;
		readonly url: string | null;
	}>;
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

export interface FreesoundSearchRequest {
	readonly query: string;
	readonly page?: number;
	readonly license?: FreesoundLicenseFilter;
	readonly sort?: FreesoundSearchSort;
	readonly signal?: AbortSignal;
}

export interface FreesoundImportRequest {
	readonly soundId: number;
	readonly destination: ProjectImportDestination;
	readonly trackId?: string;
	readonly timelineStartFrame?: number;
	readonly signal?: AbortSignal;
}

export interface FreesoundImportServiceRuntime {
	readonly enabled: boolean;
	readonly fetch?: typeof fetch | undefined;
	readonly apiBaseUrl?: string | undefined;
	readonly createContributionId: (prefix: 'attribution') => string;
	readonly maximumPreviewBytes?: number;
	readonly admission?: { token: EditorProjectToken | null };
	readonly state?: Pick<ImportCompositionState, 'importing' | 'readOnly'>;
	readonly assertProject?: (token: EditorProjectToken) => void;
	readonly importFile: (
		file: File,
		options: Readonly<NormalizedProjectImportOptions> | Readonly<Record<string, unknown>>,
		assertProjectCurrent?: () => void,
	) => Promise<unknown>;
}

export function createFreesoundImportService(runtime: FreesoundImportServiceRuntime) {
	const maximumPreviewBytes = positiveInteger(runtime.maximumPreviewBytes ?? DEFAULT_MAXIMUM_PREVIEW_BYTES);
	const locationOrigin = globalThis.location?.origin;
	const apiBaseUrl = normalizeApiBaseUrl(runtime.apiBaseUrl ?? (
		locationOrigin?.startsWith('http://') || locationOrigin?.startsWith('https://')
			? locationOrigin : 'https://soundscaper.org'
	));
	const fetchRequest = runtime.fetch ?? globalThis.fetch.bind(globalThis);

	const requireEnabled = (): void => {
		if (!runtime.enabled) throw new Error('Freesound is unavailable for this product.');
	};

	const soundUrl = (soundId: number, suffix = ''): URL => {
		const id = normalizeSoundId(soundId);
		return new URL(`/api/freesound/sounds/${String(id)}${suffix}`, apiBaseUrl);
	};

	async function search(request: FreesoundSearchRequest): Promise<FreesoundSearchPage> {
		requireEnabled();
		const query = boundedString(request.query, 'Freesound query', 200);
		const page = request.page === undefined ? 1 : positiveInteger(request.page);
		const license = normalizeEnum(request.license ?? 'all', ['all', 'cc0', 'cc-by', 'cc-by-nc'], 'license');
		const sort = normalizeEnum(request.sort ?? 'relevance', ['relevance', 'newest', 'rating', 'downloads'], 'sort');
		const url = new URL('/api/freesound/search', apiBaseUrl);
		url.searchParams.set('q', query);
		url.searchParams.set('page', String(page));
		url.searchParams.set('license', license);
		url.searchParams.set('sort', sort);
		const value = await fetchJson(url, request.signal);
		return normalizeSearchPage(responseData(value));
	}

	async function getSound(soundId: number, signal?: AbortSignal): Promise<FreesoundSound> {
		requireEnabled();
		return normalizeSound(responseData(await fetchJson(soundUrl(soundId), signal)));
	}

	async function importSound(
		request: FreesoundImportRequest,
		admission: (() => void) | EditorProjectToken = () => undefined,
	): Promise<unknown> {
		requireEnabled();
		const assertProjectCurrent = typeof admission === 'function' ? admission : () => {
			request.signal?.throwIfAborted();
			if (runtime.admission?.token !== admission || !runtime.state?.importing) {
				throw new Error('Freesound import admission is no longer current.');
			}
			if (runtime.state.readOnly) throw new Error('The project became read-only during Freesound import.');
			try { runtime.assertProject?.(admission); }
			catch (error) { throw new Error('The project changed during Freesound import.', { cause: error }); }
		};
		assertProjectCurrent();
		const soundId = normalizeSoundId(request.soundId);
		const sound = await getSound(soundId, request.signal);
		assertProjectCurrent();
		if (!sound.preview.available) throw new Error('The selected Freesound sound has no HQ OGG preview.');
		const response = await fetchRequest(soundUrl(soundId, '/preview'), {
			method: 'GET', credentials: 'omit', redirect: 'error', signal: request.signal,
			headers: { Accept: 'audio/ogg' },
		});
		assertProjectCurrent();
		if (!response.ok) throw await responseError(response, 'Freesound preview download failed');
		const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
		if (!FREESOUND_PREVIEW_MIME_TYPES.has(contentType)) {
			throw new TypeError('The Freesound preview response was not OGG audio.');
		}
		const preview = await readCappedPreview(response, maximumPreviewBytes, request.signal);
		assertProjectCurrent();
		const fileName = oggFileName(sound.name, soundId);
		const file = new File([preview], fileName, { type: contentType, lastModified: 0 });
		const sourceProvenance = createImportedSourceProvenance({
			id: runtime.createContributionId('attribution'),
			origin: {
				kind: 'freesound',
				soundId,
				title: sound.name,
				soundUrl: sound.pageUrl,
				creator: sound.creator.username,
				creatorUrl: sound.creator.pageUrl,
				license: {
					family: sound.license.code,
					name: sound.license.name,
					url: sound.license.url,
				},
				importedVariant: 'preview-hq-ogg',
				originalFileName: fileName,
				mimeType: contentType,
			},
			metadata: { namespaces: { freesound: sound } },
		});
		return runtime.importFile(file, {
			destination: request.destination,
			trackId: request.trackId ?? null,
			timelineStartFrame: request.timelineStartFrame ?? 0,
			...(request.signal ? { signal: request.signal } : {}),
			sourceProvenance,
		}, assertProjectCurrent);
	}

	async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
		const response = await fetchRequest(url, {
			method: 'GET', credentials: 'omit', redirect: 'error', signal,
			headers: { Accept: 'application/json' },
		});
		if (!response.ok) throw await responseError(response, 'Freesound request failed');
		const declaredBytes = nullableNonNegativeInteger(response.headers.get('Content-Length'));
		if (declaredBytes !== null && declaredBytes > MAXIMUM_JSON_BYTES) {
			throw new RangeError('The Freesound response was too large.');
		}
		const text = await response.text();
		if (text.length > MAXIMUM_JSON_BYTES) throw new RangeError('The Freesound response was too large.');
		try { return JSON.parse(text) as unknown; }
		catch (error) { throw new SyntaxError('The Freesound response was not valid JSON.', { cause: error }); }
	}

	return Object.freeze({
		search,
		importSound,
	});

	async function responseError(response: Response, fallback: string): Promise<Error> {
		let message = fallback;
		try {
			const text = (await response.text()).slice(0, 8_192);
			const value = JSON.parse(text) as unknown;
			const record = dataRecord(value);
			const error = dataRecord(dataValue(record, 'error'));
			const upstreamMessage = dataValue(error, 'message');
			if (typeof upstreamMessage === 'string' && upstreamMessage) message = upstreamMessage;
		} catch {
			// The status remains authoritative when an error body is absent or malformed.
		}
		return new Error(`${message} (${String(response.status)}).`);
	}
}

async function readCappedPreview(
	response: Response,
	maximumBytes: number,
	signal?: AbortSignal,
): Promise<Blob> {
	const declaredBytes = nullableNonNegativeInteger(response.headers.get('Content-Length'));
	const reader = response.body?.getReader();
	const tooLarge = () => new RangeError('The Freesound preview is too large to import.');
	if (!reader) {
		if (declaredBytes !== null && declaredBytes > maximumBytes) throw tooLarge();
		return new Blob();
	}
	const chunks: ArrayBuffer[] = [];
	let byteLength = 0;
	try {
		if (declaredBytes !== null && declaredBytes > maximumBytes) throw tooLarge();
		for (;;) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			signal?.throwIfAborted();
			if (done) break;
			if (value.byteLength > maximumBytes - byteLength) throw tooLarge();
			const owned = new ArrayBuffer(value.byteLength);
			new Uint8Array(owned).set(value);
			chunks.push(owned);
			byteLength += owned.byteLength;
		}
	} catch (error) {
		try { await reader.cancel(error); }
		catch { /* Preserve the read, cancellation, or admission failure. */ }
		throw error;
	} finally {
		reader.releaseLock();
	}
	return new Blob(chunks);
}

function normalizeSearchPage(value: unknown): FreesoundSearchPage {
	const record = requiredRecord(value, 'Freesound search response');
	const results = dataValue(record, 'results');
	if (!Array.isArray(results) || results.length > 20) throw new TypeError('Invalid Freesound search results.');
	return Object.freeze({
		query: requiredString(dataValue(record, 'query'), 'query', 200),
		page: requiredPositiveInteger(dataValue(record, 'page'), 'page'),
		pageSize: requiredPositiveInteger(dataValue(record, 'pageSize'), 'pageSize'),
		totalCount: requiredNonNegativeInteger(dataValue(record, 'totalCount'), 'totalCount'),
		totalPages: requiredNonNegativeInteger(dataValue(record, 'totalPages'), 'totalPages'),
		hasNextPage: requiredBoolean(dataValue(record, 'hasNextPage'), 'hasNextPage'),
		hasPreviousPage: requiredBoolean(dataValue(record, 'hasPreviousPage'), 'hasPreviousPage'),
		results: Object.freeze(results.map(normalizeSound)),
	});
}

function normalizeSound(value: unknown): FreesoundSound {
	const record = requiredRecord(value, 'Freesound sound');
	const creator = requiredRecord(dataValue(record, 'creator'), 'Freesound creator');
	const license = requiredRecord(dataValue(record, 'license'), 'Freesound license');
	const originalFile = requiredRecord(dataValue(record, 'originalFile'), 'Freesound original file');
	const statistics = requiredRecord(dataValue(record, 'statistics'), 'Freesound statistics');
	const preview = requiredRecord(dataValue(record, 'preview'), 'Freesound preview');
	const id = requiredPositiveInteger(dataValue(record, 'id'), 'sound id');
	const waveform = normalizeWaveform(dataValue(record, 'waveform'), id);
	const pageUrl = requiredHttpsUrl(dataValue(record, 'pageUrl'), 'sound URL', 'freesound.org');
	const creatorPageUrl = requiredHttpsUrl(dataValue(creator, 'pageUrl'), 'creator URL', 'freesound.org');
	const licenseCode = normalizeEnum(
		dataValue(license, 'code'),
		['cc0', 'cc-by', 'cc-by-nc', 'sampling-plus'],
		'license code',
	);
	const licenseUrl = requiredHttpsUrl(dataValue(license, 'url'), 'license URL');
	const tags = dataValue(record, 'tags');
	if (!Array.isArray(tags) || tags.length > 200 || tags.some((tag) => typeof tag !== 'string' || tag.length > 256)) {
		throw new TypeError('Invalid Freesound tags.');
	}
	return Object.freeze({
		id,
		name: requiredString(dataValue(record, 'name'), 'sound name', 512),
		pageUrl,
		creator: Object.freeze({
			username: requiredString(dataValue(creator, 'username'), 'creator username', 256),
			pageUrl: creatorPageUrl,
		}),
		description: boundedString(dataValue(record, 'description'), 'description', 65_536),
		tags: Object.freeze([...tags] as string[]),
		category: nullableString(dataValue(record, 'category'), 'category', 512),
		subcategory: nullableString(dataValue(record, 'subcategory'), 'subcategory', 512),
		createdAt: requiredString(dataValue(record, 'createdAt'), 'createdAt', 128),
		license: Object.freeze({
			code: licenseCode,
			name: requiredString(dataValue(license, 'name'), 'license name', 256),
			url: licenseUrl,
			requiresAttribution: requiredBoolean(dataValue(license, 'requiresAttribution'), 'requiresAttribution'),
			commercialUseAllowed: requiredBoolean(dataValue(license, 'commercialUseAllowed'), 'commercialUseAllowed'),
		}),
		generativeAiPreference: nullableString(dataValue(record, 'generativeAiPreference'), 'generativeAiPreference', 512),
		explicit: requiredBoolean(dataValue(record, 'explicit'), 'explicit'),
		durationSeconds: requiredNonNegativeNumber(dataValue(record, 'durationSeconds'), 'durationSeconds'),
		originalFile: Object.freeze({
			format: requiredString(dataValue(originalFile, 'format'), 'original format', 64),
			channels: requiredPositiveInteger(dataValue(originalFile, 'channels'), 'original channels'),
			byteLength: requiredNonNegativeInteger(dataValue(originalFile, 'byteLength'), 'original byteLength'),
			sampleRate: requiredPositiveInteger(dataValue(originalFile, 'sampleRate'), 'original sampleRate'),
			md5: requiredString(dataValue(originalFile, 'md5'), 'original md5', 64),
		}),
		statistics: Object.freeze({
			downloads: requiredNonNegativeInteger(dataValue(statistics, 'downloads'), 'downloads'),
			averageRating: requiredNonNegativeNumber(dataValue(statistics, 'averageRating'), 'averageRating'),
			ratingCount: requiredNonNegativeInteger(dataValue(statistics, 'ratingCount'), 'ratingCount'),
		}),
		preview: Object.freeze({
			available: requiredBoolean(dataValue(preview, 'available'), 'preview available'),
			format: normalizeEnum(dataValue(preview, 'format'), ['ogg'], 'preview format'),
			quality: normalizeEnum(dataValue(preview, 'quality'), ['high'], 'preview quality'),
			approximateBitrateKbps: requiredPositiveInteger(
				dataValue(preview, 'approximateBitrateKbps'), 'preview bitrate',
			),
		}),
		waveform,
	});
}

function normalizeWaveform(value: unknown, soundId: number): FreesoundSound['waveform'] {
	if (value === undefined) return Object.freeze({ available: false, url: null });
	const waveform = requiredRecord(value, 'Freesound waveform');
	const available = requiredBoolean(dataValue(waveform, 'available'), 'waveform available');
	const urlValue = dataValue(waveform, 'url');
	if (!available) {
		if (urlValue !== null) throw new TypeError('Invalid Freesound waveform URL.');
		return Object.freeze({ available: false, url: null });
	}
	const url = requiredString(urlValue, 'Freesound waveform URL', 2_048);
	let parsed: URL;
	try { parsed = new URL(url, 'https://soundscaper.org'); }
	catch (error) { throw new TypeError('Invalid Freesound waveform URL.', { cause: error }); }
	if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\') || parsed.hash
		|| url !== parsed.pathname + parsed.search
		|| parsed.pathname !== `/api/freesound/sounds/${String(soundId)}/waveform`) {
		throw new TypeError('Invalid Freesound waveform URL.');
	}
	return Object.freeze({ available: true, url: parsed.pathname + parsed.search });
}

function normalizeSoundId(value: unknown): number {
	const text = String(value);
	if (!FREESOUND_SOUND_ID_PATTERN.test(text)) throw new TypeError('A valid Freesound sound ID is required.');
	const id = Number(text);
	if (!Number.isSafeInteger(id)) throw new RangeError('The Freesound sound ID is outside the supported range.');
	return id;
}

function normalizeApiBaseUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
		throw new TypeError('The Freesound API proxy base URL must use HTTPS.');
	}
	return url;
}

function oggFileName(value: string, soundId: number): string {
	const withoutControls = Array.from(value, (character) => (
		character.codePointAt(0)! < 32 ? '-' : character
	)).join('');
	const sanitized = withoutControls.replace(/[\\/:*?"<>]/gu, '-').trim().slice(0, 240);
	const base = sanitized || `freesound-${String(soundId)}`;
	return base.toLowerCase().endsWith('.ogg') ? base : `${base}.ogg`;
}

function responseData(value: unknown): unknown {
	return dataValue(requiredRecord(value, 'Freesound response envelope'), 'data');
}

function normalizeEnum<const Value extends string>(
	value: unknown,
	values: readonly Value[],
	name: string,
): Value {
	if (typeof value !== 'string' || !values.includes(value as Value)) throw new RangeError(`Invalid Freesound ${name}.`);
	return value as Value;
}

function boundedString(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	const normalized = value.trim();
	if (normalized.length > maximum) throw new RangeError(`${name} is too long.`);
	return normalized;
}

function requiredString(value: unknown, name: string, maximum: number): string {
	const normalized = boundedString(value, name, maximum);
	if (!normalized) throw new TypeError(`${name} is required.`);
	return normalized;
}

function nullableString(value: unknown, name: string, maximum: number): string | null {
	return value === null ? null : requiredString(value, name, maximum);
}

function positiveInteger(value: unknown): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError('A positive integer is required.');
	return number;
}

function requiredPositiveInteger(value: unknown, name: string): number {
	try { return positiveInteger(value); }
	catch (error) { throw new RangeError(`Invalid Freesound ${name}.`, { cause: error }); }
}

function requiredNonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`Invalid Freesound ${name}.`);
	return number;
}

function nullableNonNegativeInteger(value: unknown): number | null {
	if (value === null) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function requiredNonNegativeNumber(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`Invalid Freesound ${name}.`);
	return number;
}

function requiredBoolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`Invalid Freesound ${name}.`);
	return value;
}

function requiredHttpsUrl(value: unknown, name: string, hostname?: string): string {
	const url = new URL(requiredString(value, name, 2_048));
	if (url.protocol !== 'https:' || url.username || url.password || (hostname && url.hostname !== hostname)) {
		throw new TypeError(`Invalid Freesound ${name}.`);
	}
	return url.href;
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
	const record = dataRecord(value);
	if (!record) throw new TypeError(`${name} must be an object.`);
	return record;
}

function dataRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function dataValue(record: Record<string, unknown> | null, key: string): unknown {
	if (!record) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
