/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertAudiocomAuthorizationUrl, assertAudiocomExternalProvider, type AudiocomExternalConfiguration } from './audiocom-authorization.ts';
import { assertAudiocomLinkUrl } from './audiocom-links.ts';

export const AUDIOCOM_DESKTOP_PREFIX = '/_desktop/audiocom';
const SESSION_TOKEN = /^[A-Za-z0-9_-]{32,128}$/u;
const MAX_CONTROL_BYTES = 128 * 1024;
const MAX_UPLOAD_BYTES = 100_000_000;
const RESPONSE_HEADERS = ['cache-control', 'content-disposition', 'content-length', 'content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
const AUDIO_TYPES = new Set(['audio/wav', 'audio/vnd.wave', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mpa', 'audio/mpa-robust', 'audio/flac', 'audio/x-flac', 'audio/x-wavpack', 'audio/x-wavpack-correction', 'audio/aiff', 'audio/x-aiff', 'audio/ogg', 'audio/vorbis', 'audio/vorbis-config', 'application/ogg', 'audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg4-generic']);
const UPLOAD_PARAMETERS = ['title', 'category', 'description', 'license', 'listed', 'downloadable'];

type RequestKind = 'empty' | 'start' | 'json' | 'upload' | 'project';
interface ProxyRoute {
	readonly method: string;
	readonly path: string;
	readonly kind: RequestKind;
	readonly query?: readonly string[];
}
const ROUTES: readonly ProxyRoute[] = [
	{ method: 'POST', path: '/oauth/start', kind: 'start' },
	{ method: 'POST', path: '/oauth/poll', kind: 'json' },
	{ method: 'GET', path: '/oauth/session', kind: 'empty' },
	{ method: 'DELETE', path: '/oauth/session', kind: 'empty' },
	{ method: 'GET', path: '/search', kind: 'empty', query: ['q', 'page'] },
	{ method: 'GET', path: '/library', kind: 'empty', query: ['page'] },
	{ method: 'GET', path: '/usage', kind: 'empty' },
	{ method: 'GET', path: '/preview', kind: 'empty', query: ['url'] },
	{ method: 'POST', path: '/uploads', kind: 'upload', query: UPLOAD_PARAMETERS },
	{ method: 'GET', path: '/projects', kind: 'empty', query: ['page'] },
	{ method: 'POST', path: '/projects', kind: 'project', query: ['name', 'format'] },
	{ method: 'GET', path: '/projects/download', kind: 'empty', query: ['id', 'snapshotId'] },
];

interface SafeStorage {
	isEncryptionAvailable: () => boolean;
	getSelectedStorageBackend?: () => string;
	encryptString?: (value: string) => Buffer;
	decryptString?: (value: Buffer) => string;
	encryptStringAsync?: (value: string) => Promise<Buffer>;
	decryptStringAsync?: (value: Buffer) => Promise<{ result: string }>;
}
interface SessionStore {
	get: () => string | null;
	set: (value: string) => Promise<void>;
	clear: () => Promise<void>;
}
interface StoreOptions {
	readonly filePath: string;
	readonly platform: string;
	readonly safeStorage: SafeStorage;
}

/** Stores only the Soundscaper capability; provider OAuth tokens never enter this process. */
export class DesktopAudiocomSessionStore implements SessionStore {
	readonly #options: StoreOptions;
	#persistent = false;
	#token: string | null = null;

	constructor(options: StoreOptions) { this.#options = options; }

	async load(): Promise<void> {
		const { safeStorage, platform, filePath } = this.#options;
		this.#persistent = safeStorage.isEncryptionAvailable()
			&& !(platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend?.() ?? 'unknown'));
		if (!this.#persistent) return;
		try {
			const envelope: unknown = JSON.parse(await readFile(filePath, 'utf8'));
			if (!isRecord(envelope) || envelope.version !== 1 || typeof envelope.ciphertext !== 'string') throw new TypeError('Invalid session envelope');
			const encrypted = Buffer.from(envelope.ciphertext, 'base64');
			const decrypted = safeStorage.decryptStringAsync
				? (await safeStorage.decryptStringAsync(encrypted)).result
				: safeStorage.decryptString?.(encrypted);
			this.#token = validToken(decrypted);
		} catch (error) {
			if (!isRecord(error) || error.code !== 'ENOENT') await rm(filePath, { force: true }).catch(() => undefined);
			this.#token = null;
		}
	}

	get(): string | null { return this.#token; }

	async set(value: string): Promise<void> {
		this.#token = validToken(value);
		if (!this.#persistent) return;
		const { safeStorage, filePath } = this.#options;
		const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
		try {
			const encrypted = safeStorage.encryptStringAsync
				? await safeStorage.encryptStringAsync(this.#token)
				: safeStorage.encryptString?.(this.#token);
			if (!encrypted) throw new TypeError('Secure encryption is unavailable');
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(temporaryPath, `${JSON.stringify({ version: 1, ciphertext: encrypted.toString('base64') })}\n`, { mode: 0o600 });
			await rename(temporaryPath, filePath);
		} catch {
			this.#persistent = false;
			await Promise.all([filePath, temporaryPath].map((path) => rm(path, { force: true }).catch(() => undefined)));
		}
	}

	async clear(): Promise<void> {
		this.#token = null;
		await rm(this.#options.filePath, { force: true }).catch(() => undefined);
	}
}


interface ProxyOptions {
	readonly appOrigin: string;
	readonly apiOrigin: string;
	readonly fetchImpl: typeof fetch;
	readonly sessionStore: SessionStore;
}
interface IntegrationOptions extends Omit<ProxyOptions, 'sessionStore' | 'fetchImpl'>, StoreOptions {
	readonly fetchImpl?: typeof fetch;
	readonly productId: string;
	readonly channels: { readonly openAudiocomAuthorization: string; readonly openAudiocomLink: string };
	readonly handle: (channel: string, listener: (event: unknown, value: unknown) => Promise<boolean>) => void;
	readonly shell: { readonly openExternal: (url: string) => Promise<unknown> };
}

export async function createDesktopAudiocomIntegration(options: IntegrationOptions): Promise<Readonly<{
	proxy: ReturnType<typeof createDesktopAudiocomProxy> | null;
}>> {
	if (options.productId !== 'soundscaper') return Object.freeze({ proxy: null });
	const sessionStore = new DesktopAudiocomSessionStore(options);
	await sessionStore.load();
	options.handle(options.channels.openAudiocomAuthorization, async (_event, value) => {
		await options.shell.openExternal(await externalUrl(value, assertAudiocomAuthorizationUrl, options));
		return true;
	});
	options.handle(options.channels.openAudiocomLink, async (_event, value) => {
		await options.shell.openExternal(await externalUrl(value, assertAudiocomLinkUrl, options));
		return true;
	});
	return Object.freeze({ proxy: createDesktopAudiocomProxy({ ...options, fetchImpl: options.fetchImpl ?? fetch, sessionStore }) });
}

async function externalUrl(value: unknown, validate: (value: unknown, configuration?: AudiocomExternalConfiguration) => string, options: IntegrationOptions): Promise<string> {
	try { return validate(value); }
	catch (error) {
		if (typeof value !== 'string') throw error;
		try {
			const response = await (options.fetchImpl ?? fetch)(`${options.apiOrigin}/api/audiocom/usage`, {
				headers: { Accept: 'application/json', Origin: options.appOrigin }, redirect: 'error', signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) { await response.body?.cancel(); throw error; }
			const payload: unknown = JSON.parse(new TextDecoder().decode(await boundedBody(response.body)));
			if (!isRecord(payload) || !isRecord(payload.data)) throw error;
			const provider = assertAudiocomExternalProvider(payload.data.provider, options.apiOrigin);
			return validate(value, { backendOrigin: options.apiOrigin, provider });
		} catch { throw error; }
	}
}

export function createDesktopAudiocomProxy({ appOrigin, apiOrigin, fetchImpl, sessionStore }: ProxyOptions) {
	const trustedApp = new URL(appOrigin);
	return async (request: Request, parsedUrl = new URL(request.url)): Promise<Response> => {
		try {
			if (parsedUrl.protocol !== trustedApp.protocol || parsedUrl.host !== trustedApp.host
				|| !parsedUrl.pathname.startsWith(`${AUDIOCOM_DESKTOP_PREFIX}/api/audiocom/`)) return failure(404, 'Not found');
			const apiPath = parsedUrl.pathname.slice(AUDIOCOM_DESKTOP_PREFIX.length);
			const path = apiPath.slice('/api/audiocom'.length);
			const paths = ROUTES.filter((candidate) => candidate.path === path);
			if (!paths.length) return failure(404, 'Not found');
			const route = paths.find((candidate) => candidate.method === request.method);
			if (!route) return failure(405, 'Method not allowed');
			if (parsedUrl.hash || parsedUrl.href.length > 32_768
				|| [...parsedUrl.searchParams.keys()].some((key) => !route.query?.includes(key) || parsedUrl.searchParams.getAll(key).length !== 1)) return failure(400, 'Invalid query parameters');
			const token = sessionStore.get();
			let init: RequestInit;
			try { init = await requestOptions(request, route, appOrigin, token); }
			catch { return failure(400, 'Invalid audio.com request'); }
			const upstream = await fetchImpl(`${apiOrigin}${apiPath}${parsedUrl.search}`, init);
			if ((upstream.status === 401 && token) || (path === '/oauth/session' && request.method === 'DELETE' && upstream.ok)) await sessionStore.clear();
			if (path === '/oauth/poll' && upstream.ok) return await sanitizePoll(upstream, sessionStore);
			return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders(upstream.headers) });
		} catch { return failure(502, 'audio.com request failed'); }
	};
}

async function requestOptions(request: Request, route: ProxyRoute, appOrigin: string, token: string | null): Promise<RequestInit> {
	const headers = new Headers({ Accept: request.headers.get('accept') || 'application/json', Origin: appOrigin });
	if (token) headers.set('Authorization', `Bearer ${validToken(token)}`);
	if (route.path === '/preview' && request.headers.has('range')) {
		const range = request.headers.get('range') ?? '';
		if (!/^bytes=(?:\d+-\d*|-\d+)$/u.test(range)) throw new TypeError();
		headers.set('Range', range);
	}
	let body: BodyInit | undefined;
	if (route.kind === 'start') {
		headers.set('Content-Type', 'application/json');
		body = '{"client":"desktop"}';
	} else if (route.kind === 'json') {
		if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') ?? '')) throw new TypeError();
		headers.set('Content-Type', 'application/json');
		body = await boundedBody(request.body);
	} else if (route.kind === 'upload' || route.kind === 'project') {
		const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
		const declaredLength = request.headers.get('x-audiocom-content-length') ?? '';
		const length = Number(declaredLength);
		const filename = request.headers.get('x-audiocom-filename') ?? '';
		if (!/^[1-9]\d{0,8}$/u.test(declaredLength) || length > MAX_UPLOAD_BYTES
			|| !(route.kind === 'project' ? contentType === 'application/octet-stream' : AUDIO_TYPES.has(contentType))
			|| !/^[\x21-\x7e]{1,1024}$/u.test(filename) || !request.body) throw new TypeError();
		if (route.kind === 'project') {
			const decoded = decodeURIComponent(filename);
			const format = new URL(request.url).searchParams.get('format');
			if (length < 16 || !/\.(?:aup3|aup4)$/iu.test(decoded) || !decoded.toLowerCase().endsWith(`.${format ?? ''}`)
				|| /[/\\]/u.test(decoded) || [...decoded].some(character => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) throw new TypeError();
		}
		headers.set('Content-Type', contentType);
		headers.set('Content-Length', String(length));
		headers.set('X-Audiocom-Content-Length', String(length));
		headers.set('X-Audiocom-Filename', filename);
		body = request.body;
	}
	return { method: request.method, headers, ...(body === undefined ? {} : { body, duplex: 'half' }), redirect: 'error', signal: request.signal };
}

async function sanitizePoll(upstream: Response, sessionStore: SessionStore): Promise<Response> {
	const payload: unknown = JSON.parse(new TextDecoder().decode(await boundedBody(upstream.body)));
	if (!isRecord(payload)) throw new TypeError('Invalid OAuth response');
	const data = isRecord(payload.data) ? payload.data : payload;
	if (data.sessionToken !== undefined) {
		await sessionStore.set(validToken(data.sessionToken));
		delete data.sessionToken;
	}
	delete payload.sessionToken;
	const body = JSON.stringify(payload);
	const headers = responseHeaders(upstream.headers);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Content-Length', String(Buffer.byteLength(body)));
	return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

async function boundedBody(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
	if (!stream) return new Uint8Array();
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		length += chunk.value.byteLength;
		if (length > MAX_CONTROL_BYTES) {
			await reader.cancel('Control message is too large');
			throw new RangeError('Control message is too large');
		}
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

function responseHeaders(source: Headers): Headers {
	const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
	for (const name of RESPONSE_HEADERS) {
		const value = source.get(name);
		if (value !== null) headers.set(name, value);
	}
	return headers;
}
function validToken(value: unknown): string {
	if (typeof value !== 'string' || !SESSION_TOKEN.test(value)) throw new TypeError('Invalid audio.com session');
	return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function failure(status: number, message: string): Response {
	return Response.json({ error: { code: `desktop_proxy_${status}`, message } }, { status,
		headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});
}
