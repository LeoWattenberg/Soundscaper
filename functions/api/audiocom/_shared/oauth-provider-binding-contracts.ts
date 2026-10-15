/* SPDX-License-Identifier: AGPL-3.0-only */

/** The issuer registration used to create a grant stays fixed for its lifetime. */
export interface AudiocomOAuthProviderBinding {
	readonly apiOrigin: string;
	readonly clientId: string;
	readonly redirectUri: string;
	readonly scope: 'public' | 'public projects';
}

const FIELDS = ['apiOrigin', 'clientId', 'redirectUri', 'scope'];
const CALLBACK_PATH = '/api/audiocom/oauth/callback';

/** NULL predates provider selection and retains the default audio.com binding. */
export function parseStoredProviderBinding(value: unknown): AudiocomOAuthProviderBinding | undefined {
	if (value === null || value === undefined) return undefined;
	let source: unknown = value;
	if (typeof source === 'string') {
		if (source.length > 8_192) invalid();
		try { source = JSON.parse(source) as unknown; } catch { return invalid(); }
	}
	if (typeof source !== 'object' || source === null || Array.isArray(source)) invalid();
	const binding = source as Record<string, unknown>;
	if (Object.keys(binding).length !== FIELDS.length || Object.keys(binding).some(field => !FIELDS.includes(field))) invalid();
	const apiOrigin = bindingText(binding.apiOrigin, 2_048);
	const clientId = bindingText(binding.clientId, 256);
	const redirectUri = bindingText(binding.redirectUri, 2_048);
	const api = bindingUrl(apiOrigin);
	const callback = bindingUrl(redirectUri);
	if (apiOrigin !== api.origin || callback.pathname !== CALLBACK_PATH
		|| redirectUri !== callback.href || (binding.scope !== 'public' && binding.scope !== 'public projects')) invalid();
	return { apiOrigin, clientId, redirectUri, scope: binding.scope };
}

function bindingText(value: unknown, limit: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > limit
		|| [...value].some(character => { const code = character.codePointAt(0) ?? 0; return code <= 0x20 || code === 0x7f; })) invalid();
	return value;
}

function bindingUrl(value: string): URL {
	let url: URL;
	try { url = new URL(value); } catch { return invalid(); }
	const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) invalid();
	return url;
}

function invalid(): never { throw new TypeError('Invalid stored audio provider binding.'); }
