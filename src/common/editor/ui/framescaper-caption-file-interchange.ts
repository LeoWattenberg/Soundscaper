/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoCaptionInterchangeFormatV1 } from '../video-caption-interchange-contract-v27.ts';

export interface FramescaperCaptionFileService {
	readonly isDesktop?: boolean;
	chooseFiles?(request: Readonly<{ readonly purpose: 'labels' | 'lut'; readonly multiple: false }> ):
		PromiseLike<readonly unknown[]> | readonly unknown[];
	openReadDescriptor?(
		descriptor: unknown,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
	saveFile?(request: Readonly<{
		readonly purpose: 'interchange';
		readonly suggestedName: string;
		readonly mimeType: string;
		readonly text: string;
		readonly signal?: AbortSignal;
	}>): PromiseLike<unknown> | unknown;
}

export interface FramescaperCaptionSidecarFile {
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly fileName: string;
	readonly text: string;
}

const MAXIMUM_CAPTION_SIDECAR_BYTES = 16 * 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

const FORMATS = Object.freeze({
	srt: Object.freeze({ extension: 'srt', mimeType: 'application/x-subrip;charset=utf-8' }),
	webvtt: Object.freeze({ extension: 'vtt', mimeType: 'text/vtt;charset=utf-8' }),
	'imsc1.1': Object.freeze({ extension: 'ttml', mimeType: 'application/ttml+xml;charset=utf-8' }),
});

export function captionSidecarFormatForFileName(
	value: string,
): VideoCaptionInterchangeFormatV1 {
	const name = String(value).trim().toLowerCase();
	if (name.endsWith('.srt')) return 'srt';
	if (name.endsWith('.vtt') || name.endsWith('.webvtt')) return 'webvtt';
	if (name.endsWith('.ttml') || name.endsWith('.imsc') || name.endsWith('.xml')) return 'imsc1.1';
	throw new RangeError('The caption sidecar extension does not identify SRT, WebVTT, or IMSC 1.1.');
}

/** Resolve a browser File or one desktop read capability without accepting ambient paths. */
export async function openFramescaperCaptionSidecarFile(input: Readonly<{
	readonly file?: Blob | null;
	readonly fileService?: FramescaperCaptionFileService;
	readonly signal?: AbortSignal;
}>): Promise<FramescaperCaptionSidecarFile | null> {
	throwIfAborted(input.signal);
	let body: unknown = input.file;
	if (body === undefined || body === null) {
		const service = input.fileService;
		if (!service?.isDesktop) return null;
		if (typeof service.chooseFiles !== 'function') {
			throw new Error('Desktop caption file selection is unavailable.');
		}
		const descriptors = await service.chooseFiles({ purpose: 'labels', multiple: false });
		throwIfAborted(input.signal);
		const descriptor = descriptors[0];
		if (descriptor === undefined) return null;
		if (typeof service.openReadDescriptor !== 'function') {
			throw new Error('Desktop caption file reading is unavailable.');
		}
		body = await service.openReadDescriptor(descriptor, input.signal ? { signal: input.signal } : {});
	}
	throwIfAborted(input.signal);
	if (!(body instanceof Blob)) throw new TypeError('The selected caption sidecar is not a pathless file body.');
	if (!Number.isSafeInteger(body.size) || body.size > MAXIMUM_CAPTION_SIDECAR_BYTES) {
		throw new RangeError('The caption sidecar exceeds its 16 MiB byte limit.');
	}
	const fileName = fileBodyName(body);
	const format = captionSidecarFormatForFileName(fileName);
	let text: string;
	try {
		text = UTF8.decode(await body.arrayBuffer());
	} catch (error) {
		throwIfAborted(input.signal);
		throw new TypeError('The caption sidecar must be strict UTF-8.', { cause: error });
	}
	throwIfAborted(input.signal);
	return Object.freeze({ format, fileName, text });
}

export async function saveFramescaperCaptionSidecarFile(input: Readonly<{
	readonly fileService: FramescaperCaptionFileService;
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly trackId: string;
	readonly text: string;
	readonly signal?: AbortSignal;
}>): Promise<unknown> {
	throwIfAborted(input.signal);
	if (typeof input.fileService?.saveFile !== 'function') {
		throw new Error('Caption sidecar saving is unavailable.');
	}
	const profile = FORMATS[input.format];
	if (!profile) throw new RangeError('The caption sidecar format is unsupported.');
	const base = safeFileStem(input.trackId);
	const request = {
		purpose: 'interchange' as const,
		suggestedName: `${base}.${profile.extension}`,
		mimeType: profile.mimeType,
		text: input.text,
		...(input.signal ? { signal: input.signal } : {}),
	};
	return input.fileService.saveFile(request);
}

function fileBodyName(value: Blob): string {
	const name = (value as Blob & Readonly<{ name?: unknown }>).name;
	if (typeof name !== 'string' || !name.trim()) {
		throw new TypeError('The caption sidecar file name is unavailable.');
	}
	return name.trim();
}

function safeFileStem(value: string): string {
	return String(value || 'captions').trim()
		.replace(/[^A-Za-z0-9._-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| 'captions';
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? new DOMException('Caption sidecar work was cancelled.', 'AbortError');
}
