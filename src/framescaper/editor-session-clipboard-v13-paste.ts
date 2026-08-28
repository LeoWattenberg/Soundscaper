/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeAudioEditorClipboardDescriptor } from '../common/editor/commands/clipboard-codec.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import {
	MEDIA_ASSET_STREAM_CHUNK_BYTES,
	type OwnedMediaAssetPublication,
	type OwnedMediaAssetWriter,
} from '../common/editor/storage/media-asset-write-repository.ts';
import { openFramescaperImageFramePackV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { sampleFrameToVideoFrame, type RationalRate } from '../common/editor/timeline-time.ts';
import { applyFramescaperProjectCommandNativeMedia } from './editor-project-native-media-commands.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { validateFramescaperProjectTimelineImage, type FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { prepareFramescaperSessionClipboardPasteCommandV12 } from './editor-session-clipboard-v12-controller.ts';
import {
	framescaperSessionClipboardV12FoundationV13,
	normalizeFramescaperSessionClipboardV13,
} from './editor-session-clipboard-v13.ts';

type DataRecord = Record<string, unknown>;
type IdFactory = (prefix?: string) => string;
type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FramescaperImageClipboardBodyTransferV13 {
	readonly mode: 'reuse' | 'copy';
	readonly fromStorageKey: string;
	readonly toStorageKey: string;
	readonly source: FramescaperImageSourceV1;
}

export interface FramescaperSessionClipboardPasteV13 {
	readonly command: FramescaperProjectCommandTimelineImage;
	readonly imageSourceIdMap: ReadonlyMap<string, string>;
	readonly bodyTransfers: readonly FramescaperImageClipboardBodyTransferV13[];
}

export interface FramescaperImageClipboardBodyStoreV13 {
	getMediaAssetMetadata(storageKey: string): Awaitable<unknown>;
	loadMediaAsset(storageKey: string, options?: Readonly<{ signal?: AbortSignal }>): Awaitable<unknown>;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Awaitable<OwnedMediaAssetWriter>;
}

export interface FramescaperImageClipboardBodyStageV13 {
	readonly publicationCount: number;
	complete(): void;
	rollback(): Promise<void>;
}

/** Compose filtered V12 paste state and canonical image commands as one timelineImage history transaction. */
export function prepareFramescaperSessionClipboardPasteV13(
	profile: unknown,
	projectValue: unknown,
	clipboardValue: unknown,
	baseCommand: AudioEditorCommand,
	createId: IdFactory,
): FramescaperSessionClipboardPasteV13 {
	validateFramescaperProjectTimelineImage(profile, projectValue);
	if (typeof createId !== 'function') throw new TypeError('V13 paste requires an ID factory.');
	const project = projectValue as FramescaperProjectTimelineImage;
	const clipboard = normalizeFramescaperSessionClipboardV13(clipboardValue);
	const paste = findPaste(baseCommand);
	if (JSON.stringify(normalizeAudioEditorClipboardDescriptor(paste.clipboard))
		!== JSON.stringify(clipboard.descriptor)) {
		throw new RangeError('The V13 clipboard and paste descriptors must match exactly.');
	}
	const imageClipIds = new Set(clipboard.images.clips.map(({ id }) => id));
	const imageKeys = new Set(clipboard.clipBindings.flatMap(({ clipId, descriptorKey }) => (
		imageClipIds.has(clipId) ? [descriptorKey] : []
	)));
	const foundationClipboard = framescaperSessionClipboardV12FoundationV13(clipboard);
	const foundationProject = framescaperProjectNativeMediaFoundationShapeTimelineImage(project);
	const foundationCommand = prepareFramescaperSessionClipboardPasteCommandV12(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		foundationProject,
		foundationClipboard,
		sanitizeFoundationCommand(baseCommand, new Set(clipboard.images.sourceIds), imageKeys,
			foundationClipboard.descriptor),
		createId,
	);
	const afterFoundation = applyFramescaperProjectCommandNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		foundationProject,
		foundationCommand,
	);
	const occupied = collectProjectIdentities(project);
	const targetSources = project.sources.filter((source): source is FramescaperImageSourceV1 => (
		source.kind === 'image'
	)).map(normalizeFramescaperImageSourceV1);
	const sourceCommands: FramescaperProjectCommandTimelineImage[] = [];
	const bodyTransfers: FramescaperImageClipboardBodyTransferV13[] = [];
	const sourceIdMap = new Map<string, string>();
	const clipboardSourceById = new Map(clipboard.sources.filter((source): source is FramescaperImageSourceV1 => (
		(source as Readonly<Record<string, unknown>>).kind === 'image'
	)).map((source) => [source.id, normalizeFramescaperImageSourceV1(source)]));
	for (const sourceId of clipboard.images.sourceIds) {
		const source = clipboardSourceById.get(sourceId);
		if (!source) throw new ReferenceError(`V13 image source ${sourceId} is missing from its clipboard.`);
		const reusable = targetSources.find((candidate) => (
			candidate.id === source.id && sameBodyAuthority(candidate, source)
		));
		if (reusable) {
			sourceIdMap.set(sourceId, reusable.id);
			addTransfer(bodyTransfers, {
				mode: 'reuse', fromStorageKey: reusable.storageKey,
				toStorageKey: reusable.storageKey, source: reusable,
			});
			continue;
		}
		const targetId = occupied.has(source.id) ? freshId(createId, 'image-source', occupied) : source.id;
		occupied.add(targetId);
		const target = normalizeFramescaperImageSourceV1({ ...source, id: targetId, storageKey: targetId });
		sourceIdMap.set(sourceId, targetId);
		sourceCommands.push(Object.freeze({
			type: 'image-source/set', sourceId: targetId, expectedSource: null, source: target,
		}));
		addTransfer(bodyTransfers, Object.freeze({
			mode: targetId === source.storageKey ? 'reuse' : 'copy',
			fromStorageKey: source.storageKey,
			toStorageKey: target.storageKey,
			source: target,
		}));
	}
	const clipCommands = clipboard.images.clips.map((clip) => {
		const binding = clipboard.clipBindings.find(({ clipId }) => clipId === clip.id);
		if (!binding) throw new ReferenceError(`V13 image clip ${clip.id} has no descriptor binding.`);
		const sourceTrack = clipboard.descriptor.tracks.find((track) => track.clips.some(
			({ key }) => key === binding.descriptorKey,
		));
		const descriptorClip = sourceTrack?.clips.find(({ key }) => key === binding.descriptorKey);
		if (!sourceTrack || !descriptorClip) throw new ReferenceError(`V13 image clip ${clip.id} has no geometry.`);
		const trackMap = record(paste.trackMap, 'V13 paste track map');
		const targetTrackId = stableId(
			trackMap[sourceTrack.sourceTrackId] ?? sourceTrack.sourceTrackId,
			'image target track',
		);
		const clipIds = record(paste.clipIds, 'V13 paste clip IDs');
		const targetClipId = stableId(clipIds[binding.descriptorKey], 'pasted image clip');
		if (occupied.has(targetClipId)) throw new RangeError(`V13 pasted clip ID ${targetClipId} is occupied.`);
		occupied.add(targetClipId);
		const sourceId = sourceIdMap.get(clip.sourceId);
		if (!sourceId) throw new ReferenceError(`V13 pasted image source ${clip.sourceId} has no mapping.`);
		const placed = placeImageClip(
			afterFoundation as unknown as FramescaperProjectTimelineImage,
			clip,
			descriptorClip,
			clipboard.descriptor,
			paste,
			targetTrackId,
			targetClipId,
			sourceId,
		);
		return Object.freeze({
			type: 'image-clip/set' as const,
			clipId: targetClipId,
			expectedClip: null,
			expectedPlacement: null,
			clip: placed,
			placement: Object.freeze({ scope: 'timeline' as const, trackId: targetTrackId }),
		});
	});
	const commands: FramescaperProjectCommandTimelineImage[] = [
		foundationCommand as FramescaperProjectCommandTimelineImage,
		...sourceCommands,
		...clipCommands,
	];
	return Object.freeze({
		command: commands.length === 1 ? commands[0]! : Object.freeze({
			type: 'batch' as const,
			commands: Object.freeze(commands),
		}),
		imageSourceIdMap: sourceIdMap,
		bodyTransfers: Object.freeze(bodyTransfers),
	});
}

/** Stage exact body reuse/copies before project command publication, retaining owned rollback tokens. */
export async function stageFramescaperSessionClipboardImageBodiesV13(
	transferValues: readonly FramescaperImageClipboardBodyTransferV13[],
	store: FramescaperImageClipboardBodyStoreV13,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<FramescaperImageClipboardBodyStageV13> {
	if (!Array.isArray(transferValues) || transferValues.length > 100_000) {
		throw new RangeError('V13 image body transfers must be a bounded array.');
	}
	assertStore(store);
	const transfers = normalizeTransfers(transferValues);
	const publications: OwnedMediaAssetPublication[] = [];
	let activeWriter: OwnedMediaAssetWriter | null = null;
	try {
		for (const transfer of transfers) {
			cancelled(options.signal);
			const origin = await requireImageBody(store, transfer.fromStorageKey, transfer.source, options.signal);
			if (transfer.mode === 'reuse') continue;
			const existing = await store.getMediaAssetMetadata(transfer.toStorageKey);
			if (existing !== null && existing !== undefined) {
				await requireImageBody(store, transfer.toStorageKey, transfer.source, options.signal);
				continue;
			}
			activeWriter = await store.beginMediaAssetWrite(transfer.toStorageKey, {
				name: transfer.source.name,
				kind: 'timeline-image',
				encoding: 'framescaper-image-asset-v1',
				mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
			}, {
				expectedBytes: transfer.source.assetByteLength,
				expectedSha256: transfer.source.contentSha256,
				...(options.signal ? { signal: options.signal } : {}),
			});
			assertWriter(activeWriter);
			for (let offset = 0; offset < origin.size; offset += activeWriter.maximumChunkBytes) {
				cancelled(options.signal);
				const bytes = new Uint8Array(await origin.slice(
					offset, Math.min(origin.size, offset + activeWriter.maximumChunkBytes),
				).arrayBuffer());
				await activeWriter.write(bytes, signalOptions(options.signal));
			}
			const publication = await activeWriter.commitOwned(signalOptions(options.signal));
			activeWriter = null;
			publications.push(publication);
			assertMetadata(publication.metadata, transfer.source, transfer.toStorageKey);
			await requireImageBody(store, transfer.toStorageKey, transfer.source, options.signal);
		}
	} catch (error) {
		const cleanup: unknown[] = [];
		if (activeWriter) try { await activeWriter.abort(); } catch (cause) { cleanup.push(cause); }
		for (const publication of [...publications].reverse()) {
			try { await publication.discardIfCurrent(); } catch (cause) { cleanup.push(cause); }
		}
		if (cleanup.length > 0) throw new AggregateError([error, ...cleanup], 'V13 image body staging and cleanup failed.');
		throw error;
	}
	let complete = false;
	return Object.freeze({
		publicationCount: publications.length,
		complete() { complete = true; },
		async rollback(): Promise<void> {
			if (complete) return;
			const failures: unknown[] = [];
			for (const publication of [...publications].reverse()) {
				try { await publication.discardIfCurrent(); } catch (error) { failures.push(error); }
			}
			if (failures.length > 0) throw new AggregateError(failures, 'V13 image body rollback failed.');
			complete = true;
		},
	});
}

function sanitizeFoundationCommand(
	value: AudioEditorCommand,
	imageSourceIds: ReadonlySet<string>,
	imageKeys: ReadonlySet<string>,
	foundationDescriptor: ReturnType<typeof normalizeAudioEditorClipboardDescriptor>,
): AudioEditorCommand {
	const sanitize = (input: unknown): DataRecord | null => {
		const command = structuredClone(record(input, 'V13 foundation command'));
		if (command.type === 'source/add') {
			const source = record(command.source, 'V13 foundation source add');
			return imageSourceIds.has(stableId(source.id, 'source add ID')) ? null : command;
		}
		if (command.type === 'batch') {
			if (!Array.isArray(command.commands)) throw new TypeError('V13 foundation batch commands must be an array.');
			const commands = command.commands.flatMap((child) => {
				const result = sanitize(child);
				return result === null ? [] : [result];
			});
			if (commands.length === 0) throw new RangeError('V13 foundation command became empty.');
			return { type: 'batch', commands };
		}
		if (command.type !== 'clipboard/paste') return command;
		command.clipboard = foundationDescriptor;
		for (const field of ['clipIds', 'videoEffectIds'] as const) {
			const values = record(command[field], `V13 foundation ${field}`);
			command[field] = Object.fromEntries(Object.entries(values).filter(([key]) => !imageKeys.has(key)));
		}
		return command;
	};
	return sanitize(value) as AudioEditorCommand;
}

function placeImageClip(
	project: FramescaperProjectTimelineImage,
	clip: ReturnType<typeof normalizeFramescaperImageClipV1>,
	descriptorClip: Readonly<Record<string, unknown>>,
	descriptor: ReturnType<typeof normalizeAudioEditorClipboardDescriptor>,
	paste: DataRecord,
	targetTrackId: string,
	clipId: string,
	sourceId: string,
) {
	const sequence = sequenceForTrack(project, targetTrackId);
	const sampleRate = positiveInteger(project.sampleRate, 'destination sample rate');
	const clipboardSampleRate = positiveInteger(descriptor.sampleRate, 'clipboard sample rate');
	const anchor = sampleFrameToVideoFrame(
		nonNegativeInteger(paste.atFrame, 'paste frame'), sequence.rate, sampleRate, 'point',
	);
	const offset = nonNegativeInteger(descriptorClip.offsetFrame, 'image offset');
	const duration = positiveInteger(descriptorClip.durationFrames, 'image duration');
	const offsetStart = roundedScale(offset, sampleRate, clipboardSampleRate);
	const offsetEnd = roundedScale(offset + duration, sampleRate, clipboardSampleRate);
	const relativeStart = sampleFrameToVideoFrame(offsetStart, sequence.rate, sampleRate, 'point');
	const relativeEnd = sampleFrameToVideoFrame(offsetEnd, sequence.rate, sampleRate, 'point');
	return normalizeFramescaperImageClipV1({
		...clip,
		id: clipId,
		sourceId,
		sequenceId: sequence.id,
		sequenceStartFrame: anchor + relativeStart,
		sequenceFrameCount: Math.max(1, relativeEnd - relativeStart),
	});
}

async function requireImageBody(
	store: FramescaperImageClipboardBodyStoreV13,
	storageKey: string,
	source: FramescaperImageSourceV1,
	signal?: AbortSignal,
): Promise<Blob> {
	cancelled(signal);
	const metadata = await store.getMediaAssetMetadata(storageKey);
	assertMetadata(metadata, source, storageKey);
	const body = canonicalMediaContentBlob(await store.loadMediaAsset(storageKey, signalOptions(signal)));
	if (body.size !== source.assetByteLength) throw new Error(`V13 image body ${storageKey} has a conflicting size.`);
	const reader = await openFramescaperImageFramePackV1({
		source,
		read: async (offset, length) => new Uint8Array(await body.slice(offset, offset + length).arrayBuffer()),
		...(signal ? { signal } : {}),
	});
	for (let index = 0; index < source.canonical.frameCount; index += 1) {
		cancelled(signal);
		await reader.readFrame(index, signal);
	}
	return body;
}

function assertMetadata(value: unknown, source: FramescaperImageSourceV1, storageKey: string): void {
	const metadata = record(value, `V13 image body ${storageKey} metadata`);
	if (metadata.sourceId !== storageKey || metadata.size !== source.assetByteLength
		|| metadata.sha256 !== source.contentSha256
		|| (metadata.mimeType !== undefined && metadata.mimeType !== ''
			&& metadata.mimeType !== FRAMESCAPER_IMAGE_ASSET_MIME_TYPE)
		|| (metadata.kind !== undefined && metadata.kind !== '' && metadata.kind !== 'timeline-image')
		|| (metadata.encoding !== undefined && metadata.encoding !== ''
			&& metadata.encoding !== 'framescaper-image-asset-v1')) {
		throw new Error(`V13 image body ${storageKey} conflicts with immutable authority.`);
	}
}

function normalizeTransfers(
	values: readonly FramescaperImageClipboardBodyTransferV13[],
): readonly FramescaperImageClipboardBodyTransferV13[] {
	const targets = new Set<string>();
	return Object.freeze(values.map((value, index) => {
		const candidate = record(value, `V13 image body transfer ${String(index)}`);
		if (Reflect.ownKeys(candidate).length !== 4
			|| !['mode', 'fromStorageKey', 'toStorageKey', 'source'].every((field) => Object.hasOwn(candidate, field))) {
			throw new TypeError('V13 image body transfers must be exact records.');
		}
		const mode = candidate.mode;
		if (mode !== 'reuse' && mode !== 'copy') throw new RangeError('V13 image body transfer mode is unsupported.');
		const fromStorageKey = stableId(candidate.fromStorageKey, 'body origin key');
		const toStorageKey = stableId(candidate.toStorageKey, 'body target key');
		const source = normalizeFramescaperImageSourceV1(candidate.source);
		if (source.storageKey !== toStorageKey || (mode === 'reuse') !== (fromStorageKey === toStorageKey)) {
			throw new RangeError('V13 image body transfer identity is inconsistent.');
		}
		if (targets.has(toStorageKey)) throw new RangeError(`Duplicate V13 image body target ${toStorageKey}.`);
		targets.add(toStorageKey);
		return Object.freeze({ mode, fromStorageKey, toStorageKey, source });
	}));
}

function addTransfer(
	transfers: FramescaperImageClipboardBodyTransferV13[],
	transfer: FramescaperImageClipboardBodyTransferV13,
): void {
	if (!transfers.some(({ toStorageKey }) => toStorageKey === transfer.toStorageKey)) transfers.push(transfer);
}

function sameBodyAuthority(left: FramescaperImageSourceV1, right: FramescaperImageSourceV1): boolean {
	return left.contentSha256 === right.contentSha256
		&& left.assetByteLength === right.assetByteLength
		&& left.original.byteLength === right.original.byteLength
		&& left.original.sha256 === right.original.sha256
		&& JSON.stringify(left.canonical) === JSON.stringify(right.canonical)
		&& left.conversionReceiptSha256 === right.conversionReceiptSha256;
}

function sequenceForTrack(project: FramescaperProjectTimelineImage, trackId: string): Readonly<{
	id: string;
	rate: RationalRate;
}> {
	for (const sequence of project.sequences) {
		if (!sequence.trackIds.includes(trackId)) continue;
		return Object.freeze({
			id: sequence.id,
			rate: Object.freeze({
				num: positiveInteger(sequence.rate.num, 'sequence rate numerator'),
				den: positiveInteger(sequence.rate.den, 'sequence rate denominator'),
			}),
		});
	}
	throw new ReferenceError(`V13 target track ${trackId} has no sequence.`);
}

function findPaste(command: unknown): DataRecord {
	const matches: DataRecord[] = [];
	const visit = (value: unknown): void => {
		const candidate = record(value, 'V13 paste command');
		if (candidate.type === 'clipboard/paste') matches.push(candidate);
		else if (candidate.type === 'batch') {
			if (!Array.isArray(candidate.commands)) throw new TypeError('V13 command batch must be an array.');
			for (const child of candidate.commands) visit(child);
		}
	};
	visit(command);
	if (matches.length !== 1) throw new RangeError('V13 paste requires exactly one clipboard/paste command.');
	return matches[0]!;
}

function collectProjectIdentities(project: FramescaperProjectTimelineImage): Set<string> {
	return new Set<string>([
		String(project.id),
		...project.sources.map(({ id }) => String(id)),
		...project.clips.map(({ id }) => String(id)),
		...project.projectBin.clips.map(({ id }) => String(id)),
		...project.tracks.map(({ id }) => String(id)),
		...project.sequences.map(({ id }) => String(id)),
	]);
}

function freshId(createId: IdFactory, prefix: string, occupied: Set<string>): string {
	for (let attempt = 0; attempt < 1_000; attempt += 1) {
		const candidate = stableId(createId(prefix), `fresh ${prefix} ID`);
		if (!occupied.has(candidate)) return candidate;
	}
	throw new Error(`V13 could not allocate a fresh ${prefix} ID.`);
}

function roundedScale(value: number, numerator: number, denominator: number): number {
	const scaled = (BigInt(value) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator);
	if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('V13 pasted geometry exceeds exact integers.');
	return Number(scaled);
}

function assertStore(value: unknown): asserts value is FramescaperImageClipboardBodyStoreV13 {
	const store = value as Partial<FramescaperImageClipboardBodyStoreV13> | null;
	for (const method of ['getMediaAssetMetadata', 'loadMediaAsset', 'beginMediaAssetWrite'] as const) {
		if (typeof store?.[method] !== 'function') throw new TypeError('V13 image body staging requires an exact store.');
	}
}

function assertWriter(value: unknown): asserts value is OwnedMediaAssetWriter {
	const writer = value as Partial<OwnedMediaAssetWriter> | null;
	if (writer?.maximumChunkBytes !== MEDIA_ASSET_STREAM_CHUNK_BYTES
		|| typeof writer.write !== 'function' || typeof writer.commitOwned !== 'function'
		|| typeof writer.abort !== 'function') {
		throw new TypeError('V13 image body staging requires a bounded owned writer.');
	}
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`V13 ${name} must be a stable ID.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`V13 ${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`V13 ${name} must be non-negative.`);
	return Number(value);
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as DataRecord;
}

function signalOptions(signal?: AbortSignal): Readonly<{ signal?: AbortSignal }> {
	return signal ? { signal } : {};
}

function cancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('V13 image body staging was cancelled.', 'AbortError');
}
