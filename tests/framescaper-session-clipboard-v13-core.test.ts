/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import {
	FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { applyFramescaperProjectCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-commands.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import {
	collectFramescaperSessionClipboardImageStorageKeysV13,
	createFramescaperSessionClipboardV13,
	framescaperSessionClipboardV12FoundationV13,
	normalizeFramescaperSessionClipboardV13,
} from '../src/framescaper/editor-session-clipboard-v13.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const NOW = '2026-09-04T09:00:00.000Z';
const IMAGE_KEY = 'image-clip:20:48000';
const ALT_IMAGE_KEY = 'image-clip:extra:60:48000';
const VIDEO_KEY = 'video-clip:0:48000';
const IMAGE_SHA = '1a'.repeat(32);
const ALT_SHA = '2b'.repeat(32);
const CLIPBOARD_FIELDS = [
	'clipBindings', 'descriptor', 'finishing', 'images', 'kind', 'ofxEffects', 'originProjectId',
	'originRevision', 'schemaVersion', 'sources',
];

function imageSource(id: string, contentSha256: string): Data {
	return {
		schemaVersion: 1, kind: 'image', id, name: `Image ${id}`, mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: id, contentSha256, assetByteLength: 4_096,
		original: {
			fileName: 'animated.png', mimeType: 'image/png', recognizedFormat: 'apng',
			byteLength: 1_024, sha256: contentSha256,
		},
		canonical: {
			width: 2, height: 1, hasAlpha: true, frameCount: 2, durationTicks: '5000000', timingMode: 'embedded',
		},
		conversionReceiptSha256: contentSha256,
	};
}

function imageClip(id: string, sourceId: string, sequenceStartFrame: number): Data {
	return {
		schemaVersion: 1, kind: 'image', id, sourceId, sequenceId: 'main-sequence',
		sequenceStartFrame, sequenceFrameCount: 10, sourceStartTicks: '0',
	};
}

function baseProject(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, framescaperV20Options() as never) as unknown as Data;
}

function withImage(
	project: Data, sourceId: string, clipId: string, sequenceStartFrame: number, sha: string,
): Data {
	const withSource = applyFramescaperProjectCommandTimelineImage(PROFILE, project, {
		type: 'image-source/set', sourceId, expectedSource: null, source: imageSource(sourceId, sha),
	} as never, { now: NOW });
	return applyFramescaperProjectCommandTimelineImage(PROFILE, withSource, {
		type: 'image-clip/set', clipId, expectedClip: null, expectedPlacement: null,
		clip: imageClip(clipId, sourceId, sequenceStartFrame),
		placement: { scope: 'timeline', trackId: 'video-track' },
	} as never, { now: NOW }) as unknown as Data;
}

function descriptorClip(key: string, sourceId: string): Data {
	return {
		key, kind: 'video', sourceId, offsetFrame: 0, sourceStartFrame: 0, durationFrames: 48_000,
		title: 'Copied', sourceDurationFrames: 48_000, trimStartFrames: 0, trimEndFrames: 0,
		groupId: null, avLinkId: null, color: 'auto', speedRatio: 1,
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
	};
}

function descriptorFor(project: Data, clips: readonly Data[], sourceTrackId = 'video-track'): Data {
	return {
		schemaVersion: 6, sampleRate: project.sampleRate, durationFrames: 48_000, annotations: [], takeGroups: [],
		tracks: [{
			sourceTrackId, sourceTrackName: 'Video', sourceTrackType: 'video', sourceLaneGroupId: null,
			sourceSequenceId: 'main-sequence', clips,
		}],
	};
}

function imageProject(): Data {
	return withImage(baseProject(), 'image-source', 'image-clip', 20, IMAGE_SHA);
}

function twoImageProject(): Data {
	return withImage(imageProject(), 'alt-image-source', 'image-clip:extra', 60, ALT_SHA);
}

function mixedDescriptor(project: Data): Data {
	return descriptorFor(project, [descriptorClip(VIDEO_KEY, 'video-source'), descriptorClip(IMAGE_KEY, 'image-source')]);
}

function copy(project: Data, descriptor: Data): Data {
	return createFramescaperSessionClipboardV13(PROFILE, project, descriptor as never) as unknown as Data;
}

function mixedClipboard(): Data {
	const project = imageProject();
	return copy(project, mixedDescriptor(project));
}

function wire(value: unknown): Data {
	return JSON.parse(JSON.stringify(value)) as Data;
}

function ids(sources: unknown): unknown[] {
	return (sources as Data[]).map(({ id }) => id);
}

function keysOf(descriptor: unknown): unknown[] {
	return ((descriptor as Data).tracks as Data[]).flatMap((track) => (track.clips as Data[]).map(({ key }) => key));
}

function refuse(value: unknown, message: RegExp): void {
	assert.throws(() => normalizeFramescaperSessionClipboardV13(value), message);
}

test('a v13 copy snapshots the selected image clip beside the exact foundation it filters out', () => {
	const project = imageProject();

	const clipboard = copy(project, mixedDescriptor(project));

	assert.equal(clipboard.schemaVersion, 13);
	assert.equal(clipboard.kind, 'framescaper-session-clipboard');
	assert.deepEqual([...Object.keys(clipboard)].sort(), CLIPBOARD_FIELDS);
	assert.deepEqual(clipboard.images, {
		schemaVersion: 1,
		kind: 'framescaper-image-fragment',
		sourceIds: ['image-source'],
		clips: [imageClip('image-clip', 'image-source', 20)],
	});
	assert.deepEqual(clipboard.clipBindings, [
		{ clipId: 'video-clip', descriptorKey: VIDEO_KEY },
		{ clipId: 'image-clip', descriptorKey: IMAGE_KEY },
	]);
	// The carried descriptor keeps both clips; only the V12 foundation sees the filtered one.
	assert.deepEqual(keysOf(clipboard.descriptor), [VIDEO_KEY, IMAGE_KEY]);
	assert.deepEqual(ids(clipboard.sources), ['image-source', 'video-source']);
});

test('a v13 copy carries the image source as normalized image authority, not as a generic source row', () => {
	const clipboard = mixedClipboard();

	const source = (clipboard.sources as Data[])[0]!;
	assert.deepEqual(source, imageSource('image-source', IMAGE_SHA));
	assert.equal(Object.isFrozen(source), true);
	assert.equal(Object.isFrozen((clipboard.images as Data).clips), true);
	assert.equal(Object.isFrozen(((clipboard.images as Data).clips as Data[])[0]), true);
});

test('a v13 copy leaves the image fragment empty when the selection names no image clip', () => {
	const project = imageProject();

	const clipboard = copy(project, descriptorFor(project, [descriptorClip(VIDEO_KEY, 'video-source')]));

	assert.deepEqual(clipboard.images, {
		schemaVersion: 1, kind: 'framescaper-image-fragment', sourceIds: [], clips: [],
	});
	assert.deepEqual(ids(clipboard.sources), ['video-source']);
	assert.deepEqual(clipboard.clipBindings, [{ clipId: 'video-clip', descriptorKey: VIDEO_KEY }]);
});

test('a v13 copy binds a descriptor key to the longest authored clip ID that prefixes it', () => {
	const project = twoImageProject();

	const clipboard = copy(project, descriptorFor(project, [
		descriptorClip(IMAGE_KEY, 'image-source'), descriptorClip(ALT_IMAGE_KEY, 'alt-image-source'),
	]));

	assert.deepEqual(clipboard.clipBindings, [
		{ clipId: 'image-clip', descriptorKey: IMAGE_KEY },
		{ clipId: 'image-clip:extra', descriptorKey: ALT_IMAGE_KEY },
	]);
	assert.deepEqual((clipboard.images as Data).sourceIds, ['alt-image-source', 'image-source']);
	assert.deepEqual(((clipboard.images as Data).clips as Data[]).map(({ id }) => id), [
		'image-clip', 'image-clip:extra',
	]);
});

test('a v13 copy demands the authenticated framescaper runtime profile', () => {
	const project = imageProject();

	assert.throws(
		() => createFramescaperSessionClipboardV13(null, project, mixedDescriptor(project) as never),
		{ name: 'TypeError', message: /authenticated Framescaper 1\.0 runtime profile is required/u },
	);
});

test('a v13 copy refuses a descriptor track the project does not author', () => {
	const project = imageProject();

	assert.throws(
		() => copy(project, descriptorFor(project, [descriptorClip(IMAGE_KEY, 'image-source')], 'ghost-track')),
		{ name: 'ReferenceError', message: /V13 descriptor track ghost-track is missing\./u },
	);
});

test('a v13 copy refuses a descriptor key that no authored clip ID prefixes', () => {
	const project = imageProject();

	assert.throws(
		() => copy(project, descriptorFor(project, [descriptorClip('ghost-clip:0:48000', 'video-source')])),
		{ name: 'ReferenceError', message: /V13 descriptor key ghost-clip:0:48000 has no authored clip\./u },
	);
});

test('a v13 copy refuses a descriptor whose image key names a source the image clip does not use', () => {
	const project = imageProject();

	assert.throws(
		() => copy(project, descriptorFor(project, [descriptorClip(IMAGE_KEY, 'video-source')])),
		{ name: 'ReferenceError', message: /V13 descriptor does not preserve image clip image-clip\./u },
	);
});

test('a v13 clipboard survives a JSON round trip unchanged', () => {
	const clipboard = mixedClipboard();

	assert.deepEqual(normalizeFramescaperSessionClipboardV13(wire(clipboard)), clipboard);
});

test('a v13 clipboard from another schema generation or kind demands a re-copy', () => {
	refuse({ ...wire(mixedClipboard()), schemaVersion: 12 }, /Framescaper session clipboard requires V13 re-copy\./u);
	refuse(
		{ ...wire(mixedClipboard()), kind: 'framescaper-finishing-clipboard' },
		/V13 clipboard kind is unsupported\./u,
	);
});

test('a v13 clipboard must be a record carrying exactly its schema fields as data', () => {
	const board = wire(mixedClipboard());
	const { images: _images, ...missing } = board;
	const accessor = { ...board };
	Object.defineProperty(accessor, 'images', { get: () => board.images, enumerable: true, configurable: true });

	refuse(null, /Framescaper session clipboard V13 must be a record\./u);
	refuse([board], /Framescaper session clipboard V13 must be a record\./u);
	refuse({ ...board, extra: 1 }, /must carry exactly its schema fields\./u);
	refuse(missing, /must carry exactly its schema fields\./u);
	refuse(accessor, /Framescaper session clipboard V13\.images must be data\./u);
});

test('a v13 image fragment must carry its own exact identity and fields', () => {
	const board = wire(mixedClipboard());

	refuse({ ...board, images: 'fragment' }, /Framescaper V13 image fragment must be a record\./u);
	refuse(
		{ ...board, images: { ...board.images as Data, schemaVersion: 2 } },
		/Framescaper V13 image fragment identity is unsupported\./u,
	);
	refuse(
		{ ...board, images: { ...board.images as Data, kind: 'framescaper-image-selection' } },
		/Framescaper V13 image fragment identity is unsupported\./u,
	);
	refuse(
		{ ...board, images: { ...board.images as Data, extra: [] } },
		/Framescaper V13 image fragment must carry exactly its schema fields\./u,
	);
});

test('a v13 image fragment requires bounded, stable, unique and sorted source IDs', () => {
	const board = wire(mixedClipboard());
	const withSourceIds = (sourceIds: unknown): Data => (
		{ ...board, images: { ...board.images as Data, sourceIds } }
	);

	refuse(withSourceIds('image-source'), /V13 image source IDs must be a bounded array\./u);
	refuse(withSourceIds(new Array(100_001)), /V13 image source IDs must be a bounded array\./u);
	refuse(withSourceIds([' image-source']), /V13 image sourceIds\[0\] must be a stable ID\./u);
	refuse(withSourceIds(['image-source', 'image-source']), /V13 image source IDs must be unique and sorted\./u);
	refuse(withSourceIds(['image-source', 'alt-image-source']), /V13 image source IDs must be unique and sorted\./u);
});

test('a v13 image fragment requires a bounded clip array with unique clip IDs', () => {
	const board = wire(mixedClipboard());
	const clip = ((board.images as Data).clips as Data[])[0]!;
	const withClips = (clips: unknown): Data => ({ ...board, images: { ...board.images as Data, clips } });

	refuse(withClips({ 0: clip }), /V13 image clips must be a bounded array\./u);
	refuse(withClips(new Array(100_001)), /V13 image clips must be a bounded array\./u);
	refuse(withClips([clip, { ...clip }]), /V13 image clip IDs must be unique\./u);
	refuse(withClips([{ ...clip, sequenceFrameCount: 0 }]), /sequenceFrameCount/u);
});

test('a v13 clipboard whose image source closure disagrees with its sources is refused', () => {
	const board = wire(mixedClipboard());
	const withSourceIds = (sourceIds: readonly string[]): Data => (
		{ ...board, images: { ...board.images as Data, sourceIds } }
	);

	refuse(withSourceIds([]), /V13 image source closure disagrees with its descriptor-owned sources\./u);
	refuse(
		withSourceIds(['image-source', 'unknown-image-source']),
		/V13 image source closure disagrees with its descriptor-owned sources\./u,
	);
});

test('a v13 image clip must name a selected image source and its own descriptor binding', () => {
	const board = wire(mixedClipboard());
	const clip = ((board.images as Data).clips as Data[])[0]!;
	const withClip = (overrides: Data): Data => (
		{ ...board, images: { ...board.images as Data, clips: [{ ...clip, ...overrides }] } }
	);

	refuse(
		withClip({ sourceId: 'alt-image-source' }),
		/V13 image clip image-clip has no selected image source\./u,
	);
	refuse(
		withClip({ id: 'unbound-image-clip' }),
		/V13 image clip unbound-image-clip has no matching descriptor binding\./u,
	);
});

test('a v13 clipboard requires bindings that cover every descriptor clip exactly once', () => {
	const board = wire(mixedClipboard());
	const bindings = board.clipBindings as Data[];

	refuse({ ...board, clipBindings: [bindings[0]] }, /V11 clip bindings must cover every descriptor clip exactly\./u);
	refuse(
		{ ...board, clipBindings: [...bindings, { clipId: 'video-clip', descriptorKey: IMAGE_KEY }] },
		/V11 clip bindings must be one-to-one\./u,
	);
	refuse(
		{ ...board, clipBindings: [bindings[0], { clipId: 'image-clip', descriptorKey: 'ghost-clip:0:1' }] },
		/V11 clip binding names unknown key ghost-clip:0:1\./u,
	);
});

test('a v13 clipboard requires source metadata for every descriptor-owned source', () => {
	const board = wire(mixedClipboard());

	refuse(
		{ ...board, sources: (board.sources as Data[]).filter(({ id }) => id !== 'video-source') },
		/Session clipboard source metadata is missing for video-source\./u,
	);
});

test('the v12 foundation of a v13 clipboard drops its image keys, clips and sources', () => {
	const clipboard = mixedClipboard();

	const foundation = framescaperSessionClipboardV12FoundationV13(clipboard) as unknown as Data;

	assert.equal(foundation.schemaVersion, 12);
	assert.equal(Object.hasOwn(foundation, 'images'), false);
	assert.deepEqual(keysOf(foundation.descriptor), [VIDEO_KEY]);
	assert.deepEqual(ids(foundation.sources), ['video-source']);
	assert.deepEqual(foundation.clipBindings, [{ clipId: 'video-clip', descriptorKey: VIDEO_KEY }]);
	assert.equal(foundation.originProjectId, clipboard.originProjectId);
	assert.equal(foundation.originRevision, clipboard.originRevision);
});

test('the v12 foundation of an image-only v13 clipboard keeps its track with no clips or sources', () => {
	const project = imageProject();
	const clipboard = copy(project, descriptorFor(project, [descriptorClip(IMAGE_KEY, 'image-source')]));

	const foundation = framescaperSessionClipboardV12FoundationV13(clipboard) as unknown as Data;

	assert.deepEqual(keysOf(foundation.descriptor), []);
	assert.deepEqual(foundation.sources, []);
	assert.deepEqual(foundation.clipBindings, []);
	assert.deepEqual(ids(clipboard.sources), ['image-source']);
});

test('the v12 foundation projection re-admits its input and refuses a non-v13 clipboard', () => {
	assert.throws(
		() => framescaperSessionClipboardV12FoundationV13({ ...wire(mixedClipboard()), schemaVersion: 12 }),
		/Framescaper session clipboard requires V13 re-copy\./u,
	);
});

test('image storage key collection returns the sorted keys of the selected image sources only', () => {
	const project = twoImageProject();
	const clipboard = copy(project, descriptorFor(project, [
		descriptorClip(VIDEO_KEY, 'video-source'),
		descriptorClip(IMAGE_KEY, 'image-source'),
		descriptorClip(ALT_IMAGE_KEY, 'alt-image-source'),
	]));

	const keys = collectFramescaperSessionClipboardImageStorageKeysV13(clipboard);

	assert.deepEqual([...keys], ['alt-image-source', 'image-source']);
	assert.equal(Object.isFrozen(keys), true);
});

test('image storage key collection returns nothing for a clipboard that selected no image', () => {
	const project = imageProject();
	const clipboard = copy(project, descriptorFor(project, [descriptorClip(VIDEO_KEY, 'video-source')]));

	assert.deepEqual(
		[...collectFramescaperSessionClipboardImageStorageKeysV13(clipboard)],
		[],
	);
});

test('image storage key collection re-admits the clipboard it is given', () => {
	assert.throws(
		() => collectFramescaperSessionClipboardImageStorageKeysV13({ ...wire(mixedClipboard()), extra: 1 }),
		/Framescaper session clipboard V13 must carry exactly its schema fields\./u,
	);
});
