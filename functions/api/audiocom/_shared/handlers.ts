/* SPDX-License-Identifier: AGPL-3.0-only */
import { MAX_UPLOAD_BYTES, normalizeAudio, parseUploadInput, record, trustedAssetUrl, trustedHookUrl, trustedUploadUrl } from './contracts.ts';
import { accessTokenForSession, authorizeAudiocomSession, type OAuthHandlerDependencies } from './oauth-handlers.ts';
import { handleOAuthEndpoint, oauthJson, oauthResponseHeaders, OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import { exactUploadStream, limitedPreviewStream } from './streams.ts';
import { providerConfiguration } from './provider-config.ts';
import { discoverAudiocityCapabilities } from './provider-discovery.ts';
import { providerFetch, checkResponse } from './provider-fetch.ts';
export { providerFetch, checkResponse } from './provider-fetch.ts';
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
		const provider = providerConfiguration(context.env);
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const upstream = new URL(library ? '/v1/audio/list' : '/v1/search', provider.apiOrigin);
		upstream.searchParams.set('page', pageValue);
		if (library) upstream.searchParams.set('per-page', '10');
		else { upstream.searchParams.set('query', search); upstream.searchParams.set('types', 'audio'); }
		const response = await providerFetch(context, dependencies, upstream, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
		await checkResponse(response, authorized, dependencies);
		const items = await readUpstreamJson(response, 1024 * 1024);
		if (!Array.isArray(items) || items.length > 10) throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned invalid search results.');
		const results = items.map(item => {
			if (library) return normalizeAudio(item, provider);
			const hit = record(item);
			if (hit.type !== 'audio') throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned an unexpected search result.');
			return normalizeAudio(hit.model, provider);
		});
		return oauthJson({ data: { results, page, hasNext: items.length === 10 } }, 200, admission);
	});
}
export function handleAudiocomUploadRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['POST'], async admission => {
		const input = parseUploadInput(context.request);
		const provider = providerConfiguration(context.env);
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		const created = await providerFetch(context, dependencies, new URL('/v1/audio/create', provider.apiOrigin), {
			method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
		});
		await checkResponse(created, authorized, dependencies);
		const policy = record(await readUpstreamJson(created));
		const destination = trustedUploadUrl(policy.url, provider);
		const success = trustedHookUrl(policy.success, provider, 'success');
		const fail = trustedHookUrl(policy.fail, provider, 'fail');
		let audio = normalizeAudio(policy.audio, provider);
		try {
			const transfer = exactUploadStream(context.request.body, input.size);
			const uploaded = await providerFetch(context, dependencies, destination, {
				method: 'PUT', headers: { 'Content-Type': input.mime, 'Content-Length': String(input.size) }, body: transfer.body,
			}, true);
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
		if (provider.kind === 'audiocity') {
			// Audiocity's success hook commits the original synchronously. Refresh its
			// initially pending metadata without turning a completed upload into a retry.
			try {
				const url = new URL('/v1/audio/view', provider.apiOrigin);
				url.searchParams.set('id', audio.id);
				const refreshed = await providerFetch(context, dependencies, url, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
				await checkResponse(refreshed, authorized, dependencies);
				const ready = normalizeAudio(await readUpstreamJson(refreshed), provider);
				if (ready.id === audio.id) audio = ready;
			} catch { /* The committed upload and its share URL remain valid. */ }
		}
		return oauthJson({ data: { audio, processing: provider.kind !== 'audiocity' } }, 201, admission);
	});
}
export function handleAudiocomUsageRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async admission => {
		const provider = providerConfiguration(context.env);
		const capabilities = await discoverAudiocityCapabilities(context, dependencies);
		return oauthJson({ data: {
			maximumUploadBytes: Math.min(MAX_UPLOAD_BYTES, capabilities.maximumUploadBytes),
			providerMaximumUploadBytes: capabilities.maximumUploadBytes, provider,
			projectStorageSupported: capabilities.projectFormats.length > 0, projectFormats: capabilities.projectFormats,
		} }, 200, admission);
	});
}
export function handleAudiocomPreviewRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'HEAD'], async admission => {
		const query = new URL(context.request.url).searchParams;
		if (query.size !== 1 || !query.has('url')) throw new OAuthHttpError(400, 'invalid_request', 'Invalid audio.com preview.');
		const provider = providerConfiguration(context.env);
		let upstream: URL;
		try { upstream = trustedAssetUrl(query.get('url'), provider); }
		catch { throw new OAuthHttpError(400, 'invalid_request', 'Invalid audio.com preview URL.'); }
		await authorizeAudiocomSession(context, dependencies);
		const headers = new Headers();
		const range = context.request.headers.get('Range');
		if (range !== null) {
			const match = /^bytes=(\d{1,12})-(\d{0,12})$/u.exec(range);
			if (match === null || (match[2] !== '' && Number(match[1]) > Number(match[2]))) throw new OAuthHttpError(416, 'invalid_range', 'Invalid preview range.');
			headers.set('Range', range);
		}
		const response = await providerFetch(context, dependencies, upstream, { method: admission.head ? 'HEAD' : 'GET', headers }, true);
		if (![200, 206].includes(response.status)) { await response.body?.cancel(); throw new OAuthHttpError(502, 'preview_unavailable', 'audio.com preview is unavailable.'); }
		const type = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
		const length = response.headers.get('Content-Length');
		if ((!type.startsWith('audio/') && !(provider.kind === 'audiocity' && type === 'application/ogg')) || (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_PREVIEW_BYTES))) {
			await response.body?.cancel(); throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned an invalid preview.');
		}
		const returned = oauthResponseHeaders(admission.corsOrigin);
		returned.set('Cache-Control', 'private, no-store');
		returned.set('Content-Type', type);
		for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges']) { const value = response.headers.get(key); if (value !== null) returned.set(key, value); }
		return new Response(admission.head || response.body === null ? null : limitedPreviewStream(response.body, MAX_PREVIEW_BYTES), { status: response.status, headers: returned });
	});
}
