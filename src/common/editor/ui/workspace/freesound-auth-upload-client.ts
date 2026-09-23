/* SPDX-License-Identifier: AGPL-3.0-only */

export type FreesoundPublishLicense = 'cc0' | 'cc-by' | 'cc-by-nc';
export type FreesoundOAuthPlatform = 'web' | 'desktop';

export class FreesoundApiError extends Error {
	public constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'FreesoundApiError';
	}
}

export function isFreesoundAuthenticationError(error: unknown): boolean {
	return error instanceof FreesoundApiError && error.status === 401;
}

export interface FreesoundUser {
	readonly id?: number;
	readonly username: string;
	readonly profileUrl?: string;
}

export interface FreesoundSessionResponse {
	readonly connected: boolean;
	readonly user?: FreesoundUser;
}

export interface FreesoundOAuthAttempt {
	readonly attemptId: string;
	readonly handoffToken: string;
	readonly authorizeUrl: string;
	readonly expiresAt: string;
}

export interface FreesoundDescribeUploadRequest {
	readonly uploadFilename: string;
	readonly title: string;
	readonly description: string;
	readonly tags: readonly string[];
	readonly categoryId: string;
	readonly license: FreesoundPublishLicense;
}

export interface FreesoundSubmittedUpload {
	readonly soundId?: number;
	readonly status: string;
	readonly soundUrl?: string;
}

export interface FreesoundPendingUpload {
	readonly uploadFilename: string;
	readonly name?: string;
	readonly status: string;
	readonly soundId?: number;
	readonly soundUrl?: string;
	readonly description?: string;
	readonly tags?: readonly string[];
	readonly license?: string;
}

export interface FreesoundUsage {
	readonly maximumUploadBytes: number;
	readonly maximumOriginalBytes: number;
	readonly acceptedUploadExtensions: readonly string[];
	readonly licenses: readonly FreesoundPublishLicense[];
}

export interface FreesoundClientTransport {
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly openAuthorization: (url: string) => Promise<void> | void;
	readonly reserveAuthorization?: () => FreesoundAuthorizationReservation;
}

export interface FreesoundAuthorizationReservation {
	readonly open: (url: string) => Promise<void> | void;
	readonly close: () => void;
}

export interface FreesoundClientTransportOptions {
	readonly fetch?: typeof fetch;
	readonly location?: Readonly<Pick<Location, 'origin' | 'protocol'>>;
	readonly openAuthorization?: (url: string) => Promise<void> | void;
	readonly scope?: unknown;
}

export interface FreesoundApiClient {
	readonly platform: FreesoundOAuthPlatform;
	readonly session: (signal?: AbortSignal) => Promise<FreesoundSessionResponse>;
	readonly startOAuth: (platform?: FreesoundOAuthPlatform, signal?: AbortSignal) => Promise<FreesoundOAuthAttempt>;
	readonly pollOAuth: (
		attemptId: string,
		handoffToken: string,
		signal?: AbortSignal,
	) => Promise<FreesoundSessionResponse | null>;
	readonly disconnect: (signal?: AbortSignal) => Promise<void>;
	readonly upload: (file: File, signal?: AbortSignal) => Promise<Readonly<{ uploadFilename: string }>>;
	readonly describe: (request: FreesoundDescribeUploadRequest, signal?: AbortSignal) => Promise<FreesoundSubmittedUpload>;
	readonly pending: (signal?: AbortSignal) => Promise<readonly FreesoundPendingUpload[]>;
	readonly usage: (signal?: AbortSignal) => Promise<FreesoundUsage>;
	readonly openAuthorization: (url: string) => Promise<void>;
	readonly reserveAuthorization: () => FreesoundAuthorizationReservation;
}

interface DesktopAuthorizationBridge {
	openFreesoundAuthorization?: (url: string) => Promise<unknown> | unknown;
}

const API_PREFIX = '/api/freesound/';
const DESKTOP_PREFIX = 'soundscaper-app://bundle/_desktop/freesound';

/** Resolve authenticated calls without allowing callers to redirect the transport outside Freesound. */
export function createFreesoundClientTransport(
	options: FreesoundClientTransportOptions = {},
): FreesoundClientTransport {
	const fetchRequest = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchRequest) throw new Error('Freesound requires the Fetch API.');
	const location = options.location ?? globalThis.location;
	const desktop = location?.protocol === 'soundscaper-app:';
	const scope = options.scope ?? globalThis;
	const bridge = desktopAuthorizationBridge(scope);
	const openWindow = browserWindowOpen(scope);
	const openAuthorization = options.openAuthorization ?? ((url: string) => {
		assertFreesoundAuthorizationUrl(url, location);
		if (desktop) {
			if (typeof bridge?.openFreesoundAuthorization !== 'function') {
				throw new Error('The desktop OAuth bridge is unavailable.');
			}
			return bridge.openFreesoundAuthorization(url) as Promise<void> | void;
		}
		const opened = openWindow?.(url, '_blank', 'noopener,noreferrer');
		if (!opened) throw new Error('Allow the Freesound authorization window and try again.');
		openerNull(opened);
	});
	return Object.freeze({
		request: async (path: string, init: RequestInit = {}) => {
			const url = resolveFreesoundApiUrl(path, location);
			return await fetchRequest(url, { ...init, credentials: 'include', redirect: 'error' });
		},
		openAuthorization,
		reserveAuthorization: () => {
			if (desktop || options.openAuthorization) {
				return Object.freeze({ open: openAuthorization, close: () => undefined });
			}
			// Keep the child handle: `noopener` makes several browsers return null even
			// when the popup opened. Sever opener synchronously before any navigation.
			const opened = openWindow?.('about:blank', '_blank');
			if (!opened) throw new Error('Allow the Freesound authorization window and try again.');
			openerNull(opened);
			return Object.freeze({
				open: (url: string) => {
					assertFreesoundAuthorizationUrl(url, location);
					opened.location.replace(url);
				},
				close: () => opened.close(),
			});
		},
	});
}

export function createFreesoundApiClient(
	transport: FreesoundClientTransport = createFreesoundClientTransport(),
	platform: FreesoundOAuthPlatform = globalThis.location?.protocol === 'soundscaper-app:' ? 'desktop' : 'web',
): FreesoundApiClient {
	return Object.freeze({
		platform,
		session: async (signal?: AbortSignal) => {
			const response = await transport.request(`${API_PREFIX}oauth/session`, { signal });
			if (response.status === 401) return Object.freeze({ connected: false });
			return normalizeSession(await responseData(response));
		},
		startOAuth: async (requestedPlatform = platform, signal?: AbortSignal) => normalizeOAuthAttempt(
			await responseData(await transport.request(`${API_PREFIX}oauth/start`, jsonRequest(
				'POST', { client: requestedPlatform }, signal,
			))),
		),
		pollOAuth: async (attemptId: string, handoffToken: string, signal?: AbortSignal) => {
			assertBoundedText(attemptId, 'OAuth attempt ID', 256);
			assertBoundedText(handoffToken, 'OAuth handoff token', 512);
			const response = await transport.request(`${API_PREFIX}oauth/poll`, jsonRequest(
				'POST', { attemptId, handoffToken }, signal,
			));
			if (response.status === 202) return null;
			return normalizeSession(await responseData(response));
		},
		disconnect: async (signal?: AbortSignal) => {
			const response = await transport.request(`${API_PREFIX}oauth/session`, { method: 'DELETE', signal });
			await assertSuccessful(response);
		},
		upload: async (file: File, signal?: AbortSignal) => {
			if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name) {
				throw new TypeError('A named audio file is required.');
			}
			const headers = new Headers({
				'Content-Type': file.type || 'application/octet-stream',
				'X-Freesound-Content-Length': String(file.size),
				'X-Freesound-Filename': encodeHeaderFilename(file.name),
			});
			const value = record(await responseData(await transport.request(`${API_PREFIX}uploads`, {
				method: 'POST', headers, body: file, signal,
			})));
			return Object.freeze({ uploadFilename: requiredText(value.uploadFilename, 'upload filename', 1024) });
		},
		describe: async (request: FreesoundDescribeUploadRequest, signal?: AbortSignal) => normalizeSubmittedUpload(
			await responseData(await transport.request(`${API_PREFIX}uploads/describe`, jsonRequest(
				'POST', request, signal,
			))),
		),
		pending: async (signal?: AbortSignal) => {
			const value = record(await responseData(await transport.request(`${API_PREFIX}uploads/pending`, { signal })));
			return normalizePendingUploads(value);
		},
		usage: async (signal?: AbortSignal) => {
			const value = record(await responseData(await transport.request(`${API_PREFIX}usage`, { signal })));
			return Object.freeze({
				maximumUploadBytes: positiveInteger(value.maximumUploadBytes, 'maximum upload bytes'),
				maximumOriginalBytes: positiveInteger(value.maximumOriginalBytes, 'maximum original bytes'),
				acceptedUploadExtensions: normalizedStringList(
					value.acceptedUploadExtensions, 'accepted upload extensions',
				),
				licenses: normalizedLicenses(value.licenses),
			});
		},
		openAuthorization: async (url: string) => { await transport.openAuthorization(url); },
		reserveAuthorization: () => transport.reserveAuthorization?.() ?? Object.freeze({
			open: transport.openAuthorization,
			close: () => undefined,
		}),
	});
}

function resolveFreesoundApiUrl(
	path: string,
	location: Readonly<Pick<Location, 'origin' | 'protocol'>> | undefined,
): string {
	if (!path.startsWith(API_PREFIX) || path.includes('\\') || path.includes('#')) {
		throw new TypeError('A valid Freesound API path is required.');
	}
	if (location?.protocol === 'soundscaper-app:') {
		return `${DESKTOP_PREFIX}${path}`;
	}
	if (!location || !['http:', 'https:'].includes(location.protocol)) {
		throw new Error('Freesound API calls require a trusted application origin.');
	}
	return new URL(path, location.origin).href;
}

function desktopAuthorizationBridge(scope: unknown): DesktopAuthorizationBridge | null {
	const root = recordOrNull(scope);
	const windowScope = recordOrNull(root?.window);
	for (const candidate of [
		recordOrNull(root?.soundscaperDesktop)?.v1,
		recordOrNull(windowScope?.soundscaperDesktop)?.v1,
	]) {
		const bridge = recordOrNull(candidate);
		if (bridge && typeof bridge.openFreesoundAuthorization === 'function') {
			return bridge as DesktopAuthorizationBridge;
		}
	}
	return null;
}

function browserWindowOpen(scope: unknown): typeof globalThis.open | undefined {
	const root = recordOrNull(scope);
	const windowScope = recordOrNull(root?.window);
	const candidate = root?.open ?? windowScope?.open;
	return typeof candidate === 'function'
		? candidate.bind(root?.open === candidate ? scope : root?.window) as typeof globalThis.open
		: undefined;
}

function assertFreesoundAuthorizationUrl(
	value: string,
	applicationLocation: Readonly<Pick<Location, 'origin' | 'protocol'>> | undefined = globalThis.location,
): void {
	let url: URL;
	try { url = new URL(value); }
	catch { throw new TypeError('A valid Freesound authorization URL is required.'); }
	const keys = [...url.searchParams.keys()];
	const requiredKeys = ['client_id', 'redirect_uri', 'response_type', 'state'];
	const singletonKeys = requiredKeys.every((key) => url.searchParams.getAll(key).length === 1);
	const redirectUri = url.searchParams.get('redirect_uri') || '';
	if (
		url.protocol !== 'https:'
		|| url.hostname !== 'freesound.org'
		|| url.pathname !== '/apiv2/oauth2/authorize/'
		|| url.hash
		|| keys.length !== requiredKeys.length
		|| !singletonKeys
		|| requiredKeys.some((key) => !keys.includes(key))
		|| !url.searchParams.get('client_id')
		|| url.searchParams.get('response_type') !== 'code'
		|| !url.searchParams.get('state')
		|| !validOAuthRedirectUri(redirectUri, applicationLocation)
	) {
		throw new TypeError('A valid Freesound authorization URL is required.');
	}
}

function validOAuthRedirectUri(
	value: string,
	applicationLocation: Readonly<Pick<Location, 'origin' | 'protocol'>> | undefined,
): boolean {
	if (value === 'https://soundscaper.org/api/freesound/oauth/callback') return true;
	let redirect: URL;
	try { redirect = new URL(value); }
	catch { return false; }
	if (redirect.protocol !== 'http:'
		|| !['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname)
		|| redirect.username || redirect.password
		|| redirect.pathname !== '/api/freesound/oauth/callback'
		|| redirect.search || redirect.hash) return false;
	if (!applicationLocation) return true;
	let application: URL;
	try { application = new URL(applicationLocation.origin); }
	catch { return false; }
	return application.protocol === 'http:'
		&& ['127.0.0.1', 'localhost', '[::1]'].includes(application.hostname)
		&& redirect.origin === application.origin;
}

function openerNull(opened: Window): void {
	try { opened.opener = null; } catch { /* Cross-origin windows may reject the assignment. */ }
}

function encodeHeaderFilename(value: string): string {
	assertBoundedText(value, 'file name', 1024);
	return encodeURIComponent(value);
}

function jsonRequest(method: string, value: unknown, signal?: AbortSignal): RequestInit {
	return {
		method,
		headers: Object.freeze({ 'Content-Type': 'application/json' }),
		body: JSON.stringify(value),
		signal,
	};
}

async function responseData(response: Response): Promise<unknown> {
	await assertSuccessful(response);
	const payload: unknown = await response.json();
	const envelope = record(payload);
	if (!Object.hasOwn(envelope, 'data')) throw new Error('Freesound returned an invalid response.');
	return envelope.data;
}

async function assertSuccessful(response: Response): Promise<void> {
	if (response.ok) return;
	let message = `Freesound request failed (${String(response.status)}).`;
	let code = 'request_failed';
	try {
		const payload = record(await response.json());
		const error = recordOrNull(payload.error);
		if (typeof error?.message === 'string' && error.message) message = error.message;
		else if (typeof payload.message === 'string' && payload.message) message = payload.message;
		if (typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,127}$/u.test(error.code)) code = error.code;
	} catch { /* Preserve the bounded generic message for non-JSON failures. */ }
	throw new FreesoundApiError(response.status, code, message);
}

function normalizeSession(value: unknown): FreesoundSessionResponse {
	const session = record(value);
	const userValue = recordOrNull(session.user);
	if (session.connected !== true) return Object.freeze({ connected: false });
	const user = record(userValue);
	const username = requiredText(user.username, 'Freesound username', 150);
	return Object.freeze({
		connected: true,
		user: Object.freeze({
			...(Number.isSafeInteger(user.id) && Number(user.id) > 0 ? { id: Number(user.id) } : {}),
			username,
			...(typeof user.profileUrl === 'string' ? { profileUrl: user.profileUrl } : {}),
		}),
	});
}

function normalizeOAuthAttempt(value: unknown): FreesoundOAuthAttempt {
	const attempt = record(value);
	const authorizeUrl = requiredText(attempt.authorizeUrl, 'authorization URL', 4096);
	assertFreesoundAuthorizationUrl(authorizeUrl);
	return Object.freeze({
		attemptId: requiredText(attempt.attemptId, 'OAuth attempt ID', 256),
		handoffToken: requiredText(attempt.handoffToken, 'OAuth handoff token', 512),
		authorizeUrl,
		expiresAt: requiredText(attempt.expiresAt, 'OAuth expiry', 64),
	});
}

function normalizeSubmittedUpload(value: unknown): FreesoundSubmittedUpload {
	const upload = record(value);
	return Object.freeze({
		...(Number.isSafeInteger(upload.soundId) && Number(upload.soundId) > 0 ? { soundId: Number(upload.soundId) } : {}),
		status: requiredText(upload.status, 'upload status', 128),
		...(typeof upload.soundUrl === 'string' && upload.soundUrl ? { soundUrl: upload.soundUrl } : {}),
	});
}

function normalizePendingUploads(value: Readonly<Record<string, unknown>>): readonly FreesoundPendingUpload[] {
	const descriptions = Array.isArray(value.pendingDescription) ? value.pendingDescription : [];
	const rows: FreesoundPendingUpload[] = descriptions.map((filename) => Object.freeze({
		uploadFilename: requiredText(filename, 'upload filename', 1024),
		status: 'pending_description',
	}));
	for (const [key, status] of [
		['pendingProcessing', 'pending_processing'],
		['pendingModeration', 'pending_moderation'],
	] as const) {
		const sounds = Array.isArray(value[key]) ? value[key] : [];
		for (const candidate of sounds) {
			const sound = record(candidate);
			const soundId = positiveInteger(sound.id, 'pending sound ID');
			rows.push(Object.freeze({
				uploadFilename: `sound-${String(soundId)}`,
				status,
				soundId,
				...(typeof sound.name === 'string' && sound.name ? { name: sound.name } : {}),
				...(typeof sound.description === 'string' ? { description: sound.description } : {}),
				...(typeof sound.license === 'string' ? { license: sound.license } : {}),
				...(Array.isArray(sound.tags) ? {
					tags: Object.freeze(sound.tags.filter((tag): tag is string => typeof tag === 'string')),
				} : {}),
			}));
		}
	}
	return Object.freeze(rows);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`Freesound returned an invalid ${label}.`);
	return Number(value);
}

function normalizedStringList(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length > 32) throw new Error(`Freesound returned invalid ${label}.`);
	return Object.freeze(value.map((entry) => requiredText(entry, label, 32)));
}

function normalizedLicenses(value: unknown): readonly FreesoundPublishLicense[] {
	const licenses = normalizedStringList(value, 'licenses');
	if (licenses.some((license) => !['cc0', 'cc-by', 'cc-by-nc'].includes(license))) {
		throw new Error('Freesound returned invalid licenses.');
	}
	return licenses as readonly FreesoundPublishLicense[];
}

function requiredText(value: unknown, label: string, maximum: number): string {
	assertBoundedText(value, label, maximum);
	return value.trim();
}

function assertBoundedText(value: unknown, label: string, maximum: number): asserts value is string {
	if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
		throw new TypeError(`A valid ${label} is required.`);
	}
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	const result = recordOrNull(value);
	if (!result) throw new Error('Freesound returned an invalid response.');
	return result;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}
