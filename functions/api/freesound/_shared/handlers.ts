/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FreesoundContractError,
	normalizeFreesoundSearch,
	normalizeFreesoundSound,
} from './contracts.ts';

export interface FreesoundFunctionContext {
	readonly request: Request;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly params: Readonly<Record<string, string | string[]>>;
}

export interface FreesoundHandlerDependencies {
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
}

interface RequestAdmission {
	readonly corsOrigin: string | null;
	readonly head: boolean;
}

interface UpstreamDependencies {
	readonly fetchImpl: typeof fetch;
	readonly timeoutMs: number;
	readonly apiKey: string;
}

interface SearchInput {
	readonly query: string;
	readonly page: number;
	readonly license: 'all' | 'cc0' | 'cc-by' | 'cc-by-nc';
	readonly sort: 'relevance' | 'newest' | 'rating' | 'downloads';
}

class HttpError extends Error {
	public readonly status: number;
	public readonly code: string;
	public readonly responseHeaders: HeadersInit | undefined;

	public constructor(status: number, code: string, message: string, responseHeaders?: HeadersInit) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.code = code;
		this.responseHeaders = responseHeaders;
	}
}

const API_ORIGIN = 'https://freesound.org';
const API_FIELDS = [
	'id', 'name', 'tags', 'description', 'category', 'subcategory', 'created', 'license',
	'gen_ai_preference', 'type', 'channels', 'filesize', 'duration', 'samplerate', 'username',
	'md5', 'is_explicit', 'previews', 'num_downloads', 'avg_rating', 'num_ratings',
].join(',');
const PAGE_SIZE = 20;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024 * 1024;
const DESKTOP_ORIGIN = 'soundscaper-app://bundle';
const WEB_ORIGIN = 'https://soundscaper.org';

const SORTS = Object.freeze({
	relevance: 'score',
	newest: 'created_desc',
	rating: 'rating_desc',
	downloads: 'downloads_desc',
});

const LICENSE_FILTERS = Object.freeze({
	all: null,
	cc0: 'license:"Creative Commons 0"',
	'cc-by': 'license:Attribution',
	'cc-by-nc': 'license:"Attribution NonCommercial"',
});

export async function handleFreesoundSearchRequest(
	context: FreesoundFunctionContext,
	dependencies: FreesoundHandlerDependencies = {},
): Promise<Response> {
	return handleEndpoint(context, async (admission, upstream) => {
		const input = searchInput(new URL(context.request.url));
		const url = new URL('/apiv2/search/', API_ORIGIN);
		url.searchParams.set('query', input.query);
		url.searchParams.set('page', String(input.page));
		url.searchParams.set('page_size', String(PAGE_SIZE));
		url.searchParams.set('sort', SORTS[input.sort]);
		url.searchParams.set('fields', API_FIELDS);
		const filter = LICENSE_FILTERS[input.license];
		if (filter !== null) url.searchParams.set('filter', filter);
		const source = await fetchApiJson(context, upstream, url, false);
		const data = normalizeFreesoundSearch(source, {
			query: input.query,
			page: input.page,
			pageSize: PAGE_SIZE,
		});
		return json({ data }, 200, admission, 'public, max-age=60, s-maxage=300, stale-while-revalidate=60');
	}, dependencies);
}

export async function handleFreesoundSoundRequest(
	context: FreesoundFunctionContext,
	dependencies: FreesoundHandlerDependencies = {},
): Promise<Response> {
	return handleEndpoint(context, async (admission, upstream) => {
		const id = soundId(context.params.id);
		const normalized = await fetchSound(context, upstream, id, true);
		return json(
			{ data: normalized.sound },
			200,
			admission,
			'public, max-age=300, s-maxage=3600, stale-while-revalidate=300',
		);
	}, dependencies);
}

export async function handleFreesoundPreviewRequest(
	context: FreesoundFunctionContext,
	dependencies: FreesoundHandlerDependencies = {},
): Promise<Response> {
	return handleEndpoint(context, async (admission, upstream) => {
		const id = soundId(context.params.id);
		const range = byteRange(context.request.headers.get('range'));
		const normalized = await fetchSound(context, upstream, id, true);
		const headers = new Headers({ Accept: 'audio/ogg' });
		if (range !== null) headers.set('Range', range);
		const upstreamResponse = await timedFetch(context.request.signal, upstream, normalized.previewUrl, {
			method: admission.head ? 'HEAD' : 'GET',
			headers,
			redirect: 'error',
		});
		if (upstreamResponse.status === 416) {
			const responseHeaders = previewHeaders(upstreamResponse.headers, admission, id);
			responseHeaders.set('Cache-Control', 'no-store');
			return new Response(null, { status: 416, headers: responseHeaders });
		}
		if (upstreamResponse.status !== 200 && upstreamResponse.status !== 206) {
			throw upstreamStatus(upstreamResponse.status, false, upstreamResponse.headers);
		}
		assertPreviewResponse(upstreamResponse);
		const responseHeaders = previewHeaders(upstreamResponse.headers, admission, id);
		const body = admission.head || upstreamResponse.body === null
			? null
			: boundedPreviewStream(upstreamResponse.body);
		return new Response(body, { status: upstreamResponse.status, headers: responseHeaders });
	}, dependencies);
}

async function handleEndpoint(
	context: FreesoundFunctionContext,
	handler: (admission: RequestAdmission, upstream: UpstreamDependencies) => Promise<Response>,
	dependencies: FreesoundHandlerDependencies,
): Promise<Response> {
	let corsOrigin: string | null = null;
	try {
		assertAllowedHost(new URL(context.request.url), context.env);
		corsOrigin = allowedCorsOrigin(context.request);
		if (context.request.method === 'OPTIONS') return preflight(corsOrigin);
		if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
			throw new HttpError(405, 'method_not_allowed', 'Only GET, HEAD, and OPTIONS are supported.', {
				Allow: 'GET, HEAD, OPTIONS',
			});
		}
		const secret = apiKey(context.env);
		const upstream = dependenciesWithDefaults(dependencies, secret);
		return await handler({ corsOrigin, head: context.request.method === 'HEAD' }, upstream);
	} catch (error) {
		const failure = publicError(error);
		return jsonError(failure, corsOrigin);
	}
}

function dependenciesWithDefaults(
	dependencies: FreesoundHandlerDependencies,
	secret: string,
): UpstreamDependencies {
	const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
		throw new TypeError('The Freesound upstream timeout is invalid.');
	}
	return { fetchImpl: dependencies.fetchImpl ?? fetch, timeoutMs, apiKey: secret };
}

function apiKey(env: Readonly<Record<string, string | undefined>>): string {
	const key = env.FREESOUND_API_KEY?.trim();
	if (key === undefined || key.length < 1) {
		throw new HttpError(503, 'service_unavailable', 'Freesound search is not configured.');
	}
	if (key.length > 512 || /[\r\n]/u.test(key)) {
		throw new HttpError(503, 'service_unavailable', 'Freesound search is not configured.');
	}
	return key;
}

async function fetchSound(
	context: FreesoundFunctionContext,
	upstream: UpstreamDependencies,
	id: number,
	notFound: boolean,
) {
	const url = new URL(`/apiv2/sounds/${String(id)}/`, API_ORIGIN);
	url.searchParams.set('fields', API_FIELDS);
	const source = await fetchApiJson(context, upstream, url, notFound);
	return normalizeFreesoundSound(source);
}

async function fetchApiJson(
	context: FreesoundFunctionContext,
	upstream: UpstreamDependencies,
	url: URL,
	notFound: boolean,
): Promise<unknown> {
	return withUpstreamTimeout(context.request.signal, upstream, async (signal) => {
		const response = await upstream.fetchImpl(url, {
			headers: {
				Accept: 'application/json',
				Authorization: `Token ${upstream.apiKey}`,
			},
			redirect: 'error',
			signal,
		});
		if (!response.ok) throw upstreamStatus(response.status, notFound, response.headers);
		const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
		if (!contentType.startsWith('application/json')) {
			throw new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
		}
		const bytes = await boundedBody(response, MAX_JSON_BYTES);
		try {
			return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
		} catch {
			throw new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
		}
	});
}

async function timedFetch(
	requestSignal: AbortSignal,
	upstream: UpstreamDependencies,
	url: URL,
	init: RequestInit,
): Promise<Response> {
	return withUpstreamTimeout(requestSignal, upstream, (signal) => (
		upstream.fetchImpl(url, { ...init, signal })
	));
}

async function withUpstreamTimeout<T>(
	requestSignal: AbortSignal,
	upstream: UpstreamDependencies,
	operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	let timedOut = false;
	const relayAbort = () => controller.abort(requestSignal.reason);
	if (requestSignal.aborted) relayAbort();
	else requestSignal.addEventListener('abort', relayAbort, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException('Freesound request timed out.', 'TimeoutError'));
	}, upstream.timeoutMs);
	try {
		return await operation(controller.signal);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		if (timedOut) throw new HttpError(504, 'upstream_timeout', 'Freesound did not respond in time.');
		throw new HttpError(502, 'upstream_unavailable', 'Freesound is temporarily unavailable.');
	} finally {
		clearTimeout(timer);
		requestSignal.removeEventListener('abort', relayAbort);
	}
}

async function boundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
	const declared = response.headers.get('content-length');
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
		throw new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
	}
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		length += next.value.byteLength;
		if (length > maximumBytes) {
			await reader.cancel('Response exceeded its byte limit.');
			throw new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
		}
		chunks.push(next.value);
	}
	const joined = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}

function boundedPreviewStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	let bytes = 0;
	return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			bytes += chunk.byteLength;
			if (bytes > MAX_PREVIEW_BYTES) {
				controller.error(new Error('Freesound preview exceeded its byte limit.'));
				return;
			}
			controller.enqueue(chunk);
		},
	}));
}

function assertPreviewResponse(response: Response): void {
	const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
	if (contentType !== 'audio/ogg' && contentType !== 'application/ogg' && contentType !== 'audio/vorbis') {
		throw new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid preview.');
	}
	const length = response.headers.get('content-length');
	if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_PREVIEW_BYTES)) {
		throw new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid preview.');
	}
}

function previewHeaders(source: Headers, admission: RequestAdmission, id: number): Headers {
	const headers = responseHeaders(admission.corsOrigin);
	for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
		const value = source.get(name);
		if (value !== null) headers.set(name, value);
	}
	headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
	headers.set('Content-Disposition', `inline; filename="freesound-${String(id)}-preview.ogg"`);
	headers.set('Vary', appendVary(headers.get('Vary'), 'Range'));
	return headers;
}

function upstreamStatus(status: number, notFound: boolean, headers: Headers): HttpError {
	if (notFound && status === 404) return new HttpError(404, 'sound_not_found', 'The Freesound sound was not found.');
	if (status === 429) {
		const retryAfter = safeRetryAfter(headers.get('retry-after'));
		return new HttpError(503, 'upstream_rate_limited', 'Freesound is temporarily rate limited.',
			retryAfter === null ? undefined : { 'Retry-After': retryAfter });
	}
	return new HttpError(502, 'upstream_error', 'Freesound returned an error.');
}

function searchInput(url: URL): SearchInput {
	for (const key of url.searchParams.keys()) {
		if (!['q', 'page', 'license', 'sort'].includes(key) || url.searchParams.getAll(key).length !== 1) {
			throw new HttpError(400, 'invalid_request', 'The Freesound search parameters are invalid.');
		}
	}
	const query = (url.searchParams.get('q') ?? '').trim();
	if (query.length > 200 || hasControlCharacter(query)) {
		throw new HttpError(400, 'invalid_request', 'The Freesound search query is invalid.');
	}
	const pageText = url.searchParams.get('page') ?? '1';
	if (!/^\d{1,4}$/u.test(pageText)) {
		throw new HttpError(400, 'invalid_request', 'The Freesound search page is invalid.');
	}
	const page = Number(pageText);
	if (page < 1 || page > 1_000) throw new HttpError(400, 'invalid_request', 'The Freesound search page is invalid.');
	const license = url.searchParams.get('license') ?? 'all';
	if (!Object.hasOwn(LICENSE_FILTERS, license)) {
		throw new HttpError(400, 'invalid_request', 'The Freesound license filter is invalid.');
	}
	const sort = url.searchParams.get('sort') ?? 'relevance';
	if (!Object.hasOwn(SORTS, sort)) {
		throw new HttpError(400, 'invalid_request', 'The Freesound sort is invalid.');
	}
	return { query, page, license: license as SearchInput['license'], sort: sort as SearchInput['sort'] };
}

function soundId(value: string | string[] | undefined): number {
	if (typeof value !== 'string' || !/^[1-9]\d{0,14}$/u.test(value)) {
		throw new HttpError(400, 'invalid_request', 'The Freesound sound ID is invalid.');
	}
	const id = Number(value);
	if (!Number.isSafeInteger(id)) throw new HttpError(400, 'invalid_request', 'The Freesound sound ID is invalid.');
	return id;
}

function byteRange(value: string | null): string | null {
	if (value === null) return null;
	if (value.length > 80) throw new HttpError(416, 'invalid_range', 'The preview byte range is invalid.');
	const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
	if (match === null || (match[1] === '' && match[2] === '')) {
		throw new HttpError(416, 'invalid_range', 'The preview byte range is invalid.');
	}
	const start = match[1] === '' ? null : Number(match[1]);
	const end = match[2] === '' ? null : Number(match[2]);
	if (
		(start !== null && !Number.isSafeInteger(start))
		|| (end !== null && (!Number.isSafeInteger(end) || end < 0))
		|| (start === null && end === 0)
		|| (start !== null && end !== null && start > end)
	) {
		throw new HttpError(416, 'invalid_range', 'The preview byte range is invalid.');
	}
	return value;
}

function assertAllowedHost(url: URL, env: Readonly<Record<string, string | undefined>>): void {
	const production = url.protocol === 'https:' && url.hostname === 'soundscaper.org' && url.port === '';
	const preview = url.protocol === 'https:'
		&& (url.hostname === 'soundscaper.pages.dev' || url.hostname.endsWith('.soundscaper.pages.dev'))
		&& url.port === '';
	const local = env.FREESOUND_LOCAL_DEVELOPMENT === '1'
		&& url.protocol === 'http:'
		&& (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	if (!production && !preview && !local) throw new HttpError(404, 'not_found', 'The requested route was not found.');
}

function allowedCorsOrigin(request: Request): string | null {
	const origin = request.headers.get('origin');
	if (origin === null) return null;
	if (origin === WEB_ORIGIN || origin === DESKTOP_ORIGIN || origin === new URL(request.url).origin) return origin;
	throw new HttpError(403, 'origin_forbidden', 'The request origin is not allowed.');
}

function preflight(corsOrigin: string | null): Response {
	const headers = responseHeaders(corsOrigin);
	headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Range');
	headers.set('Access-Control-Max-Age', '86400');
	headers.set('Cache-Control', 'no-store');
	return new Response(null, { status: 204, headers });
}

function json(
	value: unknown,
	status: number,
	admission: RequestAdmission,
	cacheControl: string,
): Response {
	const headers = responseHeaders(admission.corsOrigin);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Cache-Control', cacheControl);
	return new Response(admission.head ? null : JSON.stringify(value), { status, headers });
}

function jsonError(error: HttpError, corsOrigin: string | null): Response {
	const headers = responseHeaders(corsOrigin);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Cache-Control', 'no-store');
	if (error.responseHeaders !== undefined) {
		const extra = new Headers(error.responseHeaders);
		extra.forEach((value, name) => headers.set(name, value));
	}
	return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
		status: error.status,
		headers,
	});
}

function responseHeaders(corsOrigin: string | null): Headers {
	const headers = new Headers({
		'X-Content-Type-Options': 'nosniff',
		Vary: 'Origin',
	});
	if (corsOrigin !== null) {
		headers.set('Access-Control-Allow-Origin', corsOrigin);
		headers.set(
			'Access-Control-Expose-Headers',
			'Accept-Ranges, Content-Disposition, Content-Length, Content-Range, ETag, Last-Modified',
		);
	}
	return headers;
}

function publicError(error: unknown): HttpError {
	if (error instanceof HttpError) return error;
	if (error instanceof FreesoundContractError) {
		return new HttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
	}
	return new HttpError(500, 'internal_error', 'The Freesound request could not be completed.');
}

function safeRetryAfter(value: string | null): string | null {
	if (value === null || !/^\d{1,4}$/u.test(value)) return null;
	const seconds = Number(value);
	return seconds <= 3_600 ? String(seconds) : null;
}

function appendVary(current: string | null, value: string): string {
	return current === null ? value : `${current}, ${value}`;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}
