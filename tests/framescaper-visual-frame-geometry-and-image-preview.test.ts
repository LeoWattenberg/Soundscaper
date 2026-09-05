/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Two unrelated Framescaper modules are covered here. The first half exercises
 * the finishing export's exact visual frame geometry; the second half exercises
 * the timelineImage image-preview controller that installs the three lazy
 * preview routes on an editor controller.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { UnifiedExactRenderPlanV13 } from '../src/common/editor/unified-exact-render-plan.ts';
import type { VideoKeyframeExportFrame } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	productVideoVisualPreviewRuntimeFor,
	type ProductVideoVisualPreviewRuntime,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { bindFramescaperSelectedImagePreviewControllerTimelineImage as bindPreview }
	from '../src/framescaper/editor-selected-timeline-image-image-preview-controller.ts';
import {
	fillFramescaperVisualBackgroundFinishing as fillBackground,
	framescaperVisualSequencePositionFinishing as sequencePosition,
} from '../src/framescaper/video-export-visual-frame-geometry-finishing.ts';

type Rate = Readonly<{ readonly num: number; readonly den: number }>;

function frameAt(num: number, den: number): VideoKeyframeExportFrame {
	return Object.freeze({ index: 0, timelineSample: 0, timelinePosition: { num, den }, layers: [] });
}

function plan(
	sampleRate: number,
	sequenceRate: Rate,
	outputFrameRate: Rate = { num: 60, den: 1 },
): UnifiedExactRenderPlanV13 {
	return {
		version: 13,
		timebase: {
			sampleStart: 0, sampleDuration: sampleRate, sampleRate,
			sequenceId: 'sequence-1', sequenceRate,
		},
		output: { frameRate: outputFrameRate },
	} as unknown as UnifiedExactRenderPlanV13;
}

test('a one-second timeline position becomes the sequence position in plan frames', () => {
	const position = sequencePosition(frameAt(48_000, 1), plan(48_000, { num: 30_000, den: 1001 }));

	assert.deepEqual(position, { num: 30_000, den: 1001 });
	assert.ok(Object.isFrozen(position));
});

test('a sequence position is reduced to lowest terms, and equivalent inputs reduce alike', () => {
	const half = sequencePosition(frameAt(24_000, 1), plan(48_000, { num: 25, den: 1 }));
	const scaled = sequencePosition(frameAt(96_000, 4), plan(48_000, { num: 25, den: 1 }));

	assert.deepEqual(half, { num: 25, den: 2 });
	assert.deepEqual(scaled, half);
});

test('a zero timeline position resolves to zero over one rather than zero over the timebase', () => {
	assert.deepEqual(sequencePosition(frameAt(0, 1), plan(48_000, { num: 30_000, den: 1001 })), { num: 0, den: 1 });
});

test('a negative timeline position keeps its sign in the reduced numerator', () => {
	assert.deepEqual(
		sequencePosition(frameAt(-48_000, 1), plan(48_000, { num: 30_000, den: 1001 })),
		{ num: -30_000, den: 1001 },
	);
});

test('the sequence position follows the plan timebase rate, not the plan output frame rate', () => {
	const position = sequencePosition(frameAt(48_000, 1), plan(48_000, { num: 24, den: 1 }, { num: 60, den: 1 }));

	assert.deepEqual(position, { num: 24, den: 1 });
});

test('a sequence position whose numerator leaves the safe-integer domain is refused', () => {
	assert.throws(() => sequencePosition(frameAt(2 ** 60, 1), plan(1, { num: 1, den: 1 })), {
		name: 'RangeError',
		message: 'finishing visual sequence position exceeds its exact domain.',
	});
});

test('a sequence position whose denominator leaves the safe-integer domain is refused', () => {
	assert.throws(() => sequencePosition(frameAt(1, 2 ** 48), plan(48_000, { num: 1, den: 1 })), {
		name: 'RangeError',
		message: 'finishing visual sequence position exceeds its exact domain.',
	});
});

test('a fractional timeline position is refused instead of being rounded into the exact domain', () => {
	assert.throws(
		() => sequencePosition(frameAt(0.5, 1), plan(48_000, { num: 30_000, den: 1001 })),
		/cannot be converted to a BigInt/u,
	);
});

test('the background fill paints every pixel of the target with the canvas colour at full alpha', () => {
	const target = new Uint8Array(2 * 2 * 4);

	fillBackground(target, { backgroundColor: '#102030' }, 2, 2);

	assert.deepEqual([...target], [
		0x10, 0x20, 0x30, 255, 0x10, 0x20, 0x30, 255,
		0x10, 0x20, 0x30, 255, 0x10, 0x20, 0x30, 255,
	]);
});

test('the background fill accepts mixed-case hex and overwrites whatever the target already held', () => {
	const target = new Uint8Array(1 * 2 * 4).fill(9);

	fillBackground(target, { backgroundColor: '#AaBbCc' }, 1, 2);

	assert.deepEqual([...target], [170, 187, 204, 255, 170, 187, 204, 255]);
});

test('the background fill stays inside a target that views only part of its buffer', () => {
	const buffer = new ArrayBuffer(12);
	new Uint8Array(buffer).fill(7);

	fillBackground(new Uint8Array(buffer, 4, 8), { backgroundColor: '#010203' }, 2, 1);

	assert.deepEqual([...new Uint8Array(buffer)], [7, 7, 7, 7, 1, 2, 3, 255, 1, 2, 3, 255]);
});

test('a zero-area canvas fills nothing and still validates its colour', () => {
	const empty = new Uint8Array(0);

	fillBackground(empty, { backgroundColor: '#000000' }, 0, 5);

	assert.equal(empty.length, 0);
	assert.throws(() => fillBackground(empty, { backgroundColor: 'black' }, 0, 5), TypeError);
});

test('a target whose length disagrees with the declared geometry is refused', () => {
	for (const [length, width, height] of [[12, 2, 2], [20, 2, 2], [16, 2, 3]] as const) {
		assert.throws(() => fillBackground(new Uint8Array(length), { backgroundColor: '#ffffff' }, width, height), {
			name: 'RangeError',
			message: 'finishing visual output geometry changed.',
		});
	}
	// Only the total byte count is checked, so a reshape of the same area is admitted.
	assert.doesNotThrow(() => fillBackground(new Uint8Array(16), { backgroundColor: '#ffffff' }, 4, 1));
});

test('a canvas that is not a plain object is refused before any pixel is written', () => {
	const target = new Uint8Array(4).fill(3);

	for (const canvas of [null, undefined, 'canvas', 7, true, [{ backgroundColor: '#ffffff' }]]) {
		assert.throws(() => fillBackground(target, canvas, 1, 1), {
			name: 'TypeError',
			message: 'finishing visual canvas must be an object.',
		});
	}
	assert.deepEqual([...target], [3, 3, 3, 3]);
});

test('a background colour outside six-digit hex is refused before any pixel is written', () => {
	const target = new Uint8Array(4).fill(3);

	for (const backgroundColor of ['#abc', '#aabbccdd', '#12345g', 'rebeccapurple', '', '102030', undefined]) {
		assert.throws(() => fillBackground(target, { backgroundColor }, 1, 1), {
			name: 'TypeError',
			message: 'finishing visual background is invalid.',
		});
	}
	assert.deepEqual([...target], [3, 3, 3, 3]);
});

const PROFILE: unknown = Object.freeze({ id: 'timeline-image-preview-test-profile' });
const STORE = {} as unknown as AudioEditorProjectStore;

interface CloneCall {
	readonly profile: unknown;
	readonly project: unknown;
}

interface PreviewRoutes {
	readonly create: ProductVideoVisualPreviewRuntime['create'];
	readonly thumbnail: NonNullable<ProductVideoVisualPreviewRuntime['createProjectBinThumbnail']>;
	readonly filmstrip: NonNullable<ProductVideoVisualPreviewRuntime['createTimelineFilmstrip']>;
}

function routesOf(controller: object): PreviewRoutes {
	const runtime = productVideoVisualPreviewRuntimeFor(controller);
	assert.ok(runtime, 'the controller owns a bound visual-preview runtime.');
	assert.ok(runtime.createProjectBinThumbnail, 'the runtime owns a Project Bin thumbnail route.');
	assert.ok(runtime.createTimelineFilmstrip, 'the runtime owns a timeline filmstrip route.');
	return {
		create: runtime.create,
		thumbnail: runtime.createProjectBinThumbnail,
		filmstrip: runtime.createTimelineFilmstrip,
	};
}

/** A clone that records what the route handed it and then refuses with a recognizable type. */
function recordingRefusal(calls: CloneCall[]): (profile: unknown, project: unknown) => never {
	return (profile, project) => {
		calls.push({ profile, project });
		throw new EvalError('the stub timelineImage clone refused this project.');
	};
}

function boundController(cloneProject?: (profile: unknown, project: unknown) => never): object {
	const controller = {};
	bindPreview({
		controller, profile: PROFILE, store: STORE,
		...(cloneProject ? { cloneProject } : {}),
	});
	return controller;
}

test('binding refuses an owner that is not an object, including a function owner', () => {
	for (const controller of [null, undefined, 'controller', 7, true, () => undefined]) {
		assert.throws(() => bindPreview({ controller: controller as never, profile: PROFILE, store: STORE }), {
			name: 'TypeError',
			message: 'Selected timelineImage image preview requires a controller owner.',
		});
	}
	assert.throws(() => bindPreview(undefined as never), TypeError);
});

test('binding installs a frozen runtime carrying all three lazy preview routes', () => {
	const controller = {};
	assert.equal(productVideoVisualPreviewRuntimeFor(controller), null);

	bindPreview({ controller, profile: PROFILE, store: STORE });

	const runtime = productVideoVisualPreviewRuntimeFor(controller);
	assert.ok(runtime);
	assert.deepEqual(Object.keys(runtime), ['create', 'createProjectBinThumbnail', 'createTimelineFilmstrip']);
	assert.ok(Object.isFrozen(runtime));
	assert.equal(productVideoVisualPreviewRuntimeFor({}), null);
	assert.equal(productVideoVisualPreviewRuntimeFor('controller'), null);
});

test('rebinding a controller replaces its runtime and leaves another controller bound to its own', () => {
	const first = boundController();
	const firstRuntime = productVideoVisualPreviewRuntimeFor(first);
	const second = boundController();
	const secondRuntime = productVideoVisualPreviewRuntimeFor(second);

	bindPreview({ controller: first, profile: PROFILE, store: STORE });

	assert.notEqual(productVideoVisualPreviewRuntimeFor(first), firstRuntime);
	assert.equal(productVideoVisualPreviewRuntimeFor(second), secondRuntime);
	assert.notEqual(secondRuntime, firstRuntime);
});

test('every route hands the bound profile and the requested project to the timelineImage factory', async () => {
	const calls: CloneCall[] = [];
	const routes = routesOf(boundController(recordingRefusal(calls)));
	const project = { marker: 'requested project' };

	await assert.rejects(routes.create({ project, width: 320, height: 180 }), EvalError);
	await assert.rejects(routes.thumbnail({ project, width: 320, height: 180, clipId: 'clip-1' }), EvalError);
	await assert.rejects(routes.filmstrip({ project, width: 320, height: 180, frames: [] }), EvalError);

	assert.equal(calls.length, 3);
	assert.deepEqual(calls.map((call) => call.profile === PROFILE), [true, true, true]);
	assert.deepEqual(calls.map((call) => call.project === project), [true, true, true]);
});

test('a route without a clone override falls back to the authenticated timelineImage project clone', async () => {
	const routes = routesOf(boundController());

	await assert.rejects(routes.create({ project: {}, width: 320, height: 180 }), {
		name: 'TypeError',
		message: 'The authenticated Framescaper 1.0 runtime profile is required.',
	});
	await assert.rejects(routes.filmstrip({ project: {}, width: 320, height: 180, frames: [] }), {
		name: 'TypeError',
		message: 'The authenticated Framescaper 1.0 runtime profile is required.',
	});
	await assert.rejects(routes.thumbnail({ project: {}, width: 8, height: 6, clipId: 'clip-1' }), {
		name: 'TypeError',
		message: 'The authenticated Framescaper 1.0 runtime profile is required.',
	});
});

test('the filmstrip route resolves a frozen empty result when no cells are requested', async () => {
	const routes = routesOf(boundController(() => ({ clips: [], sources: [], sequences: [] }) as never));

	const frames = await routes.filmstrip({ project: {}, width: 320, height: 180, frames: [] });

	assert.deepEqual(frames, []);
	assert.ok(Object.isFrozen(frames));
});

test('the filmstrip route rejects an unbounded or malformed cell list', async () => {
	const routes = routesOf(boundController(() => ({ clips: [], sources: [], sequences: [] }) as never));
	const request = { project: {}, width: 320, height: 180 };

	await assert.rejects(routes.filmstrip({ ...request, frames: 'every frame' as never }), {
		name: 'RangeError',
		message: 'timelineImage timeline filmstrip requests must be a bounded array.',
	});
	await assert.rejects(routes.filmstrip({ ...request, frames: [null as never] }), {
		name: 'TypeError',
		message: 'timelineImage timeline filmstrip request 0 must be an object.',
	});
});

test('the Project Bin route hands the bound store and profile on to the inherited thumbnail', async () => {
	const cloned = { projectBin: { clips: [] } };
	const routes = routesOf(boundController(() => cloned as never));
	const inherited: Readonly<Record<string, unknown>>[] = [];
	const thumbnail = Object.freeze({
		clipId: 'clip-1', sourceId: 'source-1', width: 8, height: 6,
		pixels: new Uint8Array(8 * 6 * 4), opacity: 1, blendMode: 'normal',
		presentationIds: Object.freeze([]), maskIds: Object.freeze([]),
	});

	// The inherited factory rides in on the request, which the route spreads
	// underneath the profile and store the controller bound.
	const result = await routes.thumbnail({
		project: {}, width: 8, height: 6, clipId: 'clip-1',
		createInheritedThumbnail: (request: Readonly<Record<string, unknown>>) => {
			inherited.push(request);
			return Promise.resolve(thumbnail);
		},
	} as never);

	assert.equal(result, thumbnail);
	assert.equal(inherited.length, 1);
	assert.equal(inherited[0]?.store, STORE);
	assert.equal(inherited[0]?.profile, PROFILE);
	assert.equal(inherited[0]?.project, cloned);
	assert.equal(inherited[0]?.clipId, 'clip-1');
});

test('the Project Bin route refuses a clip identifier that is not a stable ID', async () => {
	const routes = routesOf(boundController(() => ({ projectBin: { clips: [] } }) as never));

	await assert.rejects(routes.thumbnail({ project: {}, width: 8, height: 6, clipId: '../clip' }), {
		name: 'TypeError',
		message: 'timelineImage Project Bin image clip ID must be a stable ID.',
	});
});

test('the preview route resolves no session for an image-free project with nothing inherited', async () => {
	const project = {
		primarySequenceId: 'sequence-1',
		sequences: [{ id: 'sequence-1', trackIds: [], rate: { num: 30, den: 1 } }],
		tracks: [], clips: [], sources: [],
	};
	const routes = routesOf(boundController(() => project as never));

	const session = await routes.create({
		project: {}, width: 320, height: 180,
		createInheritedSession: () => Promise.resolve(null),
	} as never);

	assert.equal(session, null);
});

test('the preview route refuses a canvas dimension the image compositor cannot honour', async () => {
	const project = {
		primarySequenceId: 'sequence-1',
		sequences: [{ id: 'sequence-1', trackIds: [], rate: { num: 30, den: 1 } }],
		tracks: [], clips: [], sources: [],
	};
	const routes = routesOf(boundController(() => project as never));

	await assert.rejects(routes.create({ project: {}, width: 0, height: 180 }), {
		name: 'RangeError',
		message: 'timelineImage preview width must be a positive bounded dimension.',
	});
});
