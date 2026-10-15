/* SPDX-License-Identifier: AGPL-3.0-only */

const OAUTH_PARAMETERS = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method'];

export function assertAudiocomAuthorizationUrl(value: unknown): string {
	try {
		if (typeof value !== 'string' || value.length > 4096) throw new TypeError();
		const url = new URL(value);
		if (`${url.origin}${url.pathname}` !== 'https://api.audio.com/auth/authorize'
			|| url.username || url.password || url.hash
			|| [...url.searchParams.keys()].some((key) => !OAUTH_PARAMETERS.includes(key))
			|| OAUTH_PARAMETERS.some((key) => url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key))
			|| url.searchParams.get('response_type') !== 'code' || url.searchParams.get('scope') !== 'public'
			|| url.searchParams.get('redirect_uri') !== 'https://soundscaper.org/api/audiocom/oauth/callback'
			|| url.searchParams.get('code_challenge_method') !== 'S256'
			|| !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('code_challenge') ?? '')) throw new TypeError();
		return url.href;
	} catch { throw new TypeError('Invalid audio.com authorization URL'); }
}
