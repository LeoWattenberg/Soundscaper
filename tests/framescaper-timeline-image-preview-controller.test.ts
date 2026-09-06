/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The timelineImage image-preview controller installs three lazy preview routes
 * on an editor controller; this covers what each of them does and what they
 * refuse. The exact visual frame geometry that shared this file was removed
 * with the finishing export module it belonged to.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	productVideoVisualPreviewRuntimeFor,
	type ProductVideoVisualPreviewRuntime,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { bindFramescaperSelectedImagePreviewControllerTimelineImage as bindPreview }
	from '../src/framescaper/editor-selected-timeline-image-image-preview-controller.ts';

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
