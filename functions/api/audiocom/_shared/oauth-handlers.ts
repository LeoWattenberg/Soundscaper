/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	parseOAuthPollInput,
	parseOAuthStartInput,
} from './oauth-contracts.ts';
import { exchangeAuthorizationCode, refreshAccessToken } from './oauth-provider.ts';
import {
	constantTimeEqual,
	decryptOAuthSecret,
	encryptOAuthSecret,
	hashCapability,
	randomCapability,
} from './oauth-crypto.ts';
import {
	assertAllowedHost,
	configuredSecret,
	expiredSessionCookie,
	handleOAuthEndpoint,
	oauthJson,
	OAuthHttpError,
	publicOAuthError,
	readJsonBody,
	requestSessionToken,
	sessionCookie,
	type AudiocomOAuthFunctionContext,
} from './oauth-http.ts';
import {
	D1AudiocomOAuthRepository,
	type AudiocomOAuthRepository,
	type OAuthSessionRecord,
} from './oauth-repository.ts';

import { providerConfiguration } from './provider-config.ts';
import { oauthRedirectUri } from './oauth-application.ts';

export interface OAuthHandlerDependencies {
	readonly repository?: AudiocomOAuthRepository;
	readonly fetchImpl?: typeof fetch;
	readonly now?: () => number;
	readonly pause?: (milliseconds: number) => Promise<void>;
}

export interface AuthorizedAudiocomSession {
	readonly repository: AudiocomOAuthRepository;
	readonly session: OAuthSessionRecord;
	readonly tokenHash: string;
	readonly masterKey: string;
}

const ATTEMPT_TTL_MS = 10 * 60 * 1_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const REFRESH_MARGIN_MS = 60 * 1_000;
const REFRESH_LEASE_MS = 15 * 1_000;

export async function handleAudiocomOAuthStartRequest(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['POST'], async (admission) => {
		const redirectUri = oauthRedirectUri(context);
		const input = parseOAuthStartInput(await readJsonBody(context.request));
		assertClientOrigin(input.client, admission.corsOrigin);
		const clientId = configuredSecret(context.env.AUDIOCOM_CLIENT_ID, 'OAuth client');
		const repository = repositoryFor(context, dependencies);
		const now = nowFrom(dependencies);
		await repository.cleanupExpired(now);
		const attemptId = `${await providerAttemptPrefix(context)}${randomCapability()}`;
		const handoffToken = randomCapability();
		const state = randomCapability();
		const verifier = randomCapability(48);
		const expiresAt = now + ATTEMPT_TTL_MS;
		await repository.createAttempt({
			id: attemptId,
			stateHash: await hashCapability(state),
			pkceVerifierCiphertext: await encryptOAuthSecret(verifier, oauthMasterKey(context), `audiocom-pkce:${attemptId}`),
			handoffHash: await hashCapability(handoffToken),
			clientKind: input.client,
			status: 'pending',
			grantId: null,
			errorCode: null,
			sessionTokenHash: null,
			sessionTokenCiphertext: null,
			createdAt: now,
			expiresAt,
		});
		const authorizeUrl = new URL('/auth/authorize', providerConfiguration(context.env).authorizationOrigin);
		authorizeUrl.searchParams.set('client_id', clientId);
		authorizeUrl.searchParams.set('response_type', 'code');
		authorizeUrl.searchParams.set('state', state);
		authorizeUrl.searchParams.set('scope', providerConfiguration(context.env).scope);
		authorizeUrl.searchParams.set('code_challenge_method', 'S256');
		authorizeUrl.searchParams.set('code_challenge', await hashCapability(verifier));
		authorizeUrl.searchParams.set('redirect_uri', redirectUri);
		return oauthJson({ data: {
			attemptId,
			handoffToken,
			authorizeUrl: authorizeUrl.href,
			expiresAt: new Date(expiresAt).toISOString(),
		} }, 201, admission);
	});
}

export async function handleAudiocomOAuthCallbackRequest(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies = {},
): Promise<Response> {
	try {
		assertAllowedHost(new URL(context.request.url), context.env);
		if (context.request.method !== 'GET') {
			throw new OAuthHttpError(405, 'method_not_allowed', 'The request method is not supported.', { Allow: 'GET' });
		}
		if (new URL(context.request.url).origin !== new URL(oauthRedirectUri(context)).origin) {
			throw new OAuthHttpError(400, 'invalid_callback', 'The audio.com authorization callback origin is invalid.');
		}
		const query = new URL(context.request.url).searchParams;
		for (const key of query.keys()) {
			if (!['code', 'state', 'error', 'error_description', 'original_path'].includes(key) || query.getAll(key).length !== 1) {
				throw new OAuthHttpError(400, 'invalid_callback', 'The Audiocom authorization response is invalid.');
			}
		}
		if (query.has('code') === query.has('error')
			|| (query.has('error_description') && !query.has('error'))) {
			throw new OAuthHttpError(400, 'invalid_callback', 'The Audiocom authorization response is invalid.');
		}
		if (query.has('original_path')) callbackValue(query.get('original_path'), 'original path', 2_048);
		const state = callbackValue(query.get('state'), 'state', 128);
		const repository = repositoryFor(context, dependencies);
		const now = nowFrom(dependencies);
		const attempt = await repository.findAttemptByStateHash(await hashCapability(state));
		if (attempt === null || !await attemptMatchesProvider(context, attempt.id) || attempt.expiresAt <= now) {
			throw new OAuthHttpError(410, 'authorization_expired', 'This Audiocom connection attempt has expired.');
		}
		if (attempt.status !== 'pending') {
			throw new OAuthHttpError(409, 'authorization_used', 'This Audiocom authorization response was already used.');
		}
		if (query.has('error')) {
			callbackValue(query.get('error'), 'error', 256);
			if (query.has('error_description')) callbackValue(query.get('error_description'), 'error description', 2_048);
			await repository.failAttempt(attempt.id, 'denied', 'authorization_denied', now);
			return callbackPage('Audiocom connection cancelled', 'You can close this window and return to Soundscaper.');
		}
		const code = callbackValue(query.get('code'), 'code', 4_096);
		if (!await repository.claimAttempt(attempt.id, now)) {
			throw new OAuthHttpError(409, 'authorization_used', 'This Audiocom authorization response was already used.');
		}
		try {
			const pair = await exchangeAuthorizationCode(context, code, await decryptOAuthSecret(attempt.pkceVerifierCiphertext, oauthMasterKey(context), `audiocom-pkce:${attempt.id}`), dependencies);
			// The public API has no userinfo endpoint. Each authorization gets its own opaque grant.
			const user = { id: attempt.id, username: '' };
			const masterKey = oauthMasterKey(context);
			const grantId = grantIdentifier(user.id);
			const completed = await repository.completeAttempt(attempt.id, {
				id: grantId,
				user,
				accessTokenCiphertext: await encryptOAuthSecret(pair.accessToken, masterKey, accessAad(grantId)),
				refreshTokenCiphertext: await encryptOAuthSecret(pair.refreshToken, masterKey, refreshAad(grantId)),
				accessExpiresAt: now + pair.expiresInSeconds * 1_000,
			}, now);
			if (!completed) throw new Error('The OAuth attempt changed while it was being completed.');
		} catch (error) {
			await repository.failAttempt(attempt.id, 'failed', publicOAuthError(error).code, now);
			throw error;
		}
		return callbackPage('Audiocom connected', 'You can close this window and return to Soundscaper.');
	} catch (error) {
		const failure = callbackError(error);
		return callbackPage('Audiocom could not be connected', failure.message, failure.status);
	}
}

export async function handleAudiocomOAuthPollRequest(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['POST'], async (admission) => {
		const input = parseOAuthPollInput(await readJsonBody(context.request));
		const repository = repositoryFor(context, dependencies);
		const now = nowFrom(dependencies);
		let attempt = await repository.findAttemptById(input.attemptId);
		if (attempt === null || !await attemptMatchesProvider(context, attempt.id)) throw new OAuthHttpError(404, 'authorization_not_found', 'The connection attempt was not found.');
		const handoffHash = await hashCapability(input.handoffToken);
		if (!constantTimeEqual(handoffHash, attempt.handoffHash)) {
			throw new OAuthHttpError(404, 'authorization_not_found', 'The connection attempt was not found.');
		}
		assertClientOrigin(attempt.clientKind, admission.corsOrigin);
		if (attempt.expiresAt <= now) {
			throw new OAuthHttpError(410, 'authorization_expired', 'This Audiocom connection attempt has expired.');
		}
		if (attempt.status === 'pending' || attempt.status === 'exchanging') {
			return oauthJson({ data: { status: 'pending' } }, 202, admission, { 'Retry-After': '1' });
		}
		if (attempt.status === 'denied') {
			throw new OAuthHttpError(409, 'authorization_denied', 'Audiocom authorization was cancelled.');
		}
		if (attempt.status !== 'connected' || attempt.grantId === null) {
			throw new OAuthHttpError(502, 'authorization_failed', 'Audiocom authorization failed.');
		}
		const masterKey = oauthMasterKey(context);
		if (attempt.sessionTokenHash === null || attempt.sessionTokenCiphertext === null) {
			const token = randomCapability();
			await repository.claimAttemptSession(
				attempt.id,
				await hashCapability(token),
				await encryptOAuthSecret(token, masterKey, sessionAad(attempt.id)),
			);
			attempt = await repository.findAttemptById(attempt.id);
		}
		if (attempt === null || attempt.sessionTokenHash === null
			|| attempt.sessionTokenCiphertext === null || attempt.grantId === null) {
			throw new OAuthHttpError(500, 'internal_error', 'The Audiocom session could not be created.');
		}
		const token = await decryptOAuthSecret(attempt.sessionTokenCiphertext, masterKey, sessionAad(attempt.id));
		const expiresAt = now + SESSION_TTL_MS;
		await repository.ensureSession({
			tokenHash: attempt.sessionTokenHash,
			grantId: attempt.grantId,
			clientKind: attempt.clientKind,
			createdAt: now,
			expiresAt,
		});
		await repository.touchSession(attempt.sessionTokenHash, now, expiresAt);
		const grant = await repository.findGrant(attempt.grantId);
		if (grant === null) throw new OAuthHttpError(500, 'internal_error', 'The Audiocom session could not be created.');
		const data = attempt.clientKind === 'desktop'
			? { status: 'connected', sessionToken: token }
			: { status: 'connected' };
		const headers = attempt.clientKind === 'web'
			? { 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1_000)) }
			: undefined;
		return oauthJson({ data }, 200, admission, headers);
	});
}

export async function handleAudiocomOAuthSessionRequest(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies = {},
): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'DELETE'], async (admission) => {
		const credentials = optionalSessionToken(context.request);
		if (context.request.method === 'DELETE') {
			if (credentials !== null) {
				const repository = repositoryFor(context, dependencies);
				await repository.deleteSessionAndOrphanGrant(
					await hashCapability(credentials.token),
					nowFrom(dependencies),
				);
			}
			return oauthJson({ data: { connected: false } }, 200, admission, { 'Set-Cookie': expiredSessionCookie() });
		}
		if (credentials === null) return oauthJson({ data: { connected: false } }, 200, admission);
		try {
			await authorizeAudiocomSession(context, dependencies);
			return oauthJson({ data: { connected: true } }, 200, admission);
		} catch (error) {
			if (error instanceof OAuthHttpError && error.status === 401) {
				return oauthJson({ data: { connected: false } }, 200, admission, { 'Set-Cookie': expiredSessionCookie() });
			}
			throw error;
		}
	});
}

export async function authorizeAudiocomSession(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies = {},
): Promise<AuthorizedAudiocomSession> {
	const credentials = requestSessionToken(context.request);
	const tokenHash = await hashCapability(credentials.token);
	const repository = repositoryFor(context, dependencies);
	const now = nowFrom(dependencies);
	const session = await repository.findSession(tokenHash, now);
	if (session === null || !await attemptMatchesProvider(context, session.grant.user.id) || (credentials.transport === 'cookie') !== (session.clientKind === 'web')) {
		throw new OAuthHttpError(401, 'authentication_required', 'Connect to Audiocom to continue.');
	}
	await repository.touchSession(tokenHash, now, now + SESSION_TTL_MS);
	return { repository, session, tokenHash, masterKey: oauthMasterKey(context) };
}

export async function accessTokenForSession(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies = {},
): Promise<Readonly<{ accessToken: string; authorized: AuthorizedAudiocomSession }>> {
	const authorized = await authorizeAudiocomSession(context, dependencies);
	const now = nowFrom(dependencies);
	let grant = authorized.session.grant;
	if (grant.accessExpiresAt > now + REFRESH_MARGIN_MS) {
		return {
			accessToken: await decryptOAuthSecret(
				grant.accessTokenCiphertext,
				authorized.masterKey,
				accessAad(grant.id),
			),
			authorized,
		};
	}
	const owner = randomCapability(24);
	if (await authorized.repository.acquireRefreshLease({
		grantId: grant.id,
		generation: grant.refreshGeneration,
		owner,
		now,
		expiresAt: now + REFRESH_LEASE_MS,
	})) {
		try {
			const pair = await refreshAccessToken(context, grant, authorized.masterKey, dependencies);
			const refreshedAt = nowFrom(dependencies);
			const updated = await authorized.repository.completeRefresh({
				grantId: grant.id,
				generation: grant.refreshGeneration,
				owner,
				accessTokenCiphertext: await encryptOAuthSecret(
					pair.accessToken,
					authorized.masterKey,
					accessAad(grant.id),
				),
				refreshTokenCiphertext: await encryptOAuthSecret(
					pair.refreshToken,
					authorized.masterKey,
					refreshAad(grant.id),
				),
				accessExpiresAt: refreshedAt + pair.expiresInSeconds * 1_000,
				now: refreshedAt,
			});
			if (!updated) throw new Error('The Audiocom refresh lease was lost.');
			return { accessToken: pair.accessToken, authorized };
		} catch (error) {
			await authorized.repository.releaseRefreshLease(grant.id, grant.refreshGeneration, owner);
			if (error instanceof OAuthHttpError && error.status === 401) {
				await invalidateAuthorizedAudiocomSession(authorized, dependencies);
			}
			throw error;
		}
	}
	const pause = dependencies.pause ?? ((milliseconds: number) => new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	}));
	for (let attempt = 0; attempt < 8; attempt += 1) {
		await pause(50);
		const refreshed = await authorized.repository.findGrant(grant.id);
		if (refreshed === null) break;
		if (refreshed.refreshGeneration !== grant.refreshGeneration) {
			grant = refreshed;
			return {
				accessToken: await decryptOAuthSecret(
					grant.accessTokenCiphertext,
					authorized.masterKey,
					accessAad(grant.id),
				),
				authorized,
			};
		}
	}
	throw new OAuthHttpError(503, 'refresh_in_progress', 'Audiocom authentication is being refreshed.', {
		'Retry-After': '1',
	});
}

export async function invalidateAuthorizedAudiocomSession(
	authorized: AuthorizedAudiocomSession,
	dependencies: OAuthHandlerDependencies = {},
): Promise<void> {
	await authorized.repository.deleteSessionAndOrphanGrant(authorized.tokenHash, nowFrom(dependencies));
}

function repositoryFor(
	context: AudiocomOAuthFunctionContext,
	dependencies: OAuthHandlerDependencies,
): AudiocomOAuthRepository {
	if (dependencies.repository !== undefined) return dependencies.repository;
	if (context.env.FREESOUND_OAUTH_DB === undefined) {
		throw new OAuthHttpError(503, 'service_unavailable', 'Audiocom OAuth storage is not configured.');
	}
	return new D1AudiocomOAuthRepository(context.env.FREESOUND_OAUTH_DB);
}

function assertClientOrigin(client: 'web' | 'desktop', corsOrigin: string | null): void {
	const desktopOrigin = 'soundscaper-app://bundle';
	if ((client === 'desktop') !== (corsOrigin === desktopOrigin)) {
		throw new OAuthHttpError(403, 'client_origin_mismatch', 'The OAuth client does not match this application.');
	}
}

function nowFrom(dependencies: OAuthHandlerDependencies): number {
	const now = dependencies.now?.() ?? Date.now();
	if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('The OAuth clock returned an invalid value.');
	return now;
}

function oauthMasterKey(context: AudiocomOAuthFunctionContext): string {
	return configuredSecret(context.env.AUDIOCOM_OAUTH_MASTER_KEY, 'encryption key');
}

function callbackValue(value: string | null, label: string, maximumLength: number): string {
	if (value === null || value.length === 0 || value.length > maximumLength || hasControlCharacter(value)) {
		throw new OAuthHttpError(400, 'invalid_callback', `The Audiocom authorization ${label} is invalid.`);
	}
	return value;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 0x1f || code === 0x7f;
	});
}

function callbackError(error: unknown): OAuthHttpError {
	const failure = publicOAuthError(error);
	if (failure.status >= 500) {
		return new OAuthHttpError(failure.status, failure.code, 'Return to Soundscaper and try connecting again.');
	}
	return failure;
}

function callbackPage(title: string, message: string, status = 200): Response {
	const headers = new Headers({
		'Cache-Control': 'no-store',
		'Content-Type': 'text/html; charset=utf-8',
		'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
		'Referrer-Policy': 'no-referrer',
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
	});
	return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;margin:3rem;max-width:40rem}h1{font-size:1.5rem}</style><main><h1>${title}</h1><p>${message}</p></main>`, {
		status,
		headers,
	});
}

function optionalSessionToken(request: Request): Readonly<{ token: string; transport: 'cookie' | 'bearer' }> | null {
	const hasAuthorization = request.headers.has('authorization');
	const hasCookie = request.headers.get('cookie')?.includes('__Host-audiocom_session=') === true;
	if (!hasAuthorization && !hasCookie) return null;
	return requestSessionToken(request);
}

async function providerAttemptPrefix(context: AudiocomOAuthFunctionContext): Promise<string> {
	const provider = providerConfiguration(context.env);
	return provider.kind === 'audiocity' ? `audiocity-${await hashCapability(provider.apiOrigin)}-` : '';
}
async function attemptMatchesProvider(context: AudiocomOAuthFunctionContext, attemptId: string): Promise<boolean> {
	const prefix = await providerAttemptPrefix(context);
	return prefix ? attemptId.startsWith(prefix) : !attemptId.startsWith('audiocity-');
}

function grantIdentifier(userId: string): string { return `audiocom-user-${String(userId)}`; }
function accessAad(grantId: string): string { return `audiocom-oauth:${grantId}:access`; }
function refreshAad(grantId: string): string { return `audiocom-oauth:${grantId}:refresh`; }
function sessionAad(attemptId: string): string { return `audiocom-oauth:${attemptId}:session`; }
