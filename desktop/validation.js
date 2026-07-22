import { extname } from 'node:path';

import {
	APP_HOST,
	APP_SCHEME,
	MAX_SAVE_BYTES,
	SUPPORTED_LOCALES,
} from './constants.js';

const FILE_PURPOSES = Object.freeze({
	project: Object.freeze({
		extensions: Object.freeze(['scape', 'aup4']),
		filters: Object.freeze([{ name: 'Scape and Audacity projects', extensions: ['scape', 'aup4'] }]),
	}),
	audio: Object.freeze({
		extensions: Object.freeze(['aac', 'aif', 'aiff', 'aup3', 'flac', 'm4a', 'mp2', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'webm', 'wv']),
		filters: Object.freeze([{ name: 'Audio and Audacity 3 projects', extensions: ['aac', 'aif', 'aiff', 'aup3', 'flac', 'm4a', 'mp2', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'webm', 'wv'] }]),
	}),
	video: Object.freeze({
		extensions: Object.freeze(['m4v', 'mp4', 'webm']),
		filters: Object.freeze([{ name: 'Video', extensions: ['m4v', 'mp4', 'webm'] }]),
	}),
	media: Object.freeze({
		extensions: Object.freeze(['aac', 'aif', 'aiff', 'aup3', 'flac', 'm4a', 'm4v', 'mp2', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'wav', 'webm', 'wv']),
		filters: Object.freeze([{ name: 'Audio, video, and Audacity 3 projects', extensions: ['aac', 'aif', 'aiff', 'aup3', 'flac', 'm4a', 'm4v', 'mp2', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'wav', 'webm', 'wv'] }]),
	}),
	labels: Object.freeze({
		extensions: Object.freeze(['srt', 'txt', 'vtt']),
		filters: Object.freeze([{ name: 'Labels and captions', extensions: ['srt', 'txt', 'vtt'] }]),
	}),
});

const SAVE_PURPOSES = Object.freeze({
	project: Object.freeze({ defaultExtension: 'scape', filters: [{ name: 'Scape project', extensions: ['scape'] }] }),
	aup4: Object.freeze({ defaultExtension: 'aup4', filters: [{ name: 'Audacity interchange', extensions: ['aup4'] }] }),
	audio: Object.freeze({
		defaultExtension: 'wav',
		filters: [
			{ name: 'Audio and stem archives', extensions: ['aac', 'aif', 'aiff', 'flac', 'm4a', 'mp2', 'mp3', 'ogg', 'opus', 'wav', 'webm', 'wv', 'zip'] },
			{ name: 'All files', extensions: ['*'] },
		],
	}),
	video: Object.freeze({
		defaultExtension: 'mp4',
		filters: [
			{ name: 'Video', extensions: ['mp4', 'webm'] },
			{ name: 'All files', extensions: ['*'] },
		],
	}),
	media: Object.freeze({
		defaultExtension: 'mp4',
		filters: [
			{ name: 'Audio and video', extensions: ['aac', 'aif', 'aiff', 'flac', 'm4a', 'mp2', 'mp3', 'mp4', 'ogg', 'opus', 'wav', 'webm', 'wv', 'zip'] },
			{ name: 'All files', extensions: ['*'] },
		],
	}),
	labels: Object.freeze({ defaultExtension: 'txt', filters: [{ name: 'Labels and captions', extensions: ['txt', 'srt', 'vtt'] }] }),
	preset: Object.freeze({ defaultExtension: 'json', filters: [{ name: 'Soundscaper preset', extensions: ['json'] }] }),
	macro: Object.freeze({ defaultExtension: 'txt', filters: [{ name: 'Audacity macro', extensions: ['txt'] }] }),
	report: Object.freeze({ defaultExtension: 'json', filters: [{ name: 'Analysis report', extensions: ['json'] }] }),
});

const MIME_TYPES = Object.freeze({
	'.aac': 'audio/aac',
	'.aif': 'audio/aiff',
	'.aiff': 'audio/aiff',
	'.aup3': 'application/x-audacity-project',
	'.aup4': 'application/vnd.audacity.aup4',
	'.csv': 'text/csv',
	'.flac': 'audio/flac',
	'.m4a': 'audio/mp4',
	'.m4v': 'video/mp4',
	'.mp2': 'audio/mpeg',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.oga': 'audio/ogg',
	'.ogg': 'audio/ogg',
	'.opus': 'audio/ogg; codecs=opus',
	'.srt': 'application/x-subrip',
	'.scape': 'application/vnd.soundscaper.scape+zip',
	'.txt': 'text/plain',
	'.vtt': 'text/vtt',
	'.wav': 'audio/wav',
	'.webm': 'video/webm',
	'.wv': 'audio/x-wavpack',
});

export function assertAppUrl(candidate) {
	let url;
	try {
		url = new URL(String(candidate || ''));
	} catch {
		throw new Error('Untrusted renderer URL');
	}
	if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST || url.port || url.username || url.password) {
		throw new Error('Untrusted renderer URL');
	}
	return url;
}

export function isAppUrl(candidate) {
	try {
		assertAppUrl(candidate);
		return true;
	} catch {
		return false;
	}
}

export function assertEditorDocumentUrl(candidate) {
	const url = assertAppUrl(candidate);
	if (url.search || url.hash) throw new Error('Untrusted renderer document');
	if (url.pathname !== '/') throw new Error('Untrusted renderer document');
	return url;
}

export function isEditorDocumentUrl(candidate) {
	try {
		assertEditorDocumentUrl(candidate);
		return true;
	} catch {
		return false;
	}
}

export function validateFileChoice(value) {
	const purpose = String(value?.purpose || '');
	const definition = FILE_PURPOSES[purpose];
	if (!definition) throw new TypeError('Unsupported file-open purpose');
	return {
		purpose,
		multiple: value?.multiple === true,
		filters: definition.filters.map((filter) => ({ ...filter, extensions: [...filter.extensions] })),
		extensions: definition.extensions,
	};
}

export function acceptsFile(purpose, filePath) {
	const definition = FILE_PURPOSES[purpose];
	if (!definition) return false;
	const extension = extname(String(filePath || '')).slice(1).toLowerCase();
	return definition.extensions.includes(extension);
}

export function validateSaveChoice(value) {
	const purpose = String(value?.purpose || '');
	const definition = SAVE_PURPOSES[purpose];
	if (!definition) throw new TypeError('Unsupported save purpose');
	const suggestedName = sanitizeSuggestedName(value?.suggestedName, `untitled.${definition.defaultExtension}`);
	return {
		purpose,
		suggestedName: ensureExtension(suggestedName, definition.defaultExtension),
		filters: definition.filters.map((filter) => ({ ...filter, extensions: [...filter.extensions] })),
	};
}

export function validateDeclaredSize(value) {
	const size = Number(value);
	if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SAVE_BYTES) throw new RangeError('Invalid save size');
	return size;
}

export function resolveLocale(candidates, supported = SUPPORTED_LOCALES) {
	const supportedByLower = new Map(supported.map((locale) => [locale.toLowerCase(), locale]));
	for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
		const canonical = canonicalLocale(candidate);
		if (!canonical) continue;
		const exact = supportedByLower.get(canonical.toLowerCase());
		if (exact) return exact;
	}
	for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
		const canonical = canonicalLocale(candidate);
		if (!canonical) continue;
		const language = canonical.split('-')[0].toLowerCase();
		const match = supported.find((locale) => locale.split('-')[0].toLowerCase() === language);
		if (match) return match;
	}
	return supported.includes('en') ? 'en' : supported[0];
}

export function validateLocale(value) {
	const locale = String(value || '');
	const resolved = SUPPORTED_LOCALES.find((candidate) => candidate.toLowerCase() === locale.toLowerCase());
	if (!resolved) throw new RangeError('Unsupported locale');
	return resolved;
}

export function mimeTypeForPath(filePath) {
	return MIME_TYPES[extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function sanitizeSuggestedName(value, fallback) {
	const candidate = String(value || '').trim().replace(/[\u0000-\u001f<>:"/\\|?*]/gu, '-');
	const trimmed = candidate.replace(/[. ]+$/u, '').slice(0, 180);
	return trimmed && trimmed !== '.' && trimmed !== '..' ? trimmed : fallback;
}

function ensureExtension(name, extension) {
	return extname(name) ? name : `${name}.${extension}`;
}

function canonicalLocale(value) {
	const candidate = String(value || '').trim().replaceAll('_', '-');
	if (!candidate) return null;
	try {
		return Intl.getCanonicalLocales(candidate)[0] || null;
	} catch {
		return null;
	}
}
