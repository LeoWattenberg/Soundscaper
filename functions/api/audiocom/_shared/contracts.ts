/* SPDX-License-Identifier: AGPL-3.0-only */
import { OAuthHttpError } from './oauth-http.ts';
import { DEFAULT_AUDIOCOM_PROVIDER, trustedProviderHookUrl, trustedProviderMediaUrl, trustedProviderUploadUrl, type AudiocomProviderConfiguration } from './provider-config.ts';

export const MAX_UPLOAD_BYTES = 100_000_000;
export const LICENSES = ['none', 'arr', 'cc-0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd'] as const;
const CATEGORIES = ['music', 'podcast', 'voice-over', 'sound-design', 'cover', 'beats', 'audiobook', 'recording', 'other'];
const MIMES = new Set(['audio/wav', 'audio/vnd.wave', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mpa', 'audio/mpa-robust', 'audio/flac', 'audio/x-flac', 'audio/x-wavpack', 'audio/x-wavpack-correction', 'audio/aiff', 'audio/x-aiff', 'audio/ogg', 'audio/vorbis', 'audio/vorbis-config', 'application/ogg', 'audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg4-generic']);
export interface AudiocomAudio {
	readonly id: string;
	readonly title: string;
	readonly authorName: string;
	readonly username: string;
	readonly url: string;
	readonly description: string;
	readonly license: string;
	readonly isDownloadable: boolean;
	readonly durationSeconds: number;
	readonly previewUrl?: string;
}
export interface UploadInput {
	readonly title: string;
	readonly category: string;
	readonly description: string;
	readonly license: string;
	readonly is_listed: boolean;
	readonly is_downloadable: boolean;
	readonly mime: string;
	readonly name: string;
	readonly size: number;
}
export function normalizeAudio(value: unknown, provider = DEFAULT_AUDIOCOM_PROVIDER): AudiocomAudio {
	const source = record(value);
	const id = text(source.id, 64);
	if (!(provider.kind === 'audiocity' ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u : /^[0-9]{1,32}$/u).test(id)) invalid();
	const username = text(source.username, 256);
	const slug = text(source.slug, 512);
	const license = text(source.license, 32);
	if (!LICENSES.some(item => item === license)) invalid();
	const play = record(source.play);
	if (!Number.isSafeInteger(play.duration) || Number(play.duration) < 0 || Number(play.duration) > 604_800_000) invalid();
	if (typeof source.is_downloadable !== 'boolean') invalid();
	const playback = text(play.url, 4096, true);
	return {
		id, title: text(source.title, 1024), authorName: text(source.author_name, 256, true), username,
		url: provider.kind === 'audiocity' ? `${provider.webOrigin}/public/audio/${id}` : `https://audio.com/${encodeURIComponent(username)}/audio/${encodeURIComponent(slug)}`,
		description: text(source.description, 65_536, true), license, isDownloadable: source.is_downloadable,
		durationSeconds: Number(play.duration) / 1000,
		...(playback ? { previewUrl: `/api/audiocom/preview?url=${encodeURIComponent(trustedAssetUrl(playback, provider).href)}` } : {}),
	};
}
export function trustedAssetUrl(value: unknown, provider = DEFAULT_AUDIOCOM_PROVIDER): URL {
	if (provider.kind === 'audiocity') return trustedProviderMediaUrl(value, provider);
	const url = parseUrl(value);
	const allowed = (url.hostname === 's3.audio.com' && url.pathname.startsWith('/audio/'))
		|| (url.hostname === 's3.ustatik.com' && url.pathname.startsWith('/audio.com.audio/'));
	if (!allowed) invalid();
	return url;
}
export function trustedUploadUrl(value: unknown, provider: AudiocomProviderConfiguration): URL {
	return provider.kind === 'audiocity' ? trustedProviderUploadUrl(value, provider) : trustedAssetUrl(value);
}
export function trustedHookUrl(value: unknown, provider = DEFAULT_AUDIOCOM_PROVIDER, kind: 'success' | 'fail' = 'success'): URL {
	if (provider.kind === 'audiocity') return trustedProviderHookUrl(value, provider, kind);
	const url = parseUrl(value);
	if (url.hostname !== 'api.audio.com' || url.pathname.startsWith('/auth/')) invalid();
	return url;
}
export function parseUploadInput(request: Request): UploadInput {
	const query = new URL(request.url).searchParams;
	const allowed = ['title', 'category', 'description', 'license', 'listed', 'downloadable'];
	if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) bad('Invalid upload metadata.');
	const title = query.get('title')?.trim() ?? '';
	const category = query.get('category') ?? '';
	const description = query.get('description') ?? '';
	const license = query.get('license') ?? 'arr';
	if (!title || title.length > 512 || description.length > 500 || !CATEGORIES.includes(category) || !LICENSES.some(item => item === license)) bad('Invalid upload metadata.');
	const flag = (key: string): boolean => {
		const value = query.get(key) ?? '0';
		if (value !== '0' && value !== '1') bad('Invalid upload visibility.');
		return value === '1';
	};
	let name: string;
	try { name = decodeURIComponent(request.headers.get('X-Audiocom-Filename') ?? ''); }
	catch { return bad('Invalid upload filename.'); }
	if (!name || name.length > 255 || /[/\\]/u.test(name) || [...name].some(character => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) bad('Invalid upload filename.');
	const length = request.headers.get('X-Audiocom-Content-Length') ?? '';
	if (!/^[1-9]\d{0,9}$/u.test(length)) bad('The exact upload size is required.');
	const size = Number(length);
	if (size > MAX_UPLOAD_BYTES) throw new OAuthHttpError(413, 'payload_too_large', 'audio.com uploads in Soundscaper are limited to 100 MB.');
	const declared = request.headers.get('content-length');
	if (declared !== null && declared !== length) bad('The upload size does not match.');
	const mime = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	if (!MIMES.has(mime) || /\.(?:aup|aup3|aup4|scape)$/iu.test(name)) throw new OAuthHttpError(415, 'unsupported_media_type', 'Choose a supported audio file. Project files are not supported by the public audio.com API.');
	if (request.body === null) bad('The upload file is empty.');
	return { title, category, description, license, is_listed: flag('listed'), is_downloadable: flag('downloadable'), mime, name, size };
}
export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, empty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!empty && !value)) invalid();
	return value as string;
}
function parseUrl(value: unknown): URL {
	let url: URL;
	try { url = new URL(text(value, 8192)); } catch { return invalid(); }
	if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) invalid();
	return url;
}
function invalid(): never { throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned an invalid response.'); }
function bad(message: string): never { throw new OAuthHttpError(400, 'invalid_request', message); }
