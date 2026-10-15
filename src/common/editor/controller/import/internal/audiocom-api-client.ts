/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AudiocomAccount, AudiocomApiClient, AudiocomAuthorizationReservation,
	AudiocomSearchPage, AudiocomSearchResult,
} from '../audiocom-panel-session.ts';
import { audiocomProvider, DEFAULT_AUDIOCOM_PROVIDER, selectedAudiocomApiOrigin, type AudiocomProvider } from './audiocom-provider.ts';

const PREFIX = '/api/audiocom/';
const DESKTOP_PREFIX = 'soundscaper-app://bundle/_desktop/audiocom';

export class AudiocomApiError extends Error {
	constructor(readonly status: number, message: string) { super(message); this.name = 'AudiocomApiError'; }
}

interface ClientOptions {
	readonly apiOrigin?: string;
	readonly fetch?: typeof fetch;
	readonly location?: Pick<Location, 'origin' | 'protocol'>;
	readonly reserveAuthorization?: () => AudiocomAuthorizationReservation;
}

/** Same-origin control and streaming uploads keep provider grants out of renderers. */
export function createAudiocomApiClient(options: ClientOptions = {}): AudiocomApiClient {
	const location = options.location ?? globalThis.location;
	const desktop = location?.protocol === 'soundscaper-app:';
	const apiOrigin = selectedAudiocomApiOrigin(options.apiOrigin, location);
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const requestUrl = (path: string): string => desktop
		? `${DESKTOP_PREFIX}${path}` : new URL(path, location?.origin ?? 'https://soundscaper.org').href;
	const request = (path: string, init: RequestInit = {}): Promise<Response> => {
		const headers = new Headers(init.headers); headers.set('X-Audiocom-Api-Origin', apiOrigin);
		return fetchImpl(requestUrl(path), { ...init, headers, credentials: 'include', redirect: 'error' });
	};
	let provider = DEFAULT_AUDIOCOM_PROVIDER;
	let providerLoaded = false;
	const loadProvider = async (signal?: AbortSignal): Promise<AudiocomProvider> => {
		if (!providerLoaded) {
			const value = await responseData(await request(`${PREFIX}usage`, { signal }));
			provider = audiocomProvider(record(value).provider, location);
			if (provider.apiOrigin !== apiOrigin) throw new Error('The audio provider response does not match the selected server origin.');
			providerLoaded = true;
		}
		return provider;
	};
	const account = (value: unknown): AudiocomAccount => {
		const data = record(value);
		if (typeof data.connected !== 'boolean') throw new Error('Invalid audio.com account response.');
		const user = data.user == null ? null : record(data.user);
		return { connected: data.connected, ...(user && typeof user.username === 'string' ? { user: { username: user.username } } : {}) };
	};
	return {
		session: async signal => {
			const response = await request(`${PREFIX}oauth/session`, { signal });
			return response.status === 401 ? { connected: false } : account(await responseData(response));
		},
		startOAuth: async signal => {
			await loadProvider(signal);
			const data = record(await responseData(await request(`${PREFIX}oauth/start`, json({ client: desktop ? 'desktop' : 'web' }, signal))));
			const attempt = {
				attemptId: requiredString(data.attemptId), handoffToken: requiredString(data.handoffToken),
				authorizeUrl: requiredString(data.authorizeUrl), expiresAt: requiredString(data.expiresAt),
			};
			assertAudiocomAuthorizationUrl(attempt.authorizeUrl, location, provider);
			if (!Number.isFinite(Date.parse(attempt.expiresAt))) throw new Error('Invalid audio.com authorization expiry.');
			return attempt;
		},
		pollOAuth: async (attemptId, handoffToken, signal) => {
			const response = await request(`${PREFIX}oauth/poll`, json({ attemptId, handoffToken }, signal));
			if (response.status === 202) return null;
			const data = record(await responseData(response));
			if (data.status !== 'connected') throw new Error('Invalid audio.com authorization response.');
			return { connected: true };
		},
		disconnect: async signal => { await responseData(await request(`${PREFIX}oauth/session`, { method: 'DELETE', signal })); },
		reserveAuthorization: options.reserveAuthorization ?? (() => reserveAuthorization(desktop, location, () => provider)),
		search: async ({ query, page }, signal): Promise<AudiocomSearchPage> => {
			const params = new URLSearchParams({ q: query, page: String(page) });
			const data = record(await responseData(await request(`${PREFIX}search?${params}`, { signal })));
			if (!Array.isArray(data.results) || data.results.length > 100 || !Number.isSafeInteger(data.page)
				|| Number(data.page) < 1 || typeof data.hasNext !== 'boolean') throw new Error('Invalid audio.com search response.');
			await loadProvider(signal);
			return { results: data.results.map(value => normalizeResult(value, requestUrl, provider)), page: Number(data.page), hasNext: data.hasNext };
		},
		upload: async (file, draft, signal) => {
			await loadProvider(signal);
			const params = new URLSearchParams({
				title: draft.title, description: draft.description, category: draft.category, license: draft.license,
				listed: draft.visibility === 'listed' ? '1' : '0', downloadable: draft.downloadable ? '1' : '0',
			});
			const data = record(await responseData(await request(`${PREFIX}uploads?${params}`, {
				method: 'POST', signal, body: file,
				headers: { 'Content-Type': uploadMime(file), 'X-Audiocom-Filename': encodeURIComponent(file.name), 'X-Audiocom-Content-Length': String(file.size) },
			})));
			return { audio: normalizeResult(data.audio, requestUrl, provider), processing: data.processing === true };
		},
	};
}

export function assertAudiocomAuthorizationUrl(value: string, location?: Pick<Location, 'origin' | 'protocol'>, provider: AudiocomProvider = DEFAULT_AUDIOCOM_PROVIDER): string {
	const url = new URL(value);
	const keys = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method'];
	if (`${url.origin}${url.pathname}` !== `${provider.apiOrigin}/auth/authorize` || url.username || url.password || url.hash
		|| [...url.searchParams.keys()].some(key => !keys.includes(key))
		|| keys.some(key => url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key))
		|| url.searchParams.get('response_type') !== 'code' || url.searchParams.get('scope') !== provider.scope
		|| url.searchParams.get('code_challenge_method') !== 'S256'
		|| !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('code_challenge') ?? '')) throw new Error('Invalid audio.com authorization URL.');
	const redirect = url.searchParams.get('redirect_uri');
	const local = location && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(location.origin)
		? `${location.origin}${PREFIX}oauth/callback` : null;
	const preview = location && isPreviewOrigin(location.origin);
	const previewCallback = redirect ? new URL(redirect) : null;
	const validPreview = preview && previewCallback && isPreviewOrigin(previewCallback.origin)
		&& !previewCallback.username && !previewCallback.password && !previewCallback.search && !previewCallback.hash
		&& previewCallback.pathname === `${PREFIX}oauth/callback`;
	if (preview ? !validPreview : redirect !== `https://soundscaper.org${PREFIX}oauth/callback` && redirect !== local) throw new Error('Invalid audio.com authorization callback.');
	return url.href;
}

function isPreviewOrigin(origin: string): boolean {
	return /^https:\/\/(?:[a-z0-9-]+\.)?soundscaper-5ki\.pages\.dev$/u.test(origin);
}

function reserveAuthorization(desktop: boolean, location: Pick<Location, 'origin' | 'protocol'> | undefined, provider: () => AudiocomProvider): AudiocomAuthorizationReservation {
	if (desktop) {
		const bridge = (globalThis as typeof globalThis & { soundscaperDesktop?: { v1?: { openAudiocomAuthorization?: (url: string) => Promise<unknown> } } }).soundscaperDesktop?.v1;
		return { open: async url => {
			assertAudiocomAuthorizationUrl(url, location, provider());
			if (!bridge?.openAudiocomAuthorization) throw new Error('The desktop audio.com connection is unavailable.');
			await bridge.openAudiocomAuthorization(url);
		}, close: () => undefined };
	}
	const opened = globalThis.open('about:blank', '_blank');
	if (!opened) throw new Error('Allow the audio.com authorization window and try again.');
	opened.opener = null;
	return {
		open: url => { opened.location.replace(assertAudiocomAuthorizationUrl(url, location, provider())); },
		close: () => opened.close(),
	};
}

function normalizeResult(value: unknown, requestUrl: (path: string) => string, provider: AudiocomProvider): AudiocomSearchResult {
	const data = record(value);
	const id = requiredString(data.id);
	const validId = provider.kind === 'audiocity' ? /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id) : /^[1-9]\d{0,31}$/u.test(id);
	if (!validId) throw new Error('Invalid audio.com audio ID.');
	const url = new URL(requiredString(data.url));
	if (url.origin !== provider.webOrigin || url.username || url.password || url.search || url.hash
		|| (provider.kind === 'audiocity' && url.pathname !== `/public/audio/${id}`)) throw new Error('Invalid audio.com audio link.');
	const preview = typeof data.previewUrl === 'string' ? new URL(data.previewUrl, 'https://soundscaper.org') : null;
	if (preview && (preview.origin !== 'https://soundscaper.org' || preview.pathname !== `${PREFIX}preview`)) throw new Error('Invalid audio.com preview link.');
	const duration = Number(data.durationSeconds);
	if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid audio.com audio duration.');
	return Object.freeze({
		id, url: url.href, title: requiredString(data.title), authorName: text(data.authorName), username: text(data.username),
		description: text(data.description), license: text(data.license), isDownloadable: data.isDownloadable === true,
		durationSeconds: duration, ...(preview ? { previewUrl: requestUrl(`${preview.pathname}${preview.search}`) } : {}),
	});
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid audio.com response.');
	return value as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function requiredString(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 8_192) throw new Error('Invalid audio.com response text.');
	return value;
}
function json(value: unknown, signal?: AbortSignal): RequestInit {
	return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal };
}
async function responseData(response: Response): Promise<unknown> {
	try { return await parseResponseData(response); }
	catch (error) {
		if (!response.ok && !(error instanceof AudiocomApiError)) throw new AudiocomApiError(response.status, 'The audio.com request failed.');
		throw error;
	}
}

async function parseResponseData(response: Response): Promise<unknown> {
	if (response.status === 204) return null;
	if (!response.body) throw new AudiocomApiError(response.status, 'audio.com returned an empty response.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 1_048_576) { await reader.cancel(); throw new Error('The audio.com response is too large.'); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	const body = record(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
	if (!response.ok) {
		const error = body.error && typeof body.error === 'object' ? record(body.error) : {};
		throw new AudiocomApiError(response.status, text(error.message) || 'The audio.com request failed.');
	}
	return body.data;
}
function uploadMime(file: File): string {
	const types: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', wv: 'audio/x-wavpack', aif: 'audio/aiff', aiff: 'audio/aiff', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4' };
	return types[file.name.toLowerCase().split('.').at(-1) ?? ''] ?? file.type;
}
