/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The sibling tests/framescaper-timeline-image-preview.test.ts covers the routes
 * an image-free project takes. This file drives the image compositor itself:
 * authenticated frame packs are published, loaded through a store, presented onto
 * drawables, and merged with the inherited finishing frame.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { ProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import {
	assetStore,
	binScene,
	binThumbnail,
	committedProject,
	drawableFactory,
	entriesOf,
	imageClip,
	imageFixture,
	IMAGE_FIXTURE,
	inherited,
	inheritedLog,
	installCanvasRuntime,
	openSession,
	previewFrame,
	scene,
	SECOND_PACK_FRAME_SAMPLE,
	twoClipTopology,
	type DrawableRequestTimelineImage,
	type RecordedDrawableTimelineImage,
	type StubCanvasRecordTimelineImage,
} from './helpers/framescaper-timeline-image-preview-fixture.ts';

type Data = Record<string, unknown>;

test('a timeline image clip resolves into a layer entry carrying its source, drawable and frame address', async () => {
	const drawables: RecordedDrawableTimelineImage[] = [];
	const session = await openSession({
		project: committedProject(IMAGE_FIXTURE), store: assetStore([IMAGE_FIXTURE]),
		createImageDrawable: drawableFactory(drawables),
	});

	const frame = session.resolve(SECOND_PACK_FRAME_SAMPLE);
	const entry = entriesOf(frame)[0] ?? {};

	assert.deepEqual(frame.layers.map(({ trackId, trackIndex }) => [trackId, trackIndex]), [['video-track', 0]]);
	assert.deepEqual({
		kind: entry.kind, role: entry.role, clipId: entry.clipId, sourceId: entry.sourceId,
		available: entry.available, opacity: entry.opacity, displayWidth: entry.displayWidth,
		displayHeight: entry.displayHeight, imageFrameIndex: entry.imageFrameIndex,
		imageSourceTicks: entry.imageSourceTicks,
	}, {
		kind: 'image', role: 'single', clipId: 'image-clip', sourceId: 'image-source',
		available: true, opacity: 1, displayWidth: 2, displayHeight: 1,
		imageFrameIndex: 1, imageSourceTicks: '1000000',
	});
	assert.equal((entry.video as Data | undefined)?.videoWidth, 2, 'the entry carries its own drawable');
	assert.ok(entry.renderDescription);
	assert.deepEqual(frame.ledger.requestedNodeIds, ['render:image:image-clip']);
	assert.deepEqual(frame.ledger.consumedNodeIds, ['render:image:image-clip']);
	assert.deepEqual(frame.ledger.omittedNodeIds, []);
	assert.deepEqual(drawables.map(({ request }) => request), [{
		clipId: 'image-clip', sourceId: 'image-source', width: 2, height: 1,
	}]);
	session.dispose();
});

test('a sample outside the clip sequence range composites no layer and requests no node', async () => {
	const drawables: RecordedDrawableTimelineImage[] = [];
	const session = await openSession({
		...scene({ clips: [imageClip('clip-a', 'image-source', { sequenceStartFrame: 20, sequenceFrameCount: 5 })] }),
		createImageDrawable: drawableFactory(drawables),
	});

	const frame = session.resolve(0);

	assert.deepEqual(frame.layers, []);
	assert.deepEqual(frame.ledger.requestedNodeIds, []);
	assert.deepEqual(drawables[0]?.presented, [], 'an inactive clip never presents onto its drawable');
	session.dispose();
});

test('the drawable is presented once per distinct frame index rather than once per resolve', async () => {
	const drawables: RecordedDrawableTimelineImage[] = [];
	const session = await openSession({ ...scene(), createImageDrawable: drawableFactory(drawables) });

	for (const sample of [0, 1, SECOND_PACK_FRAME_SAMPLE, SECOND_PACK_FRAME_SAMPLE + 1, 0]) session.resolve(sample);

	assert.equal(drawables.length, 1);
	assert.equal(drawables[0]?.presented.length, 3, 'only the two index changes and the return present');
	assert.notEqual(drawables[0]?.presented[0], drawables[0]?.presented[1]);
	assert.equal(drawables[0]?.presented[0], drawables[0]?.presented[2]);
	session.dispose();
});

test('two clips sharing one source open it once and still receive independently backed drawables', async () => {
	const calls: string[] = [];
	const drawables: RecordedDrawableTimelineImage[] = [];
	const session = await openSession({
		...scene({ calls, ...twoClipTopology() }), createImageDrawable: drawableFactory(drawables),
	});

	assert.deepEqual(calls, ['image-source'], 'the planned source map deduplicates by source identity');
	assert.deepEqual(drawables.map(({ request }) => request.clipId), ['clip-a', 'clip-b']);
	assert.deepEqual(entriesOf(session.resolve(0)).map((entry) => entry.clipId), ['clip-a']);
	session.dispose();
});

test('image sources are opened in identifier order however their clips are laid out', async () => {
	const calls: string[] = [];
	const session = await openSession(scene({
		calls,
		fixtures: [imageFixture('z-source'), imageFixture('a-source')],
		tracks: [{ id: 'video-track', clipIds: ['clip-z', 'clip-a'] }],
		clips: [
			imageClip('clip-z', 'z-source', { sequenceFrameCount: 5 }),
			imageClip('clip-a', 'a-source', { sequenceStartFrame: 5, sequenceFrameCount: 5 }),
		],
	}));

	assert.deepEqual(calls, ['a-source', 'z-source']);
	session.dispose();
});

test('the preview canvas is rounded down to an even size, and never below two pixels, before the fit', async () => {
	const fixtures = [imageFixture('image-source', 8, 4)];
	const odd: RecordedDrawableTimelineImage[] = [];
	const tiny: RecordedDrawableTimelineImage[] = [];

	// An odd 5x3 canvas becomes 4x2, so the 8x4 source halves rather than scaling by 0.625.
	const first = await openSession({
		...scene({ fixtures }), width: 5, height: 3, createImageDrawable: drawableFactory(odd),
	});
	const second = await openSession({
		...scene({ fixtures }), width: 1, height: 1, createImageDrawable: drawableFactory(tiny),
	});

	assert.deepEqual([odd[0]?.request.width, odd[0]?.request.height], [4, 2]);
	assert.deepEqual([tiny[0]?.request.width, tiny[0]?.request.height], [2, 1]);
	first.dispose();
	second.dispose();
});

test('the delivery fit reaches the composited image placement rather than defaulting to contain', async () => {
	const fixtures = [imageFixture('image-source', 2, 4)];
	const contain = await openSession({ ...scene({ fixtures }), fit: 'contain' });
	const cover = await openSession({ ...scene({ fixtures }), fit: 'cover' });

	assert.notDeepEqual(
		entriesOf(contain.resolve(0))[0]?.renderDescription,
		entriesOf(cover.resolve(0))[0]?.renderDescription,
	);
	contain.dispose();
	cover.dispose();
});

test('layers follow sequence track order and clips within a track sort by start frame then identity', async () => {
	const session = await openSession(scene({
		tracks: [{ id: 'track-upper', clipIds: ['clip-b', 'clip-a'] }, { id: 'track-lower', clipIds: ['clip-c'] }],
		clips: [imageClip('clip-c'), imageClip('clip-b'), imageClip('clip-a')],
	}));

	const frame = session.resolve(0);

	assert.deepEqual(frame.layers.map(({ trackId, trackIndex }) => [trackId, trackIndex]),
		[['track-upper', 0], ['track-lower', 1]]);
	assert.deepEqual(frame.layers[0]?.entries.map((entry) => entry.clipId), ['clip-a', 'clip-b']);
	assert.deepEqual(frame.ledger.requestedNodeIds,
		['render:image:clip-a', 'render:image:clip-b', 'render:image:clip-c']);
	session.dispose();
});

test('a hidden track, an audio track and an unsoloed sibling all withhold their images', async () => {
	const clips = [imageClip('clip-a'), imageClip('clip-b'), imageClip('clip-c')];
	const audio = { id: 'audio-track', type: 'audio', clipIds: ['clip-c'] } as const;
	const hidden = await openSession(scene({
		clips,
		tracks: [{ id: 'track-a', clipIds: ['clip-a'], hidden: true }, { id: 'track-b', clipIds: ['clip-b'] }, audio],
	}));
	const soloed = await openSession(scene({
		clips,
		tracks: [
			{ id: 'track-a', clipIds: ['clip-a'], hidden: true, solo: true },
			{ id: 'track-b', clipIds: ['clip-b'] }, audio,
		],
	}));

	assert.deepEqual(entriesOf(hidden.resolve(0)).map((entry) => entry.clipId), ['clip-b']);
	assert.deepEqual(entriesOf(soloed.resolve(0)).map((entry) => entry.clipId), ['clip-a'],
		'solo outranks the hidden flag on the soloed track itself');
	hidden.dispose();
	soloed.dispose();
});

test('more image contexts than the preview bound are refused before any source is opened', async () => {
	const calls: string[] = [];
	const clipIds = Array.from({ length: 4_097 }, (_clip, index) => `clip-${index}`);

	await assert.rejects(() => openSession(scene({
		calls, tracks: [{ id: 'video-track', clipIds }], clips: clipIds.map((id) => imageClip(id)),
	})), {
		name: 'RangeError',
		message: 'timelineImage image timeline preview exceeds its context count bound.',
	});
	assert.deepEqual(calls, []);
});

test('a project missing its primary sequence or an image source is refused by identity', async () => {
	await assert.rejects(() => openSession(scene({ primarySequenceId: 'other-sequence' })), {
		name: 'ReferenceError',
		message: 'The selected timelineImage primary sequence is unavailable.',
	});
	await assert.rejects(() => openSession(scene({ clips: [imageClip('clip-a', 'absent-source')] })), {
		name: 'ReferenceError',
		message: 'timelineImage image source absent-source is unavailable.',
	});
});

test('an inherited layer for the same track receives the image entries appended after its own', async () => {
	const log = inheritedLog();
	const session = await openSession({
		...scene(),
		createInheritedSession: inherited(log, {
			resolve: (timelineSample: number) => {
				log.samples.push(timelineSample);
				return previewFrame([
					{ trackId: 'video-track', trackIndex: 0, entries: [{ kind: 'video', clipId: 'video-clip' }] },
					{ trackId: 'other-track', trackIndex: 1, entries: [{ kind: 'video', clipId: 'other-clip' }] },
				], ['render:video:video-clip', 'render:image:clip-a']);
			},
		}),
	});

	const frame = session.resolve(0);

	assert.deepEqual(frame.layers.map(({ trackId }) => trackId), ['video-track', 'other-track']);
	assert.deepEqual(frame.layers[0]?.entries.map((entry) => entry.clipId), ['video-clip', 'clip-a'],
		'the inherited entry keeps its place beneath the image entry');
	assert.deepEqual(frame.ledger.requestedNodeIds, ['render:image:clip-a', 'render:video:video-clip'],
		'ledger ids are merged, deduplicated and sorted');
	assert.deepEqual(log.samples, [0]);
	session.dispose();
});

test('an inherited layer that claims a different index for a shared track is refused', async () => {
	const session = await openSession({
		...scene(),
		createInheritedSession: inherited(inheritedLog(), {
			resolve: () => previewFrame([{ trackId: 'video-track', trackIndex: 7, entries: [] }]),
		}),
	});

	assert.throws(() => session.resolve(0), {
		name: 'RangeError',
		message: 'timelineImage preview track order is ambiguous.',
	});
	session.dispose();
});

test('the inherited exact route is offered only while the session composites no image of its own', async () => {
	const exact = {
		renderExact: (request: Readonly<{ timelineSample: number }>) => Promise.resolve({
			frame: previewFrame([{ trackId: 'exact-track', trackIndex: 3, entries: [] }], ['render:exact']),
			layers: [{ sample: request.timelineSample }],
			renderedEffectIds: ['effect-1'],
		}),
	} as Partial<ProductVideoVisualPreviewSession>;
	const withImage = await openSession({ ...scene(), createInheritedSession: inherited(inheritedLog(), exact) });
	const withoutImage = await openSession({
		...scene({ tracks: [{ id: 'video-track', clipIds: [] }], clips: [] }),
		createInheritedSession: inherited(inheritedLog(), exact),
	});

	assert.deepEqual(Object.keys(withImage), ['resolve', 'resolveTransitionWeight', 'dispose']);
	assert.deepEqual(Object.keys(withoutImage), ['resolve', 'resolveTransitionWeight', 'renderExact', 'dispose']);
	const rendered = await withoutImage.renderExact!({ timelineSample: 96_000, mediaLayers: [] });
	assert.deepEqual(rendered.layers, [{ sample: 96_000 }]);
	assert.deepEqual(rendered.renderedEffectIds, ['effect-1']);
	assert.deepEqual(rendered.frame.ledger.requestedNodeIds, ['render:exact']);
	await assert.rejects(() => withoutImage.renderExact!({ timelineSample: -1, mediaLayers: [] }), {
		name: 'RangeError',
		message: 'timelineImage preview sample must be non-negative.',
	});
	withImage.dispose();
	withoutImage.dispose();
});

test('both preview routes failing raises an aggregate carrying each underlying reason', async () => {
	const reason = new EvalError('the inherited session refused');

	await assert.rejects(
		() => openSession({ ...scene({ stored: [] }), createInheritedSession: () => Promise.reject(reason) }),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.message, 'The timelineImage inherited and image preview routes both failed.');
			assert.equal(error.errors[0], reason);
			assert.match(String((error.errors[1] as Error).message), /is unavailable or has the wrong byte length/u);
			return true;
		},
	);
});

test('a failed image load disposes the inherited session and surfaces the store failure', async () => {
	const log = inheritedLog();

	await assert.rejects(
		() => openSession({ ...scene({ stored: [] }), createInheritedSession: inherited(log) }),
		/is unavailable or has the wrong byte length/u,
	);
	assert.equal(log.disposals, 1, 'the inherited session is released when the image route fails');
});

test('a failed inherited session surfaces its own reason once the images have already loaded', async () => {
	const reason = new EvalError('the inherited session refused');
	const calls: string[] = [];

	await assert.rejects(
		() => openSession({ ...scene({ calls }), createInheritedSession: () => Promise.reject(reason) }),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
	assert.deepEqual(calls, ['image-source'], 'the image route still ran and its frames are released');
});

test('a composition cancelled mid-load disposes the inherited session and reports the caller reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled mid-load');
	const log = inheritedLog();
	const store = {
		loadMediaAsset() {
			controller.abort(reason);
			return Promise.resolve(new Blob([IMAGE_FIXTURE.bytes as Uint8Array<ArrayBuffer>]));
		},
	} as unknown as AudioEditorProjectStore;

	await assert.rejects(() => openSession({
		...scene(), store, signal: controller.signal, createInheritedSession: inherited(log),
	}), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
	assert.equal(log.disposals, 1);
});

test('a drawable whose geometry disagrees with the fitted source is refused and everything is released', async () => {
	const drawables: RecordedDrawableTimelineImage[] = [];
	const log = inheritedLog();
	const sound = drawableFactory(drawables);
	const broken = drawableFactory(drawables, { videoWidth: 99 });
	let created = 0;

	await assert.rejects(() => openSession({
		...scene(twoClipTopology()),
		createImageDrawable: (request: DrawableRequestTimelineImage) => (
			(created += 1) === 2 ? broken(request) : sound(request)
		),
		createInheritedSession: inherited(log),
	}), {
		name: 'TypeError',
		message: 'A timelineImage image preview drawable has invalid dimensions or lifecycle ports.',
	});
	assert.deepEqual(drawables.map(({ disposals }) => disposals), [1, 1],
		'the accepted drawable and the refused one are both released');
	assert.equal(log.disposals, 1);
});

test('a drawable that throws while being disposed does not block its siblings or the inherited session', async () => {
	const drawables: RecordedDrawableTimelineImage[] = [];
	const log = inheritedLog();
	const session = await openSession({
		...scene(twoClipTopology()),
		createImageDrawable: drawableFactory(drawables, { disposeError: new Error('drawable release failed') }),
		createInheritedSession: inherited(log, {
			dispose() { log.disposals += 1; throw new Error('inherited release failed'); },
		}),
	});

	session.dispose();
	session.dispose();

	assert.deepEqual(drawables.map(({ disposals }) => disposals), [1, 1]);
	assert.equal(log.disposals, 1);
	assert.throws(() => session.resolve(0), {
		name: 'Error',
		message: 'The selected timelineImage image preview session is disposed.',
	});
	assert.throws(() => session.resolveTransitionWeight('clip-a', 0), /is disposed/u);
});

test('a transition weight is null without an inherited route, which also leaves its sample unchecked', async () => {
	const session = await openSession(scene());
	const inheriting = await openSession({ ...scene(), createInheritedSession: inherited(inheritedLog()) });

	assert.equal(session.resolveTransitionWeight('clip-a', 0), null);
	// Both arguments sit inside the optional inherited call, so an absent route skips their checks.
	assert.equal(session.resolveTransitionWeight('clip-a', -1), null);
	assert.throws(() => inheriting.resolveTransitionWeight('clip-a', -1), /must be non-negative/u);
	session.dispose();
	inheriting.dispose();
});

test('a Project Bin image thumbnail is scaled from the frame its clip starts on', async () => {
	const thumbnail = await binThumbnail(binScene());

	assert.deepEqual({
		clipId: thumbnail.clipId, sourceId: thumbnail.sourceId, width: thumbnail.width,
		height: thumbnail.height, opacity: thumbnail.opacity, blendMode: thumbnail.blendMode,
		presentationIds: thumbnail.presentationIds, maskIds: thumbnail.maskIds,
		length: thumbnail.pixels.length,
	}, {
		clipId: 'bin-image', sourceId: 'image-source', width: 4, height: 2, opacity: 1,
		blendMode: 'normal', presentationIds: [], maskIds: [], length: 4 * 2 * 4,
	});
	assert.ok(Object.isFrozen(thumbnail));
	// Nearest neighbour doubles the 2x1 source along both axes.
	assert.deepEqual([...thumbnail.pixels.subarray(0, 4)], [...thumbnail.pixels.subarray(4, 8)]);
	assert.deepEqual([...thumbnail.pixels.subarray(0, 16)], [...thumbnail.pixels.subarray(16, 32)]);
});

test('a Project Bin image thumbnail follows its clip source-start ticks onto the later frame', async () => {
	const first = await binThumbnail(binScene('0'));
	const second = await binThumbnail(binScene('1000000'));

	assert.notDeepEqual([...first.pixels], [...second.pixels]);
});

test('a Project Bin image thumbnail refuses a non-positive or unbounded requested size', async () => {
	await assert.rejects(() => binThumbnail({ ...binScene(), width: 0 }), {
		name: 'RangeError',
		message: 'timelineImage Project Bin thumbnail width must be a positive bounded dimension.',
	});
	await assert.rejects(() => binThumbnail({ ...binScene(), height: 65_537 }), {
		name: 'RangeError',
		message: 'timelineImage Project Bin thumbnail height must be a positive bounded dimension.',
	});
});

test('the default drawable presents through a 2D canvas context and clears it on disposal', async () => {
	const record: StubCanvasRecordTimelineImage = { puts: [], cleared: 0 };
	const restore = installCanvasRuntime({
		putImageData: (image: Readonly<{ data: Uint8ClampedArray; width: number; height: number }>) => {
			record.puts.push({ width: image.width, height: image.height, length: image.data.length });
		},
		clearRect: () => { record.cleared += 1; },
	});
	try {
		const session = await openSession({ ...scene(), createImageDrawable: undefined });
		session.resolve(0);
		session.dispose();
	} finally { restore(); }

	assert.deepEqual(record.puts, [{ width: 2, height: 1, length: 8 }]);
	assert.equal(record.cleared, 1);
});

test('the default drawable refuses a runtime with no canvas element and one with no 2D context', async () => {
	const globals = globalThis as unknown as Data;
	const priorDocument = globals.document;
	const priorImageData = globals.ImageData;
	delete globals.document;
	delete globals.ImageData;
	try {
		await assert.rejects(() => openSession({ ...scene(), createImageDrawable: undefined }), {
			name: 'Error',
			message: 'Selected timelineImage image preview requires a browser canvas runtime.',
		});
	} finally {
		globals.document = priorDocument;
		globals.ImageData = priorImageData;
	}

	const restore = installCanvasRuntime(null);
	try {
		await assert.rejects(() => openSession({ ...scene(), createImageDrawable: undefined }), {
			name: 'Error',
			message: 'Selected timelineImage image preview has no 2D canvas context.',
		});
	} finally { restore(); }
});
