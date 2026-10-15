/* SPDX-License-Identifier: AGPL-3.0-only */
import { MAX_UPLOAD_BYTES, normalizeAudio, parseUploadInput, record, trustedAssetUrl, trustedHookUrl } from './contracts.ts';
import { accessTokenForSession, authorizeAudiocomSession, invalidateAuthorizedAudiocomSession, type AuthorizedAudiocomSession, type OAuthHandlerDependencies } from './oauth-handlers.ts';
import { handleOAuthEndpoint, oauthJson, oauthResponseHeaders, OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import { exactUploadStream, limitedPreviewStream } from './streams.ts';

const API_ORIGIN = 'https://api.audio.com';
const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;

export function handleAudiocomSearchRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return listRequest(context, dependencies, false);
}
export function handleAudiocomLibraryRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return listRequest(context, dependencies, true);
}
async function listRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies, library: boolean): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async admission => {
		const query = new URL(context.request.url).searchParams;
		const allowed = library ? ['page'] : ['q', 'page'];
		if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) throw new OAuthHttpError(400, 'invalid_request', 'Invalid search parameters.');
		const pageValue = query.get('page') ?? '1';
		if (!/^[1-9]\d{0,5}$/u.test(pageValue)) throw new OAuthHttpError(400, 'invalid_request', 'Invalid search page.');
		const page = Number(pageValue);
		const search = query.get('q')?.trim() ?? '';
		if (search.length > 256) throw new OAuthHttpError(400, 'invalid_request', 'The search query is too long.');
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const upstream = new URL(library ? '/v1/audio/list' : '/v1/search', API_ORIGIN);
		upstream.searchParams.set('page', pageValue);
		if (library) upstream.searchParams.set('per-page', '10');
		else { upstream.searchParams.set('query', search); upstream.searchParams.set('types', 'audio'); }
		const response = await providerFetch(context, dependencies, upstream, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
		await checkResponse(response, authorized, dependencies);
		const items = await readUpstreamJson(response, 1024 * 1024);
		if (!Array.isArray(items) || items.length > 10) throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned invalid search results.');
		const results = items.map(item => {
			if (library) return normalizeAudio(item);
			const hit = record(item);
			if (hit.type !== 'audio') throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned an unexpected search result.');
			return normalizeAudio(hit.model);
		});
		return oauthJson({ data: { results, page, hasNext: items.length === 10 } }, 200, admission);
	});
}
export function handleAudiocomUploadRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['POST'], async admission => {
		const input = parseUploadInput(context.request);
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const created = await providerFetch(context, dependencies, new URL('/v1/audio/create', API_ORIGIN), {
			method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
		});
		await checkResponse(created, authorized, dependencies);
		const policy = record(await readUpstreamJson(created));
		const destination = trustedAssetUrl(policy.url);
		const success = trustedHookUrl(policy.success);
		const fail = trustedHookUrl(policy.fail);
		const audio = normalizeAudio(policy.audio);
		try {
			const transfer = exactUploadStream(context.request.body, input.size);
			const uploaded = await providerFetch(context, dependencies, destination, {
				method: 'PUT', headers: { 'Content-Type': input.mime, 'Content-Length': String(input.size) }, body: transfer.body,
			});
			if (!uploaded.ok) throw new OAuthHttpError(502, 'upload_failed', 'audio.com could not receive the audio file.');
			await uploaded.body?.cancel();
			await transfer.completed;
			const confirmed = await providerFetch(context, dependencies, success, { method: 'POST' });
			await checkResponse(confirmed, authorized, dependencies);
			await confirmed.body?.cancel();
		} catch (error) {
			// The signed failure hook removes the incomplete source; never attach OAuth to storage URLs.
			try {
				const failed = await (dependencies.fetchImpl ?? fetch)(fail, { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
				await failed.body?.cancel();
			} catch { /* Cleanup is best-effort after a failed or cancelled transfer. */ }
			throw error;
		}
		return oauthJson({ data: { audio, processing: true } }, 201, admission);
	});
}
export function handleAudiocomUsageRequest(context: AudiocomOAuthFunctionContext): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async admission => oauthJson({ data: {
		maximumUploadBytes: MAX_UPLOAD_BYTES, providerMaximumUploadBytes: 1_073_741_824,
		projectStorageSupported: false,
	} }, 200, admission));
}
export function handleAudiocomPreviewRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async admission => {
		const query = new URL(context.request.url).searchParams;
		if (query.size !== 1 || !query.has('url')) throw new OAuthHttpError(400, 'invalid_request', 'Invalid audio.com preview.');
		let upstream: URL;
		try { upstream = trustedAssetUrl(query.get('url')); }
		catch { throw new OAuthHttpError(400, 'invalid_request', 'Invalid audio.com preview URL.'); }
		await authorizeAudiocomSession(context, dependencies);
		const headers = new Headers();
		const range = context.request.headers.get('Range');
		if (range !== null) {
			const match = /^bytes=(\d{1,12})-(\d{0,12})$/u.exec(range);
			if (match === null || (match[2] !== '' && Number(match[1]) > Number(match[2]))) throw new OAuthHttpError(416, 'invalid_range', 'Invalid preview range.');
			headers.set('Range', range);
		}
		const response = await providerFetch(context, dependencies, upstream, { method: admission.head ? 'HEAD' : 'GET', headers });
		if (![200, 206].includes(response.status)) { await response.body?.cancel(); throw new OAuthHttpError(502, 'preview_unavailable', 'audio.com preview is unavailable.'); }
		const type = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
		const length = response.headers.get('Content-Length');
		if (!type.startsWith('audio/') || (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_PREVIEW_BYTES))) {
			await response.body?.cancel(); throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned an invalid preview.');
		}
		const returned = oauthResponseHeaders(admission.corsOrigin);
		returned.set('Cache-Control', 'private, no-store');
		returned.set('Content-Type', type);
		for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges']) { const value = response.headers.get(key); if (value !== null) returned.set(key, value); }
		return new Response(admission.head || response.body === null ? null : limitedPreviewStream(response.body, MAX_PREVIEW_BYTES), { status: response.status, headers: returned });
	});
}
async function providerFetch(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies, url: URL, init: RequestInit): Promise<Response> {
	const signal = url.origin === API_ORIGIN
		? AbortSignal.any([context.request.signal, AbortSignal.timeout(10_000)])
		: context.request.signal;
	try { return await (dependencies.fetchImpl ?? fetch)(url, { ...init, redirect: 'manual', signal }); }
	catch (error) {
		if (error instanceof OAuthHttpError) throw error;
		throw new OAuthHttpError(502, 'upstream_unavailable', 'audio.com is temporarily unavailable.');
	}
}
async function checkResponse(response: Response, authorized: AuthorizedAudiocomSession, dependencies: OAuthHandlerDependencies): Promise<void> {
	if (response.ok) return;
	await response.body?.cancel();
	if (response.status === 401) {
		await invalidateAuthorizedAudiocomSession(authorized, dependencies);
		throw new OAuthHttpError(401, 'authentication_expired', 'Reconnect audio.com to continue.');
	}
	if (response.status === 429) throw new OAuthHttpError(429, 'rate_limited', 'audio.com is temporarily rate limited.', { 'Retry-After': '60' });
	if ([403, 413, 422].includes(response.status)) throw new OAuthHttpError(response.status, 'upload_rejected', 'audio.com rejected the request. Check your account limits and audio metadata.');
	throw new OAuthHttpError(502, 'upstream_error', 'audio.com could not complete the request.');
}
