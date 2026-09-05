/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import {
	MEDIA_ASSET_STREAM_CHUNK_BYTES, type OwnedMediaAssetPublication, type OwnedMediaAssetWriter,
} from '../src/common/editor/storage/media-asset-write-repository.ts';
import {
	createFramescaperImageFramePackV1, type FramescaperImageFramePackPublicationV1,
} from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, type FramescaperImageSourceV1,
} from '../src/common/editor/timeline-image-model.ts';
import {
	FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { applyFramescaperProjectCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-commands.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { createFramescaperSessionClipboardV13 } from '../src/framescaper/editor-session-clipboard-v13.ts';
import {
	prepareFramescaperSessionClipboardPasteV13,
	stageFramescaperSessionClipboardImageBodiesV13,
	type FramescaperImageClipboardBodyStoreV13,
	type FramescaperImageClipboardBodyTransferV13,
} from '../src/framescaper/editor-session-clipboard-v13-paste.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;
interface StoredBody { metadata: Data; bytes: Uint8Array }
interface FakeBodyStore extends FramescaperImageClipboardBodyStoreV13 {
	readonly bodies: Map<string, StoredBody>;
	readonly calls: string[];
	failCommitFor: string | null;
	failDiscard: boolean;
	chunkBytes: number;
}

const NOW = '2026-09-01T12:00:00.000Z';
const IMAGE_KEY = 'image-clip:20:48000';
const ENCODER = new TextEncoder();
const AUDIO_SOURCE_ADD = Object.freeze({
	type: 'source/add', source: {
		kind: 'audio', id: 'pasted-audio-source', name: 'Pasted audio', storageKey: 'pasted-audio-source',
		mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	},
});

function pack(originalText = 'exact animated PNG input'): FramescaperImageFramePackPublicationV1 {
	return createFramescaperImageFramePackV1({
		original: ENCODER.encode(originalText),
		receipt: { decoder: { id: 'browser-native', version: '1' }, schemaVersion: 1 },
		width: 2, height: 1, timingMode: 'embedded',
		frames: [
			{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0) },
			{ presentationTicks: 1_000_000n, durationTicks: 4_000_000n, rgba: Uint8Array.of(0, 255, 0, 128, 0, 0, 255, 255) },
		],
	});
}

function imageSource(id: string, publication: FramescaperImageFramePackPublicationV1): FramescaperImageSourceV1 {
	return {
		schemaVersion: 1, kind: 'image', id, name: 'Animated image', storageKey: id,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength,
		original: {
			fileName: 'animated.png', mimeType: 'image/png', recognizedFormat: 'apng',
			byteLength: publication.originalByteLength, sha256: publication.originalSha256,
		},
		canonical: {
			width: publication.width, height: publication.height, hasAlpha: publication.hasAlpha,
			frameCount: publication.frameCount, durationTicks: publication.durationTicks,
			timingMode: publication.timingMode,
		},
		conversionReceiptSha256: publication.conversionReceiptSha256,
	};
}

const PUBLICATION = pack();
const ORIGIN = imageSource('image-source', PUBLICATION);
const COPY = imageSource('image-source-copy', PUBLICATION);

function baseProject(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, framescaperV20Options() as never) as unknown as Data;
}

function imageProject(source: FramescaperImageSourceV1 = ORIGIN): Data {
	const withSource = applyFramescaperProjectCommandTimelineImage(PROFILE, baseProject(), {
		type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
	} as never, { now: NOW });
	return applyFramescaperProjectCommandTimelineImage(PROFILE, withSource, {
		type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null,
		clip: {
			schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: source.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 20, sequenceFrameCount: 10, sourceStartTicks: '0',
		},
		placement: { scope: 'timeline', trackId: 'video-track' },
	} as never, { now: NOW }) as unknown as Data;
}

function descriptor(project: Data): Data {
	return {
		schemaVersion: 6, sampleRate: project.sampleRate, durationFrames: 48_000, annotations: [], takeGroups: [],
		tracks: [{
			sourceTrackId: 'video-track', sourceTrackName: 'Video', sourceTrackType: 'video',
			sourceLaneGroupId: null, sourceSequenceId: 'main-sequence',
			clips: [{
				key: IMAGE_KEY, kind: 'video', sourceId: 'image-source', offsetFrame: 0, sourceStartFrame: 0,
				durationFrames: 48_000, title: 'Pasted', sourceDurationFrames: 48_000, trimStartFrames: 0,
				trimEndFrames: 0, groupId: null, avLinkId: null, color: 'auto', speedRatio: 1,
				coordinateDomain: 'resolved-samples', sequenceId: 'main-sequence', sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null, videoEffects: [],
				videoComposition: {
					schemaVersion: 1,
					crop: { left: 0, top: 0, right: 0, bottom: 0 },
					transform: {
						anchorX: 0.5, anchorY: 0.5, positionX: 0.5, positionY: 0.5, scaleX: 1, scaleY: 1,
						rotationDegrees: 0, flipHorizontal: false, flipVertical: false,
					},
					opacity: 1, blendMode: 'normal', compositingOrder: 0,
				},
			}],
		}],
	};
}

function clipboard(project: Data = imageProject()): Data {
	return createFramescaperSessionClipboardV13(PROFILE, project, descriptor(project) as never) as unknown as Data;
}

function pasteCommand(board: Data, overrides: Data = {}): Data {
	const base = preparePasteCommand(board.descriptor, {
		atFrame: 480_000, mode: 'overlap', trackMap: { 'video-track': 'video-track' },
	}, (prefix = 'id') => `${prefix}-paste`) as Data;
	return { ...base, clipIds: { [IMAGE_KEY]: 'pasted-image-clip' }, ...overrides };
}

function counter(): (prefix?: string) => string {
	let index = 0;
	return (prefix = 'id') => `${prefix}-${String((index += 1))}`;
}

function commandsOf(value: unknown): Data[] {
	const command = value as Data;
	return command.type === 'batch' ? command.commands as Data[] : [command];
}

function transferShapes(transfers: readonly FramescaperImageClipboardBodyTransferV13[]) {
	return transfers.map(({ mode, fromStorageKey, toStorageKey }) => [mode, fromStorageKey, toStorageKey]);
}

test('a v13 paste admits an unseen image source beside the foundation and places its clip', () => {
	const board = clipboard();

	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE, baseProject(), board, pasteCommand(board) as never, counter(),
	);

	const commands = commandsOf(prepared.command);
	const sourceCommand = commands.find(({ type }) => type === 'image-source/set');
	const clipCommand = commands.find(({ type }) => type === 'image-clip/set');
	assert.equal((prepared.command as Data).type, 'batch');
	assert.equal(sourceCommand?.sourceId, 'image-source');
	assert.equal(sourceCommand?.expectedSource, null);
	assert.deepEqual(clipCommand?.placement, { scope: 'timeline', trackId: 'video-track' });
	assert.deepEqual(clipCommand?.clip, {
		schemaVersion: 1, kind: 'image', id: 'pasted-image-clip', sourceId: 'image-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 100, sequenceFrameCount: 10, sourceStartTicks: '0',
	});
	assert.deepEqual([...prepared.imageSourceIdMap], [['image-source', 'image-source']]);
	assert.deepEqual(transferShapes(prepared.bodyTransfers), [['reuse', 'image-source', 'image-source']]);
});

test('the prepared v13 paste command applies to the destination project as one transaction', () => {
	const board = clipboard();

	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE, baseProject(), board, pasteCommand(board) as never, counter(),
	);
	const pasted = applyFramescaperProjectCommandTimelineImage(
		PROFILE, baseProject(), prepared.command as never, { now: NOW },
	) as unknown as Data;

	assert.ok((pasted.clips as Data[]).some(({ id }) => id === 'pasted-image-clip'));
	assert.ok((pasted.sources as Data[]).some(({ id }) => id === 'image-source'));
});

test('a v13 paste reuses an identical image source the destination already holds', () => {
	const board = clipboard();

	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE, imageProject(), board, pasteCommand(board) as never, counter(),
	);

	assert.deepEqual(commandsOf(prepared.command).filter(({ type }) => type === 'image-source/set'), []);
	assert.deepEqual([...prepared.imageSourceIdMap], [['image-source', 'image-source']]);
	assert.deepEqual(transferShapes(prepared.bodyTransfers), [['reuse', 'image-source', 'image-source']]);
});

test('a v13 paste copies an image source whose identity is occupied by different bytes', () => {
	const board = clipboard();
	const conflicting = imageProject(imageSource('image-source', pack('a different original')));

	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE, conflicting, board, pasteCommand(board) as never,
		(prefix = 'id') => (prefix === 'image-source' ? 'image-source-copy' : `${prefix}-1`),
	);

	const sourceCommand = commandsOf(prepared.command).find(({ type }) => type === 'image-source/set');
	const clipCommand = commandsOf(prepared.command).find(({ type }) => type === 'image-clip/set');
	assert.equal(sourceCommand?.sourceId, 'image-source-copy');
	assert.equal((sourceCommand?.source as Data | undefined)?.storageKey, 'image-source-copy');
	assert.equal((clipCommand?.clip as Data | undefined)?.sourceId, 'image-source-copy');
	assert.deepEqual([...prepared.imageSourceIdMap], [['image-source', 'image-source-copy']]);
	assert.deepEqual(transferShapes(prepared.bodyTransfers), [['copy', 'image-source', 'image-source-copy']]);
});

test('a v13 paste gives up when the identity factory only offers occupied identities', () => {
	const board = clipboard();
	const conflicting = imageProject(imageSource('image-source', pack('a different original')));

	assert.throws(() => prepareFramescaperSessionClipboardPasteV13(
		PROFILE, conflicting, board, pasteCommand(board) as never,
		(prefix = 'id') => (prefix === 'image-source' ? 'video-clip' : `${prefix}-1`),
	), /could not allocate a fresh image-source ID/u);
});

test('a v13 paste requires exactly one clipboard paste inside a well-formed batch', () => {
	const board = clipboard();
	const paste = pasteCommand(board);
	const refuse = (command: unknown, message: RegExp): void => {
		assert.throws(() => prepareFramescaperSessionClipboardPasteV13(
			PROFILE, baseProject(), board, command as never, counter(),
		), message);
	};

	refuse({ type: 'project/rename', title: 'Renamed' }, /exactly one clipboard\/paste command/u);
	refuse({ type: 'batch', commands: [paste, paste] }, /exactly one clipboard\/paste command/u);
	refuse({ type: 'batch', commands: 1 }, /V13 command batch must be an array/u);
});

test('a v13 paste refuses a drifted carrier descriptor and a missing identity factory', () => {
	const board = clipboard();

	assert.throws(() => prepareFramescaperSessionClipboardPasteV13(
		PROFILE, baseProject(), board,
		pasteCommand(board, { clipboard: { ...board.descriptor as Data, durationFrames: 99 } }) as never,
		counter(),
	), /clipboard and paste descriptors must match exactly/u);
	assert.throws(() => prepareFramescaperSessionClipboardPasteV13(
		PROFILE, baseProject(), board, pasteCommand(board) as never, null as never,
	), /V13 paste requires an ID factory/u);
});

test('a v13 paste refuses pasted image clip identities that are unstable or already occupied', () => {
	const board = clipboard();
	const refuse = (clipIds: Data, message: RegExp): void => {
		assert.throws(() => prepareFramescaperSessionClipboardPasteV13(
			PROFILE, baseProject(), board, pasteCommand(board, { clipIds }) as never, counter(),
		), message);
	};

	refuse({ [IMAGE_KEY]: 'video-clip' }, /V13 pasted clip ID video-clip is occupied/u);
	refuse({}, /V13 pasted image clip must be a stable ID/u);
});

test('a v13 paste strips image source admissions from the foundation command it carries', () => {
	const board = clipboard();
	const imageAdd = { type: 'source/add', source: (board.sources as Data[]).at(-1) };

	const prepared = prepareFramescaperSessionClipboardPasteV13(
		PROFILE, baseProject(), board,
		{ type: 'batch', commands: [imageAdd, AUDIO_SOURCE_ADD, pasteCommand(board)] } as never, counter(),
	);

	const admitted = commandsOf(commandsOf(prepared.command)[0]).filter(({ type }) => type === 'source/add')
		.map((command) => (command.source as Data).id);
	assert.deepEqual(admitted, ['pasted-audio-source']);
});

test('a v13 paste refuses a foundation batch that image filtering would empty', () => {
	const board = clipboard();
	const imageAdd = { type: 'source/add', source: (board.sources as Data[]).at(-1) };

	assert.throws(() => prepareFramescaperSessionClipboardPasteV13(
		PROFILE, baseProject(), board,
		{ type: 'batch', commands: [pasteCommand(board), { type: 'batch', commands: [imageAdd] }] } as never,
		counter(),
	), /V13 foundation command became empty/u);
});

function bodyMetadata(key: string, source: FramescaperImageSourceV1, overrides: Data = {}): Data {
	return {
		sourceId: key, size: source.assetByteLength, sha256: source.contentSha256,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, kind: 'timeline-image',
		encoding: 'framescaper-image-asset-v1', ...overrides,
	};
}

function bodyStore(seed: readonly (readonly [string, StoredBody])[] = []): FakeBodyStore {
	const store: FakeBodyStore = {
		bodies: new Map(seed),
		calls: [],
		failCommitFor: null,
		failDiscard: false,
		chunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES,
		getMediaAssetMetadata(key) {
			store.calls.push(`metadata:${key}`);
			return store.bodies.get(key)?.metadata ?? null;
		},
		loadMediaAsset(key) {
			store.calls.push(`load:${key}`);
			const body = store.bodies.get(key);
			if (!body) throw new ReferenceError(`No stored body ${key}.`);
			return new Blob([body.bytes as unknown as BlobPart]);
		},
		beginMediaAssetWrite(key, metadata, options) {
			store.calls.push(`begin:${key}`);
			const chunks: Uint8Array[] = [];
			return {
				maximumChunkBytes: store.chunkBytes,
				bytesWritten: 0,
				write: async (bytes: Uint8Array) => void chunks.push(bytes),
				commit: async () => ({}),
				commitOwned: async (): Promise<OwnedMediaAssetPublication> => {
					store.calls.push(`commit:${key}`);
					if (store.failCommitFor === key) throw new Error(`Commit refused for ${key}.`);
					const published = { ...metadata, sourceId: key, size: options.expectedBytes, sha256: options.expectedSha256 };
					store.bodies.set(key, { metadata: published, bytes: new Uint8Array(Buffer.concat(chunks)) });
					return {
						metadata: published,
						discardIfCurrent: async () => {
							store.calls.push(`discard:${key}`);
							if (store.failDiscard) throw new Error(`Discard refused for ${key}.`);
							return store.bodies.delete(key);
						},
					};
				},
				abort: async () => { store.calls.push(`abort:${key}`); },
			} as unknown as OwnedMediaAssetWriter;
		},
	};
	return store;
}

function originStore(...extra: readonly (readonly [string, StoredBody])[]): FakeBodyStore {
	const origin = { metadata: bodyMetadata('image-source', ORIGIN), bytes: PUBLICATION.bytes };
	return bodyStore([['image-source', origin], ...extra]);
}

function transferTo(mode: 'reuse' | 'copy', fromStorageKey: string, source: FramescaperImageSourceV1) {
	return { mode, fromStorageKey, toStorageKey: source.storageKey, source } as FramescaperImageClipboardBodyTransferV13;
}

test('image body staging refuses unbounded transfer lists and inexact stores', async () => {
	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13(null as never, bodyStore()),
		/V13 image body transfers must be a bounded array/u,
	);
	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13(new Array(100_001) as never, bodyStore()),
		/V13 image body transfers must be a bounded array/u,
	);
	const partial = { getMediaAssetMetadata: () => null, loadMediaAsset: () => null } as never;
	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13([transferTo('reuse', 'image-source', ORIGIN)], partial),
		/V13 image body staging requires an exact store/u,
	);
});

test('image body staging refuses transfer records that are not exact four-field descriptions', async () => {
	const refuse = async (value: unknown, message: RegExp) => {
		await assert.rejects(() => stageFramescaperSessionClipboardImageBodiesV13([value] as never, bodyStore()), message);
	};

	await refuse('not a record', /V13 image body transfer 0 must be a record/u);
	await refuse({ ...transferTo('reuse', 'image-source', ORIGIN), extra: 1 }, /must be exact records/u);
	await refuse({ mode: 'reuse', fromStorageKey: 'a', toStorageKey: 'a' }, /must be exact records/u);
	await refuse({ ...transferTo('reuse', 'image-source', ORIGIN), mode: 'move' }, /mode is unsupported/u);
});

test('image body staging refuses transfers whose mode, keys and source identity disagree', async () => {
	const refuse = async (values: readonly FramescaperImageClipboardBodyTransferV13[], message: RegExp) => {
		await assert.rejects(() => stageFramescaperSessionClipboardImageBodiesV13(values, bodyStore()), message);
	};

	await refuse([transferTo('reuse', 'image-source', COPY)], /transfer identity is inconsistent/u);
	await refuse([transferTo('copy', 'image-source', ORIGIN)], /transfer identity is inconsistent/u);
	await refuse(
		[{ ...transferTo('copy', 'image-source', COPY), toStorageKey: 'image-source-other' }],
		/transfer identity is inconsistent/u,
	);
	await refuse(
		[transferTo('copy', 'image-source', COPY), transferTo('copy', 'image-source', COPY)],
		/Duplicate V13 image body target image-source-copy/u,
	);
});

test('a reuse transfer reads its existing body through and publishes nothing', async () => {
	const store = originStore();

	const stage = await stageFramescaperSessionClipboardImageBodiesV13(
		[transferTo('reuse', 'image-source', ORIGIN)], store,
	);

	assert.equal(stage.publicationCount, 0);
	assert.deepEqual(store.calls, ['metadata:image-source', 'load:image-source']);
	await stage.rollback();
	assert.deepEqual(store.calls, ['metadata:image-source', 'load:image-source']);
});

test('a copy transfer streams the origin body into a new owned publication', async () => {
	const store = originStore();

	const stage = await stageFramescaperSessionClipboardImageBodiesV13(
		[transferTo('copy', 'image-source', COPY)], store,
	);

	assert.equal(stage.publicationCount, 1);
	assert.deepEqual(store.bodies.get('image-source-copy')?.bytes, PUBLICATION.bytes);
	assert.deepEqual(
		store.calls.filter((call) => call.startsWith('begin:') || call.startsWith('commit:')),
		['begin:image-source-copy', 'commit:image-source-copy'],
	);
});

test('a copy transfer whose target already holds the identical body writes nothing', async () => {
	const store = originStore([
		'image-source-copy', { metadata: bodyMetadata('image-source-copy', COPY), bytes: PUBLICATION.bytes },
	]);

	const stage = await stageFramescaperSessionClipboardImageBodiesV13(
		[transferTo('copy', 'image-source', COPY)], store,
	);

	assert.equal(stage.publicationCount, 0);
	assert.deepEqual(store.calls.filter((call) => call.startsWith('begin:')), []);
});

test('a stored body that contradicts its immutable source authority is refused', async () => {
	const stage = async (body: StoredBody): Promise<unknown> => (
		stageFramescaperSessionClipboardImageBodiesV13(
			[transferTo('reuse', 'image-source', ORIGIN)], bodyStore([['image-source', body]]),
		)
	);

	await assert.rejects(
		() => stage({
			metadata: bodyMetadata('image-source', ORIGIN, { sha256: 'ab'.repeat(32) }),
			bytes: PUBLICATION.bytes,
		}),
		/V13 image body image-source conflicts with immutable authority/u,
	);
	await assert.rejects(
		() => stage({
			metadata: bodyMetadata('image-source', ORIGIN),
			bytes: PUBLICATION.bytes.slice(0, PUBLICATION.bytes.byteLength - 1),
		}),
		/V13 image body image-source has a conflicting size/u,
	);
});

test('image body staging stops at an already aborted signal', async () => {
	const store = originStore();
	const controller = new AbortController();
	controller.abort();

	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13(
			[transferTo('reuse', 'image-source', ORIGIN)], store, { signal: controller.signal },
		),
		{ name: 'AbortError' },
	);
	assert.deepEqual(store.calls, []);
});

test('image body staging refuses a writer that is not a bounded owned writer', async () => {
	const store = originStore();
	store.chunkBytes = 1_024;

	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13([transferTo('copy', 'image-source', COPY)], store),
		/V13 image body staging requires a bounded owned writer/u,
	);
	assert.ok(store.calls.includes('abort:image-source-copy'));
});

test('a failed transfer discards the publications it already made and reports cleanup failures', async () => {
	const first = imageSource('image-source-one', PUBLICATION);
	const second = imageSource('image-source-two', PUBLICATION);
	const transfers = [transferTo('copy', 'image-source', first), transferTo('copy', 'image-source', second)];
	const discarding = originStore();
	const stuck = originStore();
	discarding.failCommitFor = 'image-source-two';
	stuck.failCommitFor = 'image-source-two';
	stuck.failDiscard = true;

	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13(transfers, discarding),
		/Commit refused for image-source-two/u,
	);
	await assert.rejects(
		() => stageFramescaperSessionClipboardImageBodiesV13(transfers, stuck),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.message, /V13 image body staging and cleanup failed/u);
			assert.match(String((error.errors[0] as Error).message), /Commit refused for image-source-two/u);
			assert.match(String((error.errors[1] as Error).message), /Discard refused for image-source-one/u);
			return true;
		},
	);
	assert.ok(discarding.calls.includes('discard:image-source-one'));
	assert.equal(discarding.bodies.has('image-source-one'), false);
});

test('rollback discards a staged publication until the caller marks the stage complete', async () => {
	const rolledBack = originStore();
	const kept = originStore();

	const discarded = await stageFramescaperSessionClipboardImageBodiesV13(
		[transferTo('copy', 'image-source', COPY)], rolledBack,
	);
	await discarded.rollback();
	const retained = await stageFramescaperSessionClipboardImageBodiesV13(
		[transferTo('copy', 'image-source', COPY)], kept,
	);
	retained.complete();
	await retained.rollback();

	assert.equal(rolledBack.bodies.has('image-source-copy'), false);
	assert.equal(kept.bodies.has('image-source-copy'), true);
	assert.deepEqual(kept.calls.filter((call) => call.startsWith('discard:')), []);
});

test('a rollback whose discards fail reports them as one aggregate failure', async () => {
	const store = originStore();
	const stage = await stageFramescaperSessionClipboardImageBodiesV13(
		[transferTo('copy', 'image-source', COPY)], store,
	);

	store.failDiscard = true;

	await assert.rejects(() => stage.rollback(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /V13 image body rollback failed/u);
		return true;
	});
});
