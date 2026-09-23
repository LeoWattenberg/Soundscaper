/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const FREESOUND_DESKTOP_PREFIX = '/_desktop/freesound';

const FREESOUND_AUTHORIZE_URL = 'https://freesound.org/apiv2/oauth2/authorize/';
const MAX_CONTROL_BODY_BYTES = 128 * 1024;
const MAX_UPLOAD_BYTES = 100_000_000;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{32,128}$/u;
const FORWARDED_RESPONSE_HEADERS = Object.freeze([
	'cache-control', 'content-disposition', 'content-length', 'content-type', 'etag', 'last-modified',
]);
const UPLOAD_MEDIA_TYPES = new Set([
	'audio/aiff', 'audio/flac', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-aiff', 'audio/x-wav',
]);
const ROUTES = Object.freeze([
	{ method: 'POST', path: /^\/api\/freesound\/oauth\/start$/u, kind: 'start' },
	{ method: 'POST', path: /^\/api\/freesound\/oauth\/poll$/u, kind: 'json' },
	{ method: 'GET', path: /^\/api\/freesound\/oauth\/session$/u, kind: 'empty' },
	{ method: 'DELETE', path: /^\/api\/freesound\/oauth\/session$/u, kind: 'empty' },
	{ method: 'GET', path: /^\/api\/freesound\/sounds\/[1-9]\d*\/original$/u, kind: 'empty' },
	{ method: 'POST', path: /^\/api\/freesound\/uploads$/u, kind: 'upload' },
	{ method: 'POST', path: /^\/api\/freesound\/uploads\/describe$/u, kind: 'json' },
	{ method: 'GET', path: /^\/api\/freesound\/uploads\/pending$/u, kind: 'empty' },
	{ method: 'GET', path: /^\/api\/freesound\/usage$/u, kind: 'empty' },
]);

export class DesktopFreesoundSessionStore {
	#filePath;
	#persistent = false;
	#platform;
	#safeStorage;
	#token = null;

	constructor({ filePath, platform, safeStorage }) {
		this.#filePath = filePath;
		this.#platform = platform;
		this.#safeStorage = safeStorage;
	}

	async load() {
		this.#persistent = await securePersistenceAvailable(this.#safeStorage, this.#platform);
		if (!this.#persistent) return;
		try {
			const envelope = JSON.parse(await readFile(this.#filePath, 'utf8'));
			if (envelope?.version !== 1 || typeof envelope.ciphertext !== 'string') throw new TypeError('Invalid session envelope');
			const encrypted = Buffer.from(envelope.ciphertext, 'base64');
			const decrypted = typeof this.#safeStorage.decryptStringAsync === 'function'
				? (await this.#safeStorage.decryptStringAsync(encrypted)).result
				: this.#safeStorage.decryptString(encrypted);
			this.#token = validSessionToken(decrypted);
		} catch (error) {
			if (error?.code !== 'ENOENT') await rm(this.#filePath, { force: true }).catch(() => undefined);
			this.#token = null;
		}
	}

	get() {
		return this.#token;
	}

	async set(value) {
		this.#token = validSessionToken(value);
		if (!this.#persistent) return;
		let temporaryPath = null;
		try {
			const encrypted = typeof this.#safeStorage.encryptStringAsync === 'function'
				? await this.#safeStorage.encryptStringAsync(this.#token)
				: this.#safeStorage.encryptString(this.#token);
			await mkdir(dirname(this.#filePath), { recursive: true });
			temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`;
			await writeFile(temporaryPath, `${JSON.stringify({ version: 1, ciphertext: encrypted.toString('base64') })}\n`, { mode: 0o600 });
			await rename(temporaryPath, this.#filePath);
		} catch {
			this.#persistent = false;
			await Promise.all([
				rm(this.#filePath, { force: true }).catch(() => undefined),
				temporaryPath ? rm(temporaryPath, { force: true }).catch(() => undefined) : undefined,
			]);
		}
	}

	async clear() {
		this.#token = null;
		await rm(this.#filePath, { force: true }).catch(() => undefined);
	}
}

export function assertFreesoundAuthorizationUrl(value) {
	let url;
	try {
		url = new URL(String(value));
	} catch {
		throw new TypeError('Invalid Freesound authorization URL');
	}
	if (`${url.origin}${url.pathname}` !== FREESOUND_AUTHORIZE_URL
		|| url.username || url.password || url.hash
		|| [...url.searchParams.keys()].some((key) => !['client_id', 'redirect_uri', 'response_type', 'state'].includes(key))
		|| ['client_id', 'redirect_uri', 'response_type', 'state'].some((key) => url.searchParams.getAll(key).length !== 1)
		|| url.searchParams.get('response_type') !== 'code'
		|| url.searchParams.get('redirect_uri') !== 'https://soundscaper.org/api/freesound/oauth/callback'
		|| !boundedText(url.searchParams.get('client_id'), 512)
		|| !boundedText(url.searchParams.get('state'), 512)) {
		throw new TypeError('Invalid Freesound authorization URL');
	}
	return url.href;
}

export async function createDesktopFreesoundIntegration({
	appOrigin, apiOrigin, channels, fetchImpl = fetch, filePath, handle, platform, productId,
	safeStorage, shell,
}) {
	if (productId !== 'soundscaper') return Object.freeze({ proxy: null });
	const sessionStore = new DesktopFreesoundSessionStore({ filePath, platform, safeStorage });
	await sessionStore.load();
	handle(channels.openFreesoundAuthorization, async (_event, value) => {
		await shell.openExternal(assertFreesoundAuthorizationUrl(value));
		return true;
	});
	return Object.freeze({
		proxy: createDesktopFreesoundProxy({ appOrigin, apiOrigin, fetchImpl, sessionStore }),
	});
}

export function createDesktopFreesoundProxy({ appOrigin, apiOrigin, fetchImpl, sessionStore }) {
	const trustedAppUrl = new URL(appOrigin);
	return async (request, parsedUrl = new URL(request.url)) => {
		try {
			if (parsedUrl.protocol !== trustedAppUrl.protocol || parsedUrl.host !== trustedAppUrl.host
				|| !parsedUrl.pathname.startsWith(FREESOUND_DESKTOP_PREFIX)) {
				return errorResponse(404, 'Not found');
			}
			if (parsedUrl.search || parsedUrl.hash) return errorResponse(400, 'Query parameters are not allowed');
			const apiPath = parsedUrl.pathname.slice(FREESOUND_DESKTOP_PREFIX.length);
			const matchingPaths = ROUTES.filter((route) => route.path.test(apiPath));
			if (!matchingPaths.length) return errorResponse(404, 'Not found');
			const route = matchingPaths.find((candidate) => candidate.method === request.method);
			if (!route) return errorResponse(405, 'Method not allowed');
			const token = sessionStore.get();
			const upstreamRequest = await upstreamRequestOptions(request, route, { appOrigin, token });
			const upstream = await fetchImpl(`${apiOrigin}${apiPath}`, upstreamRequest);
			if (upstream.status === 401 && token) await sessionStore.clear();
			if (apiPath === '/api/freesound/oauth/session' && request.method === 'DELETE' && upstream.ok) {
				await sessionStore.clear();
			}
			if (route.kind === 'json' && apiPath.endsWith('/oauth/poll') && upstream.ok) {
				return sanitizePollResponse(upstream, sessionStore);
			}
			return copyUpstreamResponse(upstream);
		} catch {
			return errorResponse(502, 'Freesound request failed');
		}
	};
}

async function upstreamRequestOptions(request, route, { appOrigin, token }) {
	const headers = new Headers({ Accept: request.headers.get('accept') || 'application/json', Origin: appOrigin });
	if (token) headers.set('Authorization', `Bearer ${validSessionToken(token)}`);
	let body;
	if (route.kind === 'start') {
		headers.set('Content-Type', 'application/json');
		body = '{"client":"desktop"}';
	} else if (route.kind === 'json') {
		if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') || '')) {
			throw new TypeError('JSON content type required');
		}
		headers.set('Content-Type', 'application/json');
		body = await readBodyWithin(request, MAX_CONTROL_BODY_BYTES);
	} else if (route.kind === 'upload') {
		const contentType = (request.headers.get('content-type') || '').toLowerCase();
		const declaredLength = request.headers.get('x-freesound-content-length');
		const contentLength = Number(declaredLength);
		const filename = request.headers.get('x-freesound-filename') || '';
		if (!/^[1-9]\d{0,8}$/u.test(declaredLength || '')
			|| !UPLOAD_MEDIA_TYPES.has(contentType) || !Number.isSafeInteger(contentLength)
			|| contentLength < 1 || contentLength > MAX_UPLOAD_BYTES
			|| !/^[\x21-\x7e]{1,1024}$/u.test(filename) || !request.body) {
			throw new TypeError('Invalid upload request');
		}
		headers.set('Content-Type', contentType);
		headers.set('Content-Length', String(contentLength));
		headers.set('X-Freesound-Filename', filename);
		body = request.body;
	}
	return {
		method: request.method,
		headers,
		...(body === undefined ? {} : { body, duplex: 'half' }),
		redirect: 'error',
		signal: request.signal,
	};
}

async function sanitizePollResponse(upstream, sessionStore) {
	const bytes = new Uint8Array(await upstream.arrayBuffer());
	if (bytes.byteLength > MAX_CONTROL_BODY_BYTES) throw new RangeError('OAuth poll response is too large');
	const payload = JSON.parse(new TextDecoder().decode(bytes));
	const sessionToken = payload?.data?.sessionToken ?? payload?.sessionToken;
	if (sessionToken !== undefined) {
		await sessionStore.set(validSessionToken(sessionToken));
		if (payload?.data && typeof payload.data === 'object') delete payload.data.sessionToken;
		delete payload.sessionToken;
	}
	const body = JSON.stringify(payload);
	const headers = copiedResponseHeaders(upstream.headers);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Content-Length', String(Buffer.byteLength(body)));
	return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function copyUpstreamResponse(upstream) {
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: copiedResponseHeaders(upstream.headers),
	});
}

function copiedResponseHeaders(source) {
	const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
	for (const name of FORWARDED_RESPONSE_HEADERS) {
		const value = source.get(name);
		if (value !== null) headers.set(name, value);
	}
	return headers;
}

async function readBodyWithin(request, maximumBytes) {
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maximumBytes) {
			await reader.cancel('Request body is too large');
			throw new RangeError('Request body is too large');
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

async function securePersistenceAvailable(safeStorage, platform) {
	if (!safeStorage?.isEncryptionAvailable?.()) return false;
	if (platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend?.())) return false;
	return true;
}

function validSessionToken(value) {
	if (typeof value !== 'string' || !SESSION_TOKEN.test(value)) throw new TypeError('Invalid Freesound session token');
	return value;
}

function boundedText(value, maximumLength) {
	return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function errorResponse(status, message) {
	return Response.json({ error: { code: `desktop_proxy_${status}`, message } }, {
		status,
		headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});
}
