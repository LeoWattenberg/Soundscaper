/* SPDX-License-Identifier: AGPL-3.0-only */
export type AudiocomOAuthClientKind = 'web' | 'desktop';
export interface AudiocomOAuthUser { readonly id: string; readonly username: string }
export interface AudiocomTokenPair {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresInSeconds: number;
}
export class AudiocomOAuthContractError extends Error {
	constructor(message: string, readonly diagnosticCode = 'invalid_upstream_response') { super(message); }
}

export function parseOAuthStartInput(value: unknown): Readonly<{ client: AudiocomOAuthClientKind }> {
	const source = exact(value, ['client']);
	if (source.client !== 'web' && source.client !== 'desktop') throw new AudiocomOAuthContractError('Invalid OAuth client.');
	return { client: source.client };
}
export function parseOAuthPollInput(value: unknown): Readonly<{ attemptId: string; handoffToken: string }> {
	const source = exact(value, ['attemptId', 'handoffToken']);
	return { attemptId: capability(source.attemptId), handoffToken: capability(source.handoffToken) };
}
export function normalizeTokenPair(value: unknown, requiredScopes: readonly string[] = ['public']): AudiocomTokenPair {
	const source = record(value);
	if (typeof source.token_type !== 'string' || source.token_type.toLowerCase() !== 'bearer') throw new AudiocomOAuthContractError('Invalid OAuth token type.', 'oauth_token_type_invalid');
	if (typeof source.scope === 'string' && requiredScopes.some(scope => !(source.scope as string).split(' ').includes(scope))) throw new AudiocomOAuthContractError('Missing requested OAuth scope.', 'oauth_token_scope_missing');
	if (!Number.isSafeInteger(source.expires_in) || Number(source.expires_in) < 60) {
		throw new AudiocomOAuthContractError('Invalid OAuth expiry.', 'oauth_token_expiry_invalid');
	}
	// A longer issuer lifetime is valid. Refresh conservatively within one week
	// rather than rejecting the authorization or extending local session policy.
	return { accessToken: credential(source.access_token), refreshToken: credential(source.refresh_token), expiresInSeconds: Math.min(Number(source.expires_in), 604_800) };
}
function credential(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 8192 || /[\r\n]/u.test(value)) throw new AudiocomOAuthContractError('Invalid OAuth credentials.', 'oauth_token_credentials_invalid');
	return value;
}
function capability(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/u.test(value)) throw new AudiocomOAuthContractError('Invalid OAuth capability.');
	return value;
}
function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AudiocomOAuthContractError('Expected a JSON object.');
	return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
	const source = record(value);
	if (Object.keys(source).length !== keys.length || Object.keys(source).some(key => !keys.includes(key))) throw new AudiocomOAuthContractError('Unexpected request fields.');
	return source;
}
