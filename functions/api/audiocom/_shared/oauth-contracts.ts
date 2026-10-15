/* SPDX-License-Identifier: AGPL-3.0-only */
export type AudiocomOAuthClientKind = 'web' | 'desktop';
export interface AudiocomOAuthUser { readonly id: string; readonly username: string }
export interface AudiocomTokenPair {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresInSeconds: number;
}
export class AudiocomOAuthContractError extends Error {}

export function parseOAuthStartInput(value: unknown): Readonly<{ client: AudiocomOAuthClientKind }> {
	const source = exact(value, ['client']);
	if (source.client !== 'web' && source.client !== 'desktop') throw new AudiocomOAuthContractError('Invalid OAuth client.');
	return { client: source.client };
}
export function parseOAuthPollInput(value: unknown): Readonly<{ attemptId: string; handoffToken: string }> {
	const source = exact(value, ['attemptId', 'handoffToken']);
	return { attemptId: capability(source.attemptId), handoffToken: capability(source.handoffToken) };
}
export function normalizeTokenPair(value: unknown): AudiocomTokenPair {
	const source = record(value);
	if (source.token_type !== 'Bearer' && source.token_type !== 'bearer') throw new AudiocomOAuthContractError('Invalid OAuth token type.');
	if (typeof source.scope === 'string' && !source.scope.split(' ').includes('public')) throw new AudiocomOAuthContractError('Missing public OAuth scope.');
	if (!Number.isSafeInteger(source.expires_in) || Number(source.expires_in) < 60 || Number(source.expires_in) > 604_800) {
		throw new AudiocomOAuthContractError('Invalid OAuth expiry.');
	}
	return { accessToken: credential(source.access_token), refreshToken: credential(source.refresh_token), expiresInSeconds: Number(source.expires_in) };
}
function credential(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 8192 || /[\r\n]/u.test(value)) throw new AudiocomOAuthContractError('Invalid OAuth credentials.');
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
