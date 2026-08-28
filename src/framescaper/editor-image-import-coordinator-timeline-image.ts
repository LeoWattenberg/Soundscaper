/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitImageImportGesture, IMAGE_IMPORT_LIMITS } from '../common/editor/image-import-admission.ts';
import { openFramescaperBrowserNativeImageV1 } from '../common/editor/timeline-image-browser-native-port.ts';
import {
	decodeFramescaperBrowserNativeImageV1,
	type FramescaperBrowserNativeImageDecodeResultV1,
} from '../common/editor/timeline-image-native-decode-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	FRAMESCAPER_IMAGE_TICKS_PER_SECOND,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import type { FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { createFramescaperImageBatchPlacementTimelineImage } from './editor-image-placement-timeline-image.ts';
import { assertFramescaperProjectIdentity } from './editor-project-identity.ts';

export interface FramescaperImageImportFileTimelineImage {
	readonly name: string;
	readonly type: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FramescaperTimelineImagePublicationRequestTimelineImage {
	readonly project: FramescaperProjectTimelineImage;
	readonly source: FramescaperImageSourceV1;
	readonly clip: FramescaperImageClipV1;
	readonly body: Blob;
	readonly command: FramescaperProjectCommandTimelineImage;
	readonly signal?: AbortSignal;
}

export interface FramescaperTimelineImagePublicationPortTimelineImage {
	publish(request: FramescaperTimelineImagePublicationRequestTimelineImage): Promise<FramescaperProjectTimelineImage>;
}

export type DecodeFramescaperTimelineImageTimelineImage = (request: Readonly<{
	readonly bytes: Uint8Array;
	readonly fileName: string;
	readonly mimeTypeHint: string | null;
	readonly signal?: AbortSignal;
}>) => Promise<FramescaperBrowserNativeImageDecodeResultV1>;

export interface FramescaperTimelineImageImportRequestTimelineImage {
	readonly project: FramescaperProjectTimelineImage;
	readonly files: readonly FramescaperImageImportFileTimelineImage[];
	readonly sequenceStartFrame: number;
	readonly createId: (prefix: string) => string;
	readonly publisher: FramescaperTimelineImagePublicationPortTimelineImage;
	readonly decode?: DecodeFramescaperTimelineImageTimelineImage;
	readonly signal?: AbortSignal;
}

export interface FramescaperTimelineImageImportFileResultTimelineImage {
	readonly fileName: string;
	readonly status: 'imported' | 'failed' | 'cancelled';
	readonly sourceId: string | null;
	readonly clipId: string | null;
	readonly notices: readonly string[];
	readonly message: string | null;
}

export interface FramescaperTimelineImageImportResultTimelineImage {
	readonly project: FramescaperProjectTimelineImage;
	readonly files: readonly FramescaperTimelineImageImportFileResultTimelineImage[];
}

interface PreparedImage {
	readonly file: FramescaperImageImportFileTimelineImage;
	readonly fileName: string;
	readonly mimeTypeHint: string | null;
	readonly decoded: FramescaperBrowserNativeImageDecodeResultV1;
	readonly sourceId: string;
	readonly clipId: string;
	readonly sequenceFrameCount: number;
}

/** Decode in picker order, then publish each successful file as one independent revision. */
export async function importFramescaperTimelineImagesTimelineImage(
	request: FramescaperTimelineImageImportRequestTimelineImage,
): Promise<FramescaperTimelineImageImportResultTimelineImage> {
	assertFramescaperProjectIdentity(request?.project);
	if (!Array.isArray(request.files)) throw new TypeError('Timeline image import files must be an array.');
	if (typeof request.createId !== 'function' || typeof request.publisher?.publish !== 'function') {
		throw new TypeError('Timeline image import requires ID and publication ports.');
	}
	admitImageImportGesture({ fileByteLengths: request.files.map((file) => fileSize(file)) });
	const decode = request.decode ?? defaultDecode;
	const results: FramescaperTimelineImageImportFileResultTimelineImage[] = [];
	const prepared: PreparedImage[] = [];
	const rate = primaryRate(request.project);
	for (let index = 0; index < request.files.length; index += 1) {
		const file = request.files[index]!;
		const fileName = safeFileName(file.name);
		if (request.signal?.aborted) {
			appendCancelled(request.files.slice(index), results);
			break;
		}
		try {
			const buffer = await file.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			if (bytes.byteLength !== file.size) throw new Error('The selected image changed while it was read.');
			const signal = decodeSignal(request.signal);
			const decoded = await decode({
				bytes, fileName, mimeTypeHint: mimeHint(file.type), signal,
			});
			prepared.push(Object.freeze({
				file,
				fileName,
				mimeTypeHint: mimeHint(file.type),
				decoded,
				sourceId: stableId(request.createId('image-source'), 'image source ID'),
				clipId: stableId(request.createId('image-clip'), 'image clip ID'),
				sequenceFrameCount: durationFrames(decoded.publication.durationTicks, rate),
			}));
		} catch (error) {
			if (request.signal?.aborted || isAbort(error)) {
				appendCancelled(request.files.slice(index), results);
				break;
			}
			results.push(fileResult(fileName, 'failed', null, null, [], message(error)));
		}
	}
	if (prepared.length === 0 || request.signal?.aborted) {
		return Object.freeze({ project: request.project, files: orderedResults(request.files, results) });
	}
	const placement = createFramescaperImageBatchPlacementTimelineImage(request.project, {
		sequenceStartFrame: request.sequenceStartFrame,
		sequenceFrameCounts: prepared.map(({ sequenceFrameCount }) => sequenceFrameCount),
		createId: request.createId,
	});
	let project = request.project;
	let cursor = request.sequenceStartFrame;
	let trackReady = placement.trackCommand === null;
	for (let index = 0; index < prepared.length; index += 1) {
		const item = prepared[index]!;
		if (request.signal?.aborted) {
			for (const remaining of prepared.slice(index)) {
				results.push(fileResult(remaining.fileName, 'cancelled', null, null, [], 'Import cancelled.'));
			}
			break;
		}
		const source = imageSource(item);
		const clip = imageClip(item, placement.sequenceId, cursor);
		const command = imageCommand(source, clip, placement.trackId, trackReady ? null : placement.trackCommand);
		try {
			project = await request.publisher.publish({
				project, source, clip,
				body: new Blob([item.decoded.publication.bytes.slice()], {
					type: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
				}),
				command,
				...(request.signal ? { signal: request.signal } : {}),
			});
			trackReady = true;
			cursor = safeAdd(cursor, item.sequenceFrameCount, 'image import cursor');
			results.push(fileResult(
				item.fileName, 'imported', source.id, clip.id, item.decoded.notices, null,
			));
		} catch (error) {
			if (request.signal?.aborted || isAbort(error)) {
				results.push(fileResult(item.fileName, 'cancelled', null, null, [], 'Import cancelled.'));
				for (const remaining of prepared.slice(index + 1)) {
					results.push(fileResult(remaining.fileName, 'cancelled', null, null, [], 'Import cancelled.'));
				}
				break;
			}
			results.push(fileResult(item.fileName, 'failed', null, null, [], message(error)));
		}
	}
	return Object.freeze({ project, files: orderedResults(request.files, results) });
}

async function defaultDecode(request: Parameters<DecodeFramescaperTimelineImageTimelineImage>[0]) {
	return decodeFramescaperBrowserNativeImageV1({ ...request, open: openFramescaperBrowserNativeImageV1 });
}

function imageSource(item: PreparedImage): FramescaperImageSourceV1 {
	const publication = item.decoded.publication;
	return Object.freeze({
		schemaVersion: 1, kind: 'image', id: item.sourceId,
		name: sourceName(item.fileName), mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: item.sourceId, contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength,
		original: Object.freeze({
			fileName: item.fileName,
			mimeType: item.mimeTypeHint,
			recognizedFormat: item.decoded.recognizedFormat,
			byteLength: publication.originalByteLength,
			sha256: publication.originalSha256,
		}),
		canonical: Object.freeze({
			width: publication.width, height: publication.height,
			hasAlpha: publication.hasAlpha, frameCount: publication.frameCount,
			durationTicks: publication.durationTicks, timingMode: publication.timingMode,
		}),
		conversionReceiptSha256: publication.conversionReceiptSha256,
	});
}

function imageClip(
	item: PreparedImage,
	sequenceId: string,
	sequenceStartFrame: number,
): FramescaperImageClipV1 {
	return Object.freeze({
		schemaVersion: 1, kind: 'image', id: item.clipId, sourceId: item.sourceId,
		sequenceId, sequenceStartFrame, sequenceFrameCount: item.sequenceFrameCount,
		sourceStartTicks: '0',
	});
}

function imageCommand(
	source: FramescaperImageSourceV1,
	clip: FramescaperImageClipV1,
	trackId: string,
	trackCommand: Readonly<Record<string, unknown>> | null,
): FramescaperProjectCommandTimelineImage {
	return {
		type: 'batch',
		commands: [
			...(trackCommand ? [trackCommand as FramescaperProjectCommandTimelineImage] : []),
			{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
			{
				type: 'image-clip/set', clipId: clip.id,
				expectedClip: null, expectedPlacement: null, clip,
				placement: { scope: 'timeline', trackId },
			},
		],
	};
}

function primaryRate(project: FramescaperProjectTimelineImage): Readonly<{ num: number; den: number }> {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError('Timeline image import requires its primary sequence.');
	return sequence.rate;
}

function durationFrames(ticksValue: string, rate: Readonly<{ num: number; den: number }>): number {
	const ticks = BigInt(ticksValue);
	const numerator = ticks * BigInt(rate.num);
	const denominator = BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND) * BigInt(rate.den);
	const frames = (numerator + denominator - 1n) / denominator;
	if (frames < 1n || frames > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('The imported image duration is outside the sequence frame domain.');
	}
	return Number(frames);
}

function orderedResults(
	files: readonly FramescaperImageImportFileTimelineImage[],
	results: readonly FramescaperTimelineImageImportFileResultTimelineImage[],
): readonly FramescaperTimelineImageImportFileResultTimelineImage[] {
	const queues = new Map<string, FramescaperTimelineImageImportFileResultTimelineImage[]>();
	for (const result of results) {
		const queue = queues.get(result.fileName) ?? [];
		queue.push(result); queues.set(result.fileName, queue);
	}
	return Object.freeze(files.flatMap((file) => queues.get(safeFileName(file.name))?.shift() ?? []));
}

function appendCancelled(
	files: readonly FramescaperImageImportFileTimelineImage[],
	results: FramescaperTimelineImageImportFileResultTimelineImage[],
): void {
	for (const file of files) results.push(fileResult(
		safeFileName(file.name), 'cancelled', null, null, [], 'Import cancelled.',
	));
}

function fileResult(
	fileName: string,
	status: FramescaperTimelineImageImportFileResultTimelineImage['status'],
	sourceId: string | null,
	clipId: string | null,
	notices: readonly string[],
	resultMessage: string | null,
): FramescaperTimelineImageImportFileResultTimelineImage {
	return Object.freeze({ fileName, status, sourceId, clipId, notices: Object.freeze([...notices]), message: resultMessage });
}

function fileSize(file: FramescaperImageImportFileTimelineImage): number {
	if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function'
		|| !Number.isSafeInteger(file.size) || file.size < 1) throw new TypeError('An image file is invalid.');
	return file.size;
}

function mimeHint(value: unknown): string | null {
	return typeof value === 'string' && /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u.test(value)
		? value : null;
}

function safeFileName(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('An image file name must be text.');
	const safe = value.normalize('NFC').replace(/[\\/\p{Cc}\p{Cf}\p{Zl}\p{Zp}\r\n]/gu, ' ').trim().slice(0, 512);
	return safe && safe !== '.' && safe !== '..' ? safe : 'Image';
}

function sourceName(fileName: string): string {
	const withoutExtension = fileName.replace(/\.[^.]{1,16}$/u, '').trim();
	return withoutExtension || 'Image';
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function decodeSignal(parent: AbortSignal | undefined): AbortSignal {
	const timeout = AbortSignal.timeout(IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function isAbort(value: unknown): boolean {
	return value instanceof DOMException && value.name === 'AbortError';
}

function message(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds safe integers.`);
	return value;
}
