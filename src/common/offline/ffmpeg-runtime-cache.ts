/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	FFMPEG_RUNTIME_POINTER_URL,
	FFMPEG_RUNTIME_FILES,
	FFMPEG_RUNTIME_PUBLIC_ORIGIN,
	FFMPEG_RUNTIME_PUBLIC_PREFIX,
	FFMPEG_RUNTIME_RELEASE_SEGMENT,
} from './ffmpeg-runtime-public-policy.ts';

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const RUNTIME_FILE_NAMES = Object.freeze(FFMPEG_RUNTIME_FILES.map(({ name }) => name));
const JAVASCRIPT_RUNTIME_CONTENT_TYPE = FFMPEG_RUNTIME_FILES[0]!.contentType;
const JAVASCRIPT_RUNTIME_MEDIA_TYPE = JAVASCRIPT_RUNTIME_CONTENT_TYPE.split(';', 1)[0]!;
const MAXIMUM_POINTER_BYTES = 64 * 1024;
const MAXIMUM_MANIFEST_BYTES = 512 * 1024;
const MAXIMUM_RUNTIME_FILE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_RUNTIME_RELEASE_BYTES = 65 * 1024 * 1024;
const MAXIMUM_STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

export interface VerifiedRuntimeFile {
	readonly name: string;
	readonly url: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly contentType: string;
}

export interface VerifiedRuntimeRelease {
	readonly schemaVersion: 1;
	readonly releaseId: string;
	readonly manifestSha256: string;
	readonly baseUrl: string;
	readonly files: readonly VerifiedRuntimeFile[];
}

export interface VerifiedRuntimeTransaction {
	put(file: VerifiedRuntimeFile, response: Response): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export interface VerifiedRuntimeStore {
	readActive(): Promise<VerifiedRuntimeRelease | null>;
	begin(release: VerifiedRuntimeRelease): Promise<VerifiedRuntimeTransaction>;
}

export interface InstallLatestFfmpegRuntimeOptions {
	readonly pointerUrl: string | URL;
	readonly store: VerifiedRuntimeStore;
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Readonly<{
		completedBytes: number;
		totalBytes: number;
	}>) => void;
}

export interface InstallLatestFfmpegRuntimeResult {
	readonly status: 'current' | 'installed';
	readonly release: VerifiedRuntimeRelease;
}

interface RuntimeDescriptor {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface RuntimePointer {
	readonly schemaVersion: 1;
	readonly releaseId: string;
	readonly manifest: RuntimeDescriptor;
	readonly files: Readonly<Record<string, RuntimeDescriptor>>;
}

/**
 * Downloads one content-addressed FFmpeg release into a candidate transaction.
 * The active store entry is committed only after the manifest and every
 * streamed runtime body match their exact SHA-256 and byte-length descriptors.
 */
export async function installLatestFfmpegRuntime(
	options: InstallLatestFfmpegRuntimeOptions,
): Promise<InstallLatestFfmpegRuntimeResult> {
	const signal = options.signal;
	throwIfAborted(signal);
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
	if (!options.store || typeof options.store.readActive !== 'function' || typeof options.store.begin !== 'function') {
		throw new TypeError('A verified runtime store is required.');
	}
	const pointerUrl = normalizePointerUrl(options.pointerUrl);
	const pointerResponse = await fetchRuntime(fetchImpl, pointerUrl, signal, 'runtime release pointer');
	const pointerBytes = await readBoundedResponse(pointerResponse, {
		label: 'Runtime release pointer',
		maximumBytes: MAXIMUM_POINTER_BYTES,
		signal,
	});
	const pointer = validatePointer(parseJson(pointerBytes, 'Runtime release pointer'), pointerUrl);

	const manifestUrl = descriptorUrl(pointer.manifest.path, pointerUrl);
	const manifestResponse = await fetchRuntime(fetchImpl, manifestUrl, signal, 'runtime release manifest');
	const manifestBytes = await readBoundedResponse(manifestResponse, {
		expectedBytes: pointer.manifest.byteLength,
		expectedSha256: pointer.manifest.sha256,
		label: 'Runtime release manifest',
		maximumBytes: MAXIMUM_MANIFEST_BYTES,
		signal,
	});
	const release = validateManifest(parseJson(manifestBytes, 'Runtime release manifest'), pointer, pointerUrl);
	throwIfAborted(signal);

	const active = await options.store.readActive();
	throwIfAborted(signal);
	if (active && sameRelease(active, release)) {
		return Object.freeze({ status: 'current', release: active });
	}

	const transaction = await options.store.begin(release);
	let committed = false;
	let completedBytes = 0;
	const totalBytes = release.files.reduce((total, file) => total + file.byteLength, 0);
	try {
		for (const file of release.files) {
			throwIfAborted(signal);
			const response = await fetchRuntime(fetchImpl, new URL(file.url), signal, file.name);
			validateRuntimeResponseHeaders(response, file);
			await stageVerifiedRuntimeFile(transaction, file, response, {
				signal,
				onChunk: (byteLength) => {
					completedBytes += byteLength;
					options.onProgress?.(Object.freeze({ completedBytes, totalBytes }));
				},
			});
		}
		throwIfAborted(signal);
		await transaction.commit();
		committed = true;
		return Object.freeze({ status: 'installed', release });
	} catch (error) {
		if (committed) throw error;
		try {
			await transaction.rollback();
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				'Runtime installation failed and its candidate cache could not be rolled back.',
			);
		}
		throw error;
	}
}

async function fetchRuntime(
	fetchImpl: typeof fetch,
	url: URL,
	signal: AbortSignal | undefined,
	label: string,
): Promise<Response> {
	throwIfAborted(signal);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			signal,
		});
	} catch (error) {
		throwIfAborted(signal);
		throw error;
	}
	throwIfAborted(signal);
	if (!(response instanceof Response)) throw new TypeError(`${label} fetch did not return a Response.`);
	if (!response.ok || response.status !== 200) throw new Error(`${label} request failed (${response.status}).`);
	return response;
}

async function stageVerifiedRuntimeFile(
	transaction: VerifiedRuntimeTransaction,
	file: VerifiedRuntimeFile,
	response: Response,
	options: Readonly<{
		signal?: AbortSignal;
		onChunk: (byteLength: number) => void;
	}>,
): Promise<void> {
	const body = response.body;
	if (!body) throw new Error(`${file.name} response has no readable body.`);
	const reader = body.getReader();
	const digest = sha256.create();
	let byteLength = 0;
	let validationSettled = false;
	let resolveValidation: () => void = () => undefined;
	let rejectValidation: (error: unknown) => void = () => undefined;
	const validation = new Promise<void>((resolve, reject) => {
		resolveValidation = () => {
			if (validationSettled) return;
			validationSettled = true;
			resolve();
		};
		rejectValidation = (error) => {
			if (validationSettled) return;
			validationSettled = true;
			reject(error);
		};
	});
	const cachedBody = new ReadableStream<Uint8Array>({
		pull: async (controller) => {
			try {
				throwIfAborted(options.signal);
				const { done, value } = await reader.read();
				throwIfAborted(options.signal);
				if (done) {
					if (byteLength !== file.byteLength) {
						throw new Error(`${file.name} byte length is ${byteLength}; expected ${file.byteLength}.`);
					}
					if (bytesToHex(digest.digest()) !== file.sha256) {
						throw new Error(`${file.name} SHA-256 does not match its verified descriptor.`);
					}
					resolveValidation();
					controller.close();
					return;
				}
				if (!(value instanceof Uint8Array) || value.byteLength === 0
					|| value.byteLength > MAXIMUM_STREAM_CHUNK_BYTES) {
					throw new Error(`${file.name} returned an invalid or oversized response chunk.`);
				}
				byteLength += value.byteLength;
				if (!Number.isSafeInteger(byteLength) || byteLength > file.byteLength) {
					throw new Error(`${file.name} byte length exceeds its verified descriptor.`);
				}
				digest.update(value);
				controller.enqueue(value);
				options.onChunk(value.byteLength);
			} catch (error) {
				rejectValidation(error);
				controller.error(error);
			}
		},
		cancel: async (reason) => {
			rejectValidation(reason);
			await reader.cancel(reason);
		},
	});
	const storedResponse = new Response(cachedBody, {
		status: 200,
		headers: {
			'content-length': String(file.byteLength),
			'content-type': file.contentType,
		},
	});
	const put = transaction.put(file, storedResponse);
	const monitoredPut = put.then(() => {
		if (!validationSettled) {
			throw new Error(`${file.name} candidate store stopped before the body completed.`);
		}
	});
	try {
		await Promise.all([validation, monitoredPut]);
	} catch (error) {
		rejectValidation(error);
		await reader.cancel(error).catch(() => undefined);
		if (!cachedBody.locked) await cachedBody.cancel(error).catch(() => undefined);
		await Promise.allSettled([put, validation]);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

function validateRuntimeResponseHeaders(response: Response, file: VerifiedRuntimeFile): void {
	const declaredLength = response.headers.get('content-length');
	if (declaredLength !== null && !hasEncodedWireRepresentation(response)) {
		if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) !== file.byteLength) {
			throw new Error(`${file.name} Content-Length does not match its verified byte length.`);
		}
	}
	const contentType = response.headers.get('content-type')?.trim().toLowerCase() ?? '';
	if (!runtimeContentTypeMatches(contentType, file.contentType)) {
		throw new Error(`${file.name} Content-Type does not match its verified descriptor.`);
	}
}

function runtimeContentTypeMatches(contentType: string, expectedContentType: string): boolean {
	if (expectedContentType !== JAVASCRIPT_RUNTIME_CONTENT_TYPE) {
		return contentType === expectedContentType.toLowerCase();
	}
	if (contentType === JAVASCRIPT_RUNTIME_MEDIA_TYPE) return true;
	const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim());
	return mediaType === JAVASCRIPT_RUNTIME_MEDIA_TYPE && parameters.length === 1
		&& /^charset\s*=\s*(?:utf-8|"utf-8")$/u.test(parameters[0]!);
}

async function readBoundedResponse(response: Response, options: Readonly<{
	readonly expectedBytes?: number;
	readonly expectedSha256?: string;
	readonly label: string;
	readonly maximumBytes: number;
	readonly signal?: AbortSignal;
}>): Promise<Uint8Array> {
	const declaredLength = response.headers.get('content-length');
	if (declaredLength !== null && !hasEncodedWireRepresentation(response)) {
		if (!/^\d+$/u.test(declaredLength)) throw new Error(`${options.label} has an invalid Content-Length.`);
		const parsed = Number(declaredLength);
		if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > options.maximumBytes) {
			throw new Error(`${options.label} Content-Length is outside its byte limit.`);
		}
		if (options.expectedBytes !== undefined && parsed !== options.expectedBytes) {
			throw new Error(`${options.label} Content-Length does not match its verified byte length.`);
		}
	}
	if (!response.body) throw new Error(`${options.label} response has no readable body.`);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	const digest = options.expectedSha256 ? sha256.create() : null;
	let byteLength = 0;
	try {
		while (true) {
			throwIfAborted(options.signal);
			const { done, value } = await reader.read();
			throwIfAborted(options.signal);
			if (done) break;
			if (!(value instanceof Uint8Array) || value.byteLength === 0) {
				throw new Error(`${options.label} returned an invalid response chunk.`);
			}
			byteLength += value.byteLength;
			if (!Number.isSafeInteger(byteLength) || byteLength > options.maximumBytes) {
				throw new Error(`${options.label} exceeds its byte limit.`);
			}
			digest?.update(value);
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (byteLength < 1) throw new Error(`${options.label} is empty.`);
	if (options.expectedBytes !== undefined && byteLength !== options.expectedBytes) {
		throw new Error(`${options.label} byte length is ${byteLength}; expected ${options.expectedBytes}.`);
	}
	if (options.expectedSha256 && bytesToHex(digest!.digest()) !== options.expectedSha256) {
		throw new Error(`${options.label} SHA-256 does not match its verified descriptor.`);
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function hasEncodedWireRepresentation(response: Response): boolean {
	// Fetch exposes decoded body bytes while retaining the encoded wire length.
	const contentEncoding = response.headers.get('content-encoding');
	if (contentEncoding === null) return false;
	return contentEncoding.split(',').some((coding) => coding.trim().toLowerCase() !== 'identity');
}

function validatePointer(value: unknown, pointerUrl: URL): RuntimePointer {
	const pointer = plainObject(value, 'Runtime release pointer');
	exactKeys(pointer, ['files', 'manifest', 'releaseId', 'schemaVersion'], 'Runtime release pointer');
	if (pointer.schemaVersion !== 1) throw new Error('Runtime release pointer has an unsupported schema.');
	const releaseId = sha256Text(pointer.releaseId, 'Runtime release pointer releaseId');
	const manifest = descriptor(pointer.manifest, 'Runtime release manifest descriptor');
	if (manifest.sha256 !== releaseId) {
		throw new Error('Runtime release pointer releaseId must equal the manifest SHA-256.');
	}
	const filesValue = plainObject(pointer.files, 'Runtime release pointer files');
	exactKeys(filesValue, [...RUNTIME_FILE_NAMES], 'Runtime release pointer files');
	const files = Object.fromEntries(RUNTIME_FILE_NAMES.map((name) => [
		name,
		descriptor(filesValue[name], `${name} pointer descriptor`),
	]));
	const publicPrefix = publicPrefixFor(pointerUrl);
	const releasePrefix = `${publicPrefix}/${FFMPEG_RUNTIME_RELEASE_SEGMENT}/${releaseId}`;
	if (manifest.path !== `${releasePrefix}/manifest.json`) {
		throw new Error('Runtime release manifest path leaves its exact release directory.');
	}
	for (const name of RUNTIME_FILE_NAMES) {
		if (files[name]!.path !== `${releasePrefix}/${name}`) {
			throw new Error(`${name} path leaves its exact release directory or origin.`);
		}
	}
	return Object.freeze({
		schemaVersion: 1,
		releaseId,
		manifest,
		files: Object.freeze(files),
	});
}

function validateManifest(value: unknown, pointer: RuntimePointer, pointerUrl: URL): VerifiedRuntimeRelease {
	const manifest = plainObject(value, 'Runtime release manifest');
	if (manifest.schemaVersion !== 1) throw new Error('Runtime release manifest has an unsupported schema.');
	const packageValue = plainObject(manifest.package, 'Runtime release package');
	if (packageValue.name !== '@ffmpeg/core' || typeof packageValue.version !== 'string'
		|| !/^\d+\.\d+\.\d+$/u.test(packageValue.version)) {
		throw new Error('Runtime release package identity is invalid.');
	}
	if (manifest.id !== `ffmpeg-core-${packageValue.version}`) {
		throw new Error('Runtime release manifest ID disagrees with its package version.');
	}
	const publicPrefix = publicPrefixFor(pointerUrl);
	if (publicPrefix !== `runtime/ffmpeg/${packageValue.version}`) {
		throw new Error('Runtime release pointer version disagrees with its package version.');
	}
	const runtime = plainObject(manifest.runtime, 'Runtime release manifest runtime');
	const runtimeFiles = runtime.files;
	if (runtime.publicPrefix !== publicPrefix || !Array.isArray(runtimeFiles)) {
		throw new Error('Runtime release manifest public prefix or file inventory is invalid.');
	}
	const publication = plainObject(manifest.publication, 'Runtime release publication');
	if (publication.manifestName !== 'manifest.json') {
		throw new Error('Runtime release manifest name is invalid.');
	}
	if (runtimeFiles.length !== RUNTIME_FILE_NAMES.length) {
		throw new Error('Runtime release manifest must contain exactly two runtime files.');
	}
	let totalBytes = 0;
	const baseUrl = descriptorUrl(
		`${publicPrefix}/${FFMPEG_RUNTIME_RELEASE_SEGMENT}/${pointer.releaseId}/`,
		pointerUrl,
	).href;
	const files = FFMPEG_RUNTIME_FILES.map(({ name: expectedName, contentType: expectedContentType }, index): VerifiedRuntimeFile => {
		const value = plainObject(runtimeFiles[index], `${expectedName} manifest descriptor`);
		exactKeys(value, ['byteLength', 'contentType', 'name', 'sha256'], `${expectedName} manifest descriptor`);
		if (value.name !== expectedName) throw new Error(`Runtime file ${index} must be ${expectedName}.`);
		const byteLength = positiveSafeInteger(value.byteLength, `${expectedName} byteLength`);
		if (byteLength > MAXIMUM_RUNTIME_FILE_BYTES) throw new Error(`${expectedName} exceeds its byte limit.`);
		const fileSha256 = sha256Text(value.sha256, `${expectedName} sha256`);
		if (value.contentType !== expectedContentType) throw new Error(`${expectedName} contentType is invalid.`);
		const pointerDescriptor = pointer.files[expectedName]!;
		if (pointerDescriptor.byteLength !== byteLength || pointerDescriptor.sha256 !== fileSha256) {
			throw new Error(`${expectedName} manifest descriptor disagrees with the release pointer.`);
		}
		totalBytes += byteLength;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_RUNTIME_RELEASE_BYTES) {
			throw new Error('Runtime release exceeds its aggregate byte limit.');
		}
		return Object.freeze({
			name: expectedName,
			url: descriptorUrl(pointerDescriptor.path, pointerUrl).href,
			byteLength,
			sha256: fileSha256,
			contentType: expectedContentType,
		});
	});
	return Object.freeze({
		schemaVersion: 1,
		releaseId: pointer.releaseId,
		manifestSha256: pointer.manifest.sha256,
		baseUrl,
		files: Object.freeze(files),
	});
}

function descriptor(value: unknown, label: string): RuntimeDescriptor {
	const result = plainObject(value, label);
	exactKeys(result, ['byteLength', 'path', 'sha256'], label);
	if (typeof result.path !== 'string' || !result.path || result.path.includes('\\') || result.path.startsWith('/')) {
		throw new Error(`${label} path is invalid.`);
	}
	return Object.freeze({
		path: result.path,
		byteLength: positiveSafeInteger(result.byteLength, `${label} byteLength`),
		sha256: sha256Text(result.sha256, `${label} sha256`),
	});
}

function normalizePointerUrl(value: string | URL): URL {
	const url = new URL(String(value));
	if (url.origin !== FFMPEG_RUNTIME_PUBLIC_ORIGIN) {
		throw new Error('Runtime release pointer must use the production asset origin.');
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
		|| url.href !== FFMPEG_RUNTIME_POINTER_URL) {
		throw new Error('Runtime release pointer must be a clean HTTPS latest.json URL.');
	}
	return url;
}

function publicPrefixFor(pointerUrl: URL): string {
	if (pointerUrl.href !== FFMPEG_RUNTIME_POINTER_URL) throw new Error('Runtime pointer policy is inconsistent.');
	return FFMPEG_RUNTIME_PUBLIC_PREFIX;
}

function descriptorUrl(path: string, pointerUrl: URL): URL {
	const url = new URL(`/${path}`, pointerUrl.origin);
	if (url.origin !== pointerUrl.origin || url.username || url.password || url.search || url.hash) {
		throw new Error('Runtime descriptor URL leaves its release origin.');
	}
	return url;
}

function sameRelease(left: VerifiedRuntimeRelease, right: VerifiedRuntimeRelease): boolean {
	return left.schemaVersion === right.schemaVersion
		&& left.releaseId === right.releaseId
		&& left.manifestSha256 === right.manifestSha256
		&& left.baseUrl === right.baseUrl
		&& left.files.length === right.files.length
		&& left.files.every((file, index) => {
			const candidate = right.files[index];
			return candidate !== undefined
				&& file.name === candidate.name
				&& file.url === candidate.url
				&& file.byteLength === candidate.byteLength
				&& file.sha256 === candidate.sha256
				&& file.contentType === candidate.contentType;
		});
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error(`${label} is not valid UTF-8 JSON.`);
	}
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new Error(`${label} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const normalized = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(normalized)) {
		throw new Error(`${label} has unknown or missing fields.`);
	}
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function sha256Text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new Error(`${label} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Runtime installation was cancelled.', 'AbortError');
}
