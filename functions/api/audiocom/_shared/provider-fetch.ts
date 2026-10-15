/* SPDX-License-Identifier: AGPL-3.0-only */
import { invalidateAuthorizedAudiocomSession, type AuthorizedAudiocomSession, type OAuthHandlerDependencies } from './oauth-handlers.ts';
import { OAuthHttpError, type AudiocomOAuthFunctionContext } from './oauth-http.ts';

/** Control requests have a deadline; streaming media follows caller cancellation. */
export async function providerFetch(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies, url: URL, init: RequestInit, streaming = false): Promise<Response> {
	const options: RequestInit & { duplex?: 'half' } = {
		...init, redirect: 'manual',
		signal: streaming ? context.request.signal : AbortSignal.any([context.request.signal, AbortSignal.timeout(10_000)]),
	};
	// Node's fetch requires this standard streaming request mode; Workers ignores the extra dictionary member.
	if (init.body instanceof ReadableStream) options.duplex = 'half';
	try { return await (dependencies.fetchImpl ?? fetch)(url, options); }
	catch (error) {
		if (error instanceof OAuthHttpError) throw error;
		throw new OAuthHttpError(502, 'upstream_unavailable', 'The audio provider is temporarily unavailable.');
	}
}
export async function checkResponse(response: Response, authorized: AuthorizedAudiocomSession, dependencies: OAuthHandlerDependencies): Promise<void> {
	if (response.ok) return;
	await response.body?.cancel();
	if (response.status === 401) {
		await invalidateAuthorizedAudiocomSession(authorized, dependencies);
		throw new OAuthHttpError(401, 'authentication_expired', 'Reconnect the audio provider to continue.');
	}
	if (response.status === 429) throw new OAuthHttpError(429, 'rate_limited', 'The audio provider is temporarily rate limited.', { 'Retry-After': '60' });
	if ([403, 413, 422].includes(response.status)) throw new OAuthHttpError(response.status, 'upload_rejected', 'The audio provider rejected the request. Check your account limits and audio metadata.');
	throw new OAuthHttpError(502, 'upstream_error', 'The audio provider could not complete the request.');
}
