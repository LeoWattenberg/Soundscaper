/* SPDX-License-Identifier: AGPL-3.0-only */
import { isSoundscaperPreviewUrl, OAuthHttpError, type AudiocomOAuthFunctionContext } from './oauth-http.ts';

/** Registered application callbacks are administrator-owned, never request parameters. */
export function oauthRedirectUri(context: AudiocomOAuthFunctionContext): string {
	const requestUrl = new URL(context.request.url);
	const configured = context.env.AUDIOCOM_OAUTH_REDIRECT_URI?.trim();
	const preview = isSoundscaperPreviewUrl(requestUrl);
	if (preview && !configured) {
		throw new OAuthHttpError(503, 'oauth_unavailable_in_preview', 'audio.com sign-in is not configured for this preview.');
	}
	let url: URL;
	try { url = new URL(configured || new URL('/api/audiocom/oauth/callback', requestUrl).href); }
	catch { throw unavailable(); }
	const local = context.env.AUDIOCOM_LOCAL_DEVELOPMENT === '1'
		&& requestUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(requestUrl.hostname)
		&& url.origin === requestUrl.origin;
	const production = !preview && requestUrl.origin === 'https://soundscaper.org' && url.origin === requestUrl.origin;
	if ((!local && !production && !(preview && isSoundscaperPreviewUrl(url)))
		|| url.username || url.password || url.hash || url.search || url.pathname !== '/api/audiocom/oauth/callback') {
		throw unavailable();
	}
	return url.href;
}

function unavailable(): OAuthHttpError {
	return new OAuthHttpError(503, 'service_unavailable', 'audio.com OAuth redirect is not configured.');
}
