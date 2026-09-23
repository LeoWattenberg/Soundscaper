/* SPDX-License-Identifier: AGPL-3.0-only */

import { FreesoundOAuthContractError } from './oauth-contracts.ts';
import type { D1DatabaseLike } from './oauth-repository.ts';

export type FreesoundOAuthEnv = Readonly<{
	FREESOUND_OAUTH_DB?: D1DatabaseLike;
	FREESOUND_API_KEY?: string;
	FREESOUND_CLIENT_ID?: string;
	FREESOUND_CLIENT_SECRET?: string;
	FREESOUND_OAUTH_MASTER_KEY?: string;
	FREESOUND_OAUTH_REDIRECT_URI?: string;
	FREESOUND_LOCAL_DEVELOPMENT?: string;
}>;

export interface FreesoundOAuthFunctionContext {
	readonly request: Request;
	readonly env: FreesoundOAuthEnv;
	readonly params: Readonly<Record<string, string | string[]>>;
}

export interface RequestAdmission {
	readonly corsOrigin: string | null;
	readonly head: boolean;
}

export class OAuthHttpError extends Error {
	public readonly status: number;
	public readonly code: string;
	public readonly responseHeaders: HeadersInit | undefined;

	public constructor(status: number, code: string, message: string, responseHeaders?: HeadersInit) {
		super(message);
		this.name = 'OAuthHttpError';
		this.status = status;
		this.code = code;
		this.responseHeaders = responseHeaders;
	}
}

const DESKTOP_ORIGIN = 'soundscaper-app://bundle';
const WEB_ORIGIN = 'https://soundscaper.org';
const MAX_JSON_BYTES = 128 * 1024;
export const SESSION_COOKIE = '__Host-freesound_session';

export async function handleOAuthEndpoint(
	context: FreesoundOAuthFunctionContext,
	methods: readonly string[],
	handler: (admission: RequestAdmission) => Promise<Response>,
): Promise<Response> {
	let corsOrigin: string | null = null;
	try {
		assertAllowedHost(new URL(context.request.url), context.env);
		corsOrigin = allowedCorsOrigin(context.request);
		if (context.request.method === 'OPTIONS') return preflight(corsOrigin, methods);
		if (!methods.includes(context.request.method)) {
			throw new OAuthHttpError(405, 'method_not_allowed', 'The request method is not supported.', {
				Allow: [...methods, 'OPTIONS'].join(', '),
			});
		}
		if (!['GET', 'HEAD'].includes(context.request.method)) requireMutationOrigin(context.request, corsOrigin);
		return await handler({ corsOrigin, head: context.request.method === 'HEAD' });
	} catch (error) {
		return oauthJsonError(publicOAuthError(error), corsOrigin);
	}
}

export function assertAllowedHost(url: URL, env: FreesoundOAuthEnv): void {
	const production = url.protocol === 'https:' && url.hostname === 'soundscaper.org' && url.port === '';
	const preview = url.protocol === 'https:'
		&& (url.hostname === 'soundscaper.pages.dev' || url.hostname.endsWith('.soundscaper.pages.dev'))
		&& url.port === '';
	const local = env.FREESOUND_LOCAL_DEVELOPMENT === '1'
		&& url.protocol === 'http:'
		&& (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	if (!production && !preview && !local) {
		throw new OAuthHttpError(404, 'not_found', 'The requested route was not found.');
	}
}

export function allowedCorsOrigin(request: Request): string | null {
	const origin = request.headers.get('origin');
	if (origin === null) return null;
	if (origin === WEB_ORIGIN || origin === DESKTOP_ORIGIN || origin === new URL(request.url).origin) return origin;
	throw new OAuthHttpError(403, 'origin_forbidden', 'The request origin is not allowed.');
}

export function requireMutationOrigin(request: Request, corsOrigin: string | null): void {
	if (corsOrigin === null) throw new OAuthHttpError(403, 'origin_required', 'A trusted request origin is required.');
	const fetchSite = request.headers.get('sec-fetch-site');
	if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') {
		throw new OAuthHttpError(403, 'origin_forbidden', 'The request origin is not allowed.');
	}
}

export async function readJsonBody(request: Request): Promise<unknown> {
	const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
	if (type !== 'application/json') {
		throw new OAuthHttpError(415, 'unsupported_media_type', 'The request must contain JSON.');
	}
	const bytes = await boundedBody(request.body, request.headers.get('content-length'), MAX_JSON_BYTES, 413);
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw new OAuthHttpError(400, 'invalid_request', 'The request JSON is invalid.');
	}
}

export async function readUpstreamJson(response: Response, maximumBytes = MAX_JSON_BYTES): Promise<unknown> {
	const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
	if (type !== 'application/json') {
		throw new OAuthHttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
	}
	const bytes = await boundedBody(response.body, response.headers.get('content-length'), maximumBytes, 502);
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw new OAuthHttpError(502, 'invalid_upstream_response', 'Freesound returned an invalid response.');
	}
}

export function oauthJson(
	value: unknown,
	status: number,
	admission: RequestAdmission,
	extraHeaders?: HeadersInit,
): Response {
	const headers = oauthResponseHeaders(admission.corsOrigin);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Cache-Control', 'no-store');
	if (extraHeaders !== undefined) new Headers(extraHeaders).forEach((value, name) => headers.set(name, value));
	return new Response(admission.head ? null : JSON.stringify(value), { status, headers });
}

export function oauthJsonError(error: OAuthHttpError, corsOrigin: string | null): Response {
	const headers = oauthResponseHeaders(corsOrigin);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Cache-Control', 'no-store');
	if (error.responseHeaders !== undefined) {
		new Headers(error.responseHeaders).forEach((value, name) => headers.set(name, value));
	}
	return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
		status: error.status,
		headers,
	});
}

export function oauthResponseHeaders(corsOrigin: string | null): Headers {
	const headers = new Headers({
		'X-Content-Type-Options': 'nosniff',
		Vary: 'Origin',
	});
	if (corsOrigin !== null) {
		headers.set('Access-Control-Allow-Origin', corsOrigin);
		headers.set('Access-Control-Allow-Credentials', 'true');
		headers.set(
			'Access-Control-Expose-Headers',
			'Content-Disposition, Content-Length, X-Freesound-Original-Bytes',
		);
	}
	return headers;
}

export function sessionCookie(token: string, maximumAgeSeconds: number): string {
	return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${String(maximumAgeSeconds)}; Secure; HttpOnly; SameSite=Strict`;
}

export function expiredSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

export function requestSessionToken(request: Request): Readonly<{ token: string; transport: 'cookie' | 'bearer' }> {
	const authorization = request.headers.get('authorization');
	const bearer = authorization === null ? null : /^Bearer ([A-Za-z0-9_-]{32,128})$/u.exec(authorization)?.[1] ?? null;
	const cookie = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
	if (authorization !== null && bearer === null) {
		throw new OAuthHttpError(401, 'authentication_required', 'Connect to Freesound to continue.');
	}
	if ((bearer === null) === (cookie === null)) {
		throw new OAuthHttpError(401, 'authentication_required', 'Connect to Freesound to continue.');
	}
	return bearer === null ? { token: cookie as string, transport: 'cookie' } : { token: bearer, transport: 'bearer' };
}

export function publicOAuthError(error: unknown): OAuthHttpError {
	if (error instanceof OAuthHttpError) return error;
	if (error instanceof FreesoundOAuthContractError) {
		return new OAuthHttpError(400, 'invalid_request', error.message);
	}
	return new OAuthHttpError(500, 'internal_error', 'The Freesound request could not be completed.');
}

export function configuredSecret(value: string | undefined, label: string, maximum = 4_096): string {
	const secret = value?.trim();
	if (secret === undefined || secret.length === 0 || secret.length > maximum || /[\r\n]/u.test(secret)) {
		throw new OAuthHttpError(503, 'service_unavailable', `Freesound ${label} is not configured.`);
	}
	return secret;
}

async function boundedBody(
	body: ReadableStream<Uint8Array> | null,
	declaredLength: string | null,
	maximumBytes: number,
	overflowStatus: number,
): Promise<Uint8Array<ArrayBuffer>> {
	if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
		throw new OAuthHttpError(overflowStatus, 'payload_too_large', 'The response or request is too large.');
	}
	if (body === null) return new Uint8Array();
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		length += next.value.byteLength;
		if (length > maximumBytes) {
			await reader.cancel('Body exceeded its byte limit.');
			throw new OAuthHttpError(overflowStatus, 'payload_too_large', 'The response or request is too large.');
		}
		chunks.push(next.value);
	}
	const result = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function preflight(corsOrigin: string | null, methods: readonly string[]): Response {
	const headers = oauthResponseHeaders(corsOrigin);
	headers.set('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
	headers.set(
		'Access-Control-Allow-Headers',
		'Authorization, Content-Type, Range, X-Freesound-Content-Length, X-Freesound-Filename',
	);
	headers.set('Access-Control-Max-Age', '86400');
	headers.set('Cache-Control', 'no-store');
	return new Response(null, { status: 204, headers });
}

function cookieValue(header: string | null, name: string): string | null {
	if (header === null || header.length > 8_192) return null;
	let result: string | null = null;
	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
		const value = part.slice(separator + 1).trim();
		if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value) || result !== null) {
			throw new OAuthHttpError(401, 'authentication_required', 'Connect to Freesound to continue.');
		}
		result = value;
	}
	return result;
}
