/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	VerifiedRuntimeFile,
	VerifiedRuntimeRelease,
	VerifiedRuntimeStore,
	VerifiedRuntimeTransaction,
} from './ffmpeg-runtime-cache.ts';

export const BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX = 'soundscaper-ffmpeg-runtime-v1-';

const STATE_CACHE_NAME = `${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}state`;
const STATE_PATH = '/.soundscaper/offline/ffmpeg-runtime-state-v1.json';
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const CANDIDATE_ID_PATTERN = /^[A-Za-z\d-]{1,128}$/u;
const RUNTIME_FILE_NAMES = Object.freeze(['ffmpeg-core.js', 'ffmpeg-core.wasm']);
const MAXIMUM_STATE_BYTES = 64 * 1024;

interface RuntimeCache {
	match(input: RequestInfo | URL): Promise<Response | undefined>;
	put(input: RequestInfo | URL, response: Response): Promise<void>;
}

interface RuntimeCacheStorage {
	delete(cacheName: string): Promise<boolean>;
	keys(): Promise<string[]>;
	open(cacheName: string): Promise<RuntimeCache>;
}

interface BrowserRuntimeState {
	readonly schemaVersion: 1;
	readonly active: VerifiedRuntimeRelease;
	readonly previous: VerifiedRuntimeRelease | null;
}

export interface BrowserFfmpegRuntimeStoreOptions {
	readonly cacheStorage?: RuntimeCacheStorage;
	readonly origin?: string;
	readonly randomUUID?: () => string;
}

/** CacheStorage-backed two-version store whose state entry is the commit point. */
export function createBrowserFfmpegRuntimeStore(
	options: BrowserFfmpegRuntimeStoreOptions = {},
): VerifiedRuntimeStore {
	const candidateCacheStorage = options.cacheStorage
		?? (globalThis.caches as unknown as RuntimeCacheStorage | undefined);
	if (!candidateCacheStorage || typeof candidateCacheStorage.open !== 'function'
		|| typeof candidateCacheStorage.delete !== 'function' || typeof candidateCacheStorage.keys !== 'function') {
		throw new Error('Browser CacheStorage is unavailable.');
	}
	const cacheStorage: RuntimeCacheStorage = candidateCacheStorage;
	const origin = normalizeOrigin(options.origin ?? globalThis.location?.origin);
	const stateKey = new URL(STATE_PATH, origin).href;
	const randomUUID = options.randomUUID ?? globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
	if (typeof randomUUID !== 'function') throw new Error('A secure runtime candidate identifier is unavailable.');

	async function readState(): Promise<BrowserRuntimeState | null> {
		const cache = await cacheStorage.open(STATE_CACHE_NAME);
		const response = await cache.match(stateKey);
		if (!response) return null;
		if (!response.ok || response.status !== 200) return null;
		const declaredLength = response.headers.get('content-length');
		if (declaredLength !== null && (!/^\d+$/u.test(declaredLength)
			|| Number(declaredLength) > MAXIMUM_STATE_BYTES)) return null;
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (!bytes.byteLength || bytes.byteLength > MAXIMUM_STATE_BYTES) return null;
		try {
			return validateState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
		} catch {
			return null;
		}
	}

	async function isComplete(release: VerifiedRuntimeRelease | null): Promise<boolean> {
		if (!release) return false;
		const cacheName = releaseCacheName(release.releaseId);
		if (!(await cacheStorage.keys()).includes(cacheName)) return false;
		const cache = await cacheStorage.open(cacheName);
		for (const file of release.files) {
			const response = await cache.match(file.url);
			if (!response || !response.ok || response.status !== 200) return false;
			if (response.headers.get('content-length') !== String(file.byteLength)
				|| response.headers.get('content-type')?.toLowerCase() !== file.contentType.toLowerCase()) {
				return false;
			}
		}
		return true;
	}

	async function readActive(): Promise<VerifiedRuntimeRelease | null> {
		const state = await readState();
		if (!state) return null;
		if (await isComplete(state.active)) return state.active;
		return await isComplete(state.previous) ? state.previous : null;
	}

	async function begin(input: VerifiedRuntimeRelease): Promise<VerifiedRuntimeTransaction> {
		const release = validateRelease(input, 'Runtime candidate');
		const candidateId = randomUUID();
		if (!CANDIDATE_ID_PATTERN.test(candidateId)) {
			throw new Error('Runtime candidate identifier is invalid.');
		}
		const candidateName = `${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}candidate-${candidateId}`;
		await cacheStorage.delete(candidateName);
		const candidate = await cacheStorage.open(candidateName);
		const stored = new Set<string>();
		let settled = false;

		function assertOpen(): void {
			if (settled) throw new Error('Runtime candidate transaction is already settled.');
		}

		const transaction: VerifiedRuntimeTransaction = {
			put: async (fileInput, response) => {
				assertOpen();
				const expected = release.files.find(({ name }) => name === fileInput.name);
				if (!expected || !sameFile(expected, fileInput)) {
					throw new Error('Runtime file does not belong to the candidate release.');
				}
				if (stored.has(expected.name)) throw new Error(`${expected.name} is already staged.`);
				if (!(response instanceof Response) || !response.ok || response.status !== 200
					|| response.headers.get('content-length') !== String(expected.byteLength)
					|| response.headers.get('content-type')?.toLowerCase() !== expected.contentType.toLowerCase()) {
					throw new Error(`${expected.name} staged response is invalid.`);
				}
				await candidate.put(expected.url, response);
				stored.add(expected.name);
			},
			commit: async () => {
				assertOpen();
				for (const file of release.files) {
					if (!stored.has(file.name)) throw new Error(`Runtime candidate is missing ${file.name}.`);
				}
				const prior = await readActive();
				const finalName = releaseCacheName(release.releaseId);
				await cacheStorage.delete(finalName);
				const finalCache = await cacheStorage.open(finalName);
				try {
					for (const file of release.files) {
						const response = await candidate.match(file.url);
						if (!response) throw new Error(`Runtime candidate lost ${file.name} before commit.`);
						await finalCache.put(file.url, response);
					}
					const state = Object.freeze({
						schemaVersion: 1 as const,
						active: release,
						previous: prior && prior.releaseId !== release.releaseId ? prior : null,
					});
					await writeState(cacheStorage, stateKey, state);
					settled = true;
				} catch (error) {
					await cacheStorage.delete(finalName).catch(() => false);
					throw error;
				}
				await cleanupRuntimeCaches(cacheStorage, new Set([
					STATE_CACHE_NAME,
					finalName,
					...(prior ? [releaseCacheName(prior.releaseId)] : []),
				]));
				await cacheStorage.delete(candidateName).catch(() => false);
			},
			rollback: async () => {
				if (settled) return;
				settled = true;
				await cacheStorage.delete(candidateName);
			},
		};
		return transaction;
	}

	return Object.freeze({ readActive, begin });
}

async function writeState(
	cacheStorage: RuntimeCacheStorage,
	stateKey: string,
	state: BrowserRuntimeState,
): Promise<void> {
	const bytes = new TextEncoder().encode(JSON.stringify(state));
	if (bytes.byteLength > MAXIMUM_STATE_BYTES) throw new Error('Runtime cache state exceeds its byte limit.');
	const cache = await cacheStorage.open(STATE_CACHE_NAME);
	await cache.put(stateKey, new Response(bytes.buffer, {
		status: 200,
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': 'application/json; charset=utf-8',
		},
	}));
}

async function cleanupRuntimeCaches(
	cacheStorage: RuntimeCacheStorage,
	retained: ReadonlySet<string>,
): Promise<void> {
	for (const cacheName of await cacheStorage.keys()) {
		if (cacheName.startsWith(BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX) && !retained.has(cacheName)) {
			await cacheStorage.delete(cacheName).catch(() => false);
		}
	}
}

function validateState(value: unknown): BrowserRuntimeState {
	const state = plainObject(value, 'Runtime cache state');
	exactKeys(state, ['active', 'previous', 'schemaVersion'], 'Runtime cache state');
	if (state.schemaVersion !== 1) throw new Error('Runtime cache state has an unsupported schema.');
	return Object.freeze({
		schemaVersion: 1,
		active: validateRelease(state.active, 'Active runtime'),
		previous: state.previous === null ? null : validateRelease(state.previous, 'Previous runtime'),
	});
}

function validateRelease(value: unknown, label: string): VerifiedRuntimeRelease {
	const release = plainObject(value, label);
	exactKeys(release, ['baseUrl', 'files', 'manifestSha256', 'releaseId', 'schemaVersion'], label);
	if (release.schemaVersion !== 1) throw new Error(`${label} has an unsupported schema.`);
	const releaseId = digest(release.releaseId, `${label} releaseId`);
	if (digest(release.manifestSha256, `${label} manifestSha256`) !== releaseId) {
		throw new Error(`${label} manifest digest disagrees with its release ID.`);
	}
	const baseUrl = new URL(String(release.baseUrl));
	const expectedBase = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}/`;
	if (baseUrl.href !== expectedBase) throw new Error(`${label} base URL is invalid.`);
	const runtimeFiles = release.files;
	if (!Array.isArray(runtimeFiles) || runtimeFiles.length !== RUNTIME_FILE_NAMES.length) {
		throw new Error(`${label} file inventory is invalid.`);
	}
	const files = RUNTIME_FILE_NAMES.map((name, index) => validateFile(runtimeFiles[index], name, baseUrl, label));
	return Object.freeze({
		schemaVersion: 1,
		releaseId,
		manifestSha256: releaseId,
		baseUrl: baseUrl.href,
		files: Object.freeze(files),
	});
}

function validateFile(
	value: unknown,
	expectedName: string,
	baseUrl: URL,
	label: string,
): VerifiedRuntimeFile {
	const file = plainObject(value, `${label} ${expectedName}`);
	exactKeys(file, ['byteLength', 'contentType', 'name', 'sha256', 'url'], `${label} ${expectedName}`);
	if (file.name !== expectedName || file.url !== new URL(expectedName, baseUrl).href) {
		throw new Error(`${label} ${expectedName} identity is invalid.`);
	}
	if (!Number.isSafeInteger(file.byteLength) || Number(file.byteLength) < 1) {
		throw new Error(`${label} ${expectedName} byte length is invalid.`);
	}
	const contentType = expectedName.endsWith('.wasm')
		? 'application/wasm'
		: 'text/javascript; charset=utf-8';
	if (file.contentType !== contentType) throw new Error(`${label} ${expectedName} content type is invalid.`);
	return Object.freeze({
		name: expectedName,
		url: file.url,
		byteLength: Number(file.byteLength),
		sha256: digest(file.sha256, `${label} ${expectedName} sha256`),
		contentType,
	});
}

function sameFile(left: VerifiedRuntimeFile, right: VerifiedRuntimeFile): boolean {
	return left.name === right.name && left.url === right.url
		&& left.byteLength === right.byteLength && left.sha256 === right.sha256
		&& left.contentType === right.contentType;
}

function releaseCacheName(releaseId: string): string {
	return `${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${releaseId}`;
}

function normalizeOrigin(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new Error('Application origin is unavailable.');
	const url = new URL(value);
	if (url.origin !== value || (url.protocol !== 'https:' && url.hostname !== 'localhost'
		&& url.hostname !== '127.0.0.1')) {
		throw new Error('Application origin is invalid.');
	}
	return url.origin;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new Error(`${label} is invalid.`);
	}
	return value;
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new Error(`${label} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		throw new Error(`${label} has unknown or missing fields.`);
	}
}
