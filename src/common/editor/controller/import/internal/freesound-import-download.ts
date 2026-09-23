/* SPDX-License-Identifier: AGPL-3.0-only */

export const DEFAULT_MAXIMUM_FREESOUND_IMPORT_BYTES = 128 * 1024 * 1024;

const PREVIEW_MIME_TYPES: ReadonlySet<string> = new Set([
	'audio/ogg', 'application/ogg', 'audio/vorbis',
]);

export type FreesoundImportVariant = 'auto' | 'original' | 'preview-hq-ogg';
export type ResolvedFreesoundImportVariant = Exclude<FreesoundImportVariant, 'auto'>;

export interface FreesoundImportDownloadSound {
	readonly id: number;
	readonly name: string;
	readonly preview: Readonly<{ readonly available: boolean }>;
	readonly originalFile: Readonly<{ readonly byteLength: number; readonly format: string }>;
}

export interface FreesoundImportDownload {
	readonly blob: Blob;
	readonly fileName: string;
	readonly mimeType: string;
	readonly variant: ResolvedFreesoundImportVariant;
}

export class FreesoundOriginalTooLargeError extends RangeError {
	readonly canFallbackToPreview = true;

	constructor(
		readonly byteLength: number | null,
		readonly maximumBytes: number,
	) {
		super('The Freesound original is too large to import. Use the HQ preview instead.');
		this.name = 'FreesoundOriginalTooLargeError';
	}
}

export async function downloadFreesoundImport(options: Readonly<{
	readonly sound: FreesoundImportDownloadSound;
	readonly variant: ResolvedFreesoundImportVariant;
	readonly maximumOriginalBytes: number;
	readonly maximumPreviewBytes: number;
	readonly fetch: typeof fetch;
	readonly url: URL;
	readonly signal?: AbortSignal;
}>): Promise<FreesoundImportDownload> {
	const { sound, variant, signal } = options;
	if (variant === 'preview-hq-ogg' && !sound.preview.available) {
		throw new Error('The selected Freesound sound has no HQ OGG preview.');
	}
	if (variant === 'original' && sound.originalFile.byteLength > options.maximumOriginalBytes) {
		throw new FreesoundOriginalTooLargeError(sound.originalFile.byteLength, options.maximumOriginalBytes);
	}
	const response = await options.fetch(options.url, {
		method: 'GET',
		credentials: variant === 'original' ? 'include' : 'omit',
		redirect: 'error',
		signal,
		headers: { Accept: variant === 'original' ? 'audio/*, application/ogg' : 'audio/ogg' },
	});
	if (!response.ok) {
		if (variant === 'original' && response.status === 413) {
			throw new FreesoundOriginalTooLargeError(sound.originalFile.byteLength, options.maximumOriginalBytes);
		}
		throw await responseError(
			response,
			variant === 'original' ? 'Freesound original download failed' : 'Freesound preview download failed',
		);
	}
	const declaredMimeType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	const mimeType = variant === 'original'
		? originalMimeType(declaredMimeType, sound.originalFile.format)
		: previewMimeType(declaredMimeType);
	const maximumBytes = variant === 'original' ? options.maximumOriginalBytes : options.maximumPreviewBytes;
	const blob = await readCappedBody(response, maximumBytes, variant, sound.originalFile.byteLength, signal);
	const fileName = variant === 'preview-hq-ogg'
		? previewFileName(sound.name, sound.id)
		: safeFileName(
			contentDispositionFileName(response.headers.get('Content-Disposition')) || sound.name,
			`freesound-${String(sound.id)}.${sound.originalFile.format}`,
		);
	return Object.freeze({ blob, fileName, mimeType, variant });
}

async function readCappedBody(
	response: Response,
	maximumBytes: number,
	variant: ResolvedFreesoundImportVariant,
	originalByteLength: number,
	signal?: AbortSignal,
): Promise<Blob> {
	const declaredBytes = nullableNonNegativeInteger(response.headers.get('Content-Length'));
	const tooLarge = () => variant === 'original'
		? new FreesoundOriginalTooLargeError(declaredBytes ?? originalByteLength, maximumBytes)
		: new RangeError('The Freesound preview is too large to import.');
	if (declaredBytes !== null && declaredBytes > maximumBytes) throw tooLarge();
	const reader = response.body?.getReader();
	if (!reader) return new Blob();
	const chunks: ArrayBuffer[] = [];
	let byteLength = 0;
	try {
		for (;;) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			signal?.throwIfAborted();
			if (done) break;
			if (value.byteLength > maximumBytes - byteLength) throw tooLarge();
			const owned = new ArrayBuffer(value.byteLength);
			new Uint8Array(owned).set(value);
			chunks.push(owned);
			byteLength += owned.byteLength;
		}
	} catch (error) {
		try { await reader.cancel(error); }
		catch { /* Preserve the read, cancellation, or admission failure. */ }
		throw error;
	} finally {
		reader.releaseLock();
	}
	return new Blob(chunks);
}

function previewMimeType(value: string): string {
	if (!PREVIEW_MIME_TYPES.has(value)) throw new TypeError('The Freesound preview response was not OGG audio.');
	return value;
}

function originalMimeType(value: string, format: string): string {
	if (value.startsWith('audio/') || value === 'application/ogg') return value;
	if (value && value !== 'application/octet-stream') {
		throw new TypeError('The Freesound original response was not audio.');
	}
	const formats: Readonly<Record<string, string>> = Object.freeze({
		wav: 'audio/wav', wave: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff',
		flac: 'audio/flac', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
	});
	return formats[format.trim().toLowerCase()] ?? 'application/octet-stream';
}

function contentDispositionFileName(value: string | null): string | null {
	if (!value) return null;
	const encoded = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]*)/iu.exec(value)?.[1];
	if (encoded) {
		try { return decodeURIComponent(encoded.trim()); }
		catch { return null; }
	}
	const quoted = /(?:^|;)\s*filename\s*=\s*"([^"]*)"/iu.exec(value)?.[1];
	const bare = /(?:^|;)\s*filename\s*=\s*([^;]*)/iu.exec(value)?.[1];
	return quoted ?? bare?.trim() ?? null;
}

function safeFileName(value: string, fallback: string): string {
	const leaf = value.replace(/\\/gu, '/').split('/').at(-1) ?? '';
	const sanitized = Array.from(leaf, (character) => {
		const code = character.codePointAt(0)!;
		return code < 32 || code === 127 || /[:*?"<>|]/u.test(character) ? '-' : character;
	}).join('').trim().replace(/^\.+/u, '').slice(0, 240);
	return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : fallback;
}

function previewFileName(value: string, soundId: number): string {
	const safeName = safeFileName(value, `freesound-${String(soundId)}`);
	return safeName.toLowerCase().endsWith('.ogg') ? safeName : `${safeName}.ogg`;
}

function nullableNonNegativeInteger(value: string | null): number | null {
	if (value === null || value.trim() === '') return null;
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
	let message = fallback;
	try {
		const text = (await response.text()).slice(0, 8_192);
		const value = JSON.parse(text) as unknown;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const error = (value as Readonly<Record<string, unknown>>).error;
			if (error && typeof error === 'object' && !Array.isArray(error)) {
				const upstream = (error as Readonly<Record<string, unknown>>).message;
				if (typeof upstream === 'string' && upstream) message = upstream;
			}
		}
	} catch {
		// The status remains authoritative when an error body is absent or malformed.
	}
	return new Error(`${message} (${String(response.status)}).`);
}
