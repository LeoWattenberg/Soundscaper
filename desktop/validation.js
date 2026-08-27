import { extname } from 'node:path';

import {
	ACCEPTED_PROJECT_FILE_EXTENSIONS,
	APP_HOST,
	APP_SCHEME,
	MAX_SAVE_BYTES,
	PROJECT_FILE_EXTENSION,
	SCAPE_PROJECT_MIME_TYPE,
	SUPPORTED_LOCALES,
} from './constants.js';

// Suffix-only forms, as the picker filters and `extname` comparisons want them.
const PROJECT_EXTENSIONS = Object.freeze(
	ACCEPTED_PROJECT_FILE_EXTENSIONS.map((extension) => extension.slice(1)),
);
const NATIVE_PROJECT_EXTENSION = PROJECT_FILE_EXTENSION.slice(1);

const FILE_PURPOSES = Object.freeze({
	project: Object.freeze({
		// Every product opens every product's projects; only saving is native.
		extensions: Object.freeze([...PROJECT_EXTENSIONS, 'aup3', 'aup4']),
		filters: Object.freeze([{
			name: 'Scape and Audacity projects',
			extensions: [...PROJECT_EXTENSIONS, 'aup3', 'aup4'],
		}]),
	}),
	audio: Object.freeze({
		extensions: Object.freeze(['aac', 'aif', 'aiff', 'flac', 'm4a', 'mp2', 'mp3', 'oga', 'ogg', 'opus', 'rf64', 'wav', 'webm', 'wv']),
		filters: Object.freeze([{ name: 'Audio', extensions: ['aac', 'aif', 'aiff', 'flac', 'm4a', 'mp2', 'mp3', 'oga', 'ogg', 'opus', 'rf64', 'wav', 'webm', 'wv'] }]),
	}),
	video: Object.freeze({
		extensions: Object.freeze(['m4v', 'mp4', 'webm']),
		filters: Object.freeze([{ name: 'Video', extensions: ['m4v', 'mp4', 'webm'] }]),
	}),
	media: Object.freeze({
		extensions: Object.freeze(['aac', 'aif', 'aiff', 'flac', 'm4a', 'm4v', 'mp2', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'rf64', 'srt', 'txt', 'vtt', 'wav', 'webm', 'wv']),
		filters: Object.freeze([{ name: 'Audio, video, and labels', extensions: ['aac', 'aif', 'aiff', 'flac', 'm4a', 'm4v', 'mp2', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'rf64', 'srt', 'txt', 'vtt', 'wav', 'webm', 'wv'] }]),
	}),
	labels: Object.freeze({
		extensions: Object.freeze(['srt', 'txt', 'vtt']),
		filters: Object.freeze([{ name: 'Labels and captions', extensions: ['srt', 'txt', 'vtt'] }]),
	}),
	lut: Object.freeze({
		extensions: Object.freeze(['cube']),
		filters: Object.freeze([{ name: 'Cube LUT', extensions: ['cube'] }]),
	}),
});

const SAVE_PURPOSES = Object.freeze({
	project: Object.freeze({
		defaultExtension: NATIVE_PROJECT_EXTENSION,
		filters: [{ name: 'Scape project', extensions: [NATIVE_PROJECT_EXTENSION] }],
	}),
	aup4: Object.freeze({ defaultExtension: 'aup4', filters: [{ name: 'Audacity interchange', extensions: ['aup4'] }] }),
	'audio-pcm-mix': Object.freeze({
		defaultExtension: 'wav',
		filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }],
	}),
	audio: Object.freeze({
		defaultExtension: 'wav',
		filters: [
			{ name: 'Audio and stem archives', extensions: ['7z', 'aac', 'aif', 'aiff', 'flac', 'm4a', 'mp2', 'mp3', 'ogg', 'opus', 'wav', 'webm', 'wv', 'zip'] },
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
			{ name: 'Audio and video', extensions: ['7z', 'aac', 'aif', 'aiff', 'flac', 'm4a', 'mp2', 'mp3', 'mp4', 'ogg', 'opus', 'wav', 'webm', 'wv', 'zip'] },
			{ name: 'All files', extensions: ['*'] },
		],
	}),
	labels: Object.freeze({ defaultExtension: 'txt', filters: [{ name: 'Labels and captions', extensions: ['txt', 'srt', 'vtt'] }] }),
	preset: Object.freeze({ defaultExtension: 'json', filters: [{ name: 'Soundscaper preset', extensions: ['json'] }] }),
	macro: Object.freeze({ defaultExtension: 'txt', filters: [{ name: 'Audacity macro', extensions: ['txt'] }] }),
	report: Object.freeze({ defaultExtension: 'json', filters: [{ name: 'Analysis report', extensions: ['json'] }] }),
	// One purpose for the whole 6C-1 profile family, so OTIO and FCPXML land
	// here rather than each adding a purpose of its own.
	interchange: Object.freeze({
		defaultExtension: 'edl',
		filters: [{ name: 'Edit interchange', extensions: ['edl', 'otio', 'fcpxml', 'xml'] }],
	}),
});

const MIME_TYPES = Object.freeze({
	// Every accepted project suffix carries the one shared Scape media type.
	...Object.fromEntries(ACCEPTED_PROJECT_FILE_EXTENSIONS.map(
		(extension) => [extension, SCAPE_PROJECT_MIME_TYPE],
	)),
	'.7z': 'application/x-7z-compressed',
	'.aac': 'audio/aac',
	'.aif': 'audio/aiff',
	'.aiff': 'audio/aiff',
	'.aup3': 'application/x-audacity-project',
	'.aup4': 'application/vnd.audacity.aup4',
	'.bw64': 'audio/bw64',
	'.csv': 'text/csv',
	'.edl': 'text/plain',
	'.fcpxml': 'application/xml',
	'.flac': 'audio/flac',
	'.m4a': 'audio/mp4',
	'.m4v': 'video/mp4',
	'.mp2': 'audio/mpeg',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.oga': 'audio/ogg',
	'.ogg': 'audio/ogg',
	'.opus': 'audio/ogg; codecs=opus',
	'.otio': 'application/json',
	'.rf64': 'audio/rf64',
	'.srt': 'application/x-subrip',
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
	if (url.hash || url.pathname !== '/') throw new Error('Untrusted renderer document');
	if (url.search) {
		const projectIds = url.searchParams.getAll('project');
		if (url.searchParams.size !== 1 || projectIds.length !== 1
			|| !/^[a-z0-9_-]{1,256}$/iu.test(projectIds[0])) {
			throw new Error('Untrusted renderer document');
		}
	}
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
	if (typeof value !== 'number') throw new RangeError('Invalid save size');
	const size = value;
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
