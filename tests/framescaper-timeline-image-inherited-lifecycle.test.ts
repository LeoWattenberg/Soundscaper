/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { chunkGroupForModulePath, EDITOR_OPTIONAL_SURFACE_CHUNK_TEST } from '../scripts/lib/build-chunk-groups.mjs';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';

import type {
	ProductVideoVisualPreviewCreateRequest,
	ProductVideoVisualPreviewSession,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperSelectedVisualPreviewSessionTimelineImage as createSession,
} from '../src/framescaper/editor-selected-timeline-image-image-preview.ts';
import { createDefaultInheritedSession } from '../src/framescaper/timeline-image-native-preview-companions.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import {
	assetStore, committedProject, drawableFactory, imageFixture, installCanvasRuntime, previewFrame,
	type RecordedDrawableTimelineImage,
} from './helpers/framescaper-timeline-image-preview-fixture.ts';

type ExactRequest = Parameters<NonNullable<ProductVideoVisualPreviewSession['renderExact']>>[0];

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => { release = resolve; });
	return { promise, release };
}

function inheritedFixture(cleanupFailure?: Readonly<{ reason: unknown }>, fulfillAfterAbort = false) {
	const entered = gate(), frameGate = gate(), cleanupGate = gate(), idle = gate(), closeEntered = gate();
	const retirement = new AbortController();
	const events: string[] = [];
	let factorySignal: AbortSignal | undefined;
	let requestSignal: AbortSignal | undefined;
	let combined: AbortSignal | undefined;
	let rendering = false;
	let closePromise: Promise<void> | undefined;
	const inherited: ProductVideoVisualPreviewSession = {
		resolve() { assert.equal(this, inherited); return previewFrame(); },
		resolveTransitionWeight() { assert.equal(this, inherited); return null; },
		async renderExact(request) {
			assert.equal(this, inherited);
			rendering = true;
			requestSignal = request.signal;
			combined = AbortSignal.any([
				...(factorySignal ? [factorySignal] : []),
				...(request.signal ? [request.signal] : []), retirement.signal,
			]);
			combined.addEventListener('abort', () => { events.push('frame-abort'); }, { once: true });
			entered.release();
			try {
				await frameGate.promise;
				if (!fulfillAfterAbort) combined.throwIfAborted();
				events.push('publish');
				return { frame: previewFrame(), layers: [], renderedEffectIds: [] };
			} finally { idle.release(); }
		},
		close() {
			assert.equal(this, inherited);
			if (closePromise) return closePromise;
			closeEntered.release();
			events.push('close');
			retirement.abort(new DOMException('Inherited retirement.', 'AbortError'));
			closePromise = (async () => {
				if (rendering) await idle.promise;
				await cleanupGate.promise;
				events.push('cleanup');
				if (cleanupFailure) throw cleanupFailure.reason;
			})();
			return closePromise;
		},
		dispose() {
			assert.equal(this, inherited);
			events.push('dispose');
			void inherited.close!().catch(() => undefined);
		},
	};
	return {
		inherited, entered, frameGate, cleanupGate, closeEntered, events,
		get factorySignal() { return factorySignal; },
		get requestSignal() { return requestSignal; },
		get combined() { return combined; },
		factory(request: ProductVideoVisualPreviewCreateRequest) {
			factorySignal = request.signal;
			return Promise.resolve(inherited);
		},
		async cleanup() {
			frameGate.release(); cleanupGate.release();
			await inherited.close!().catch(() => undefined);
		},
	};
}

function request(signal?: AbortSignal) {
	return {
		profile: PROFILE,
		project: createFramescaperProjectTimelineImage(PROFILE, framescaperV20Options()),
		store: assetStore([]), width: 2, height: 2, signal,
	};
}

function observe<T>(promise: Promise<T>) {
	let settled = false;
	const joined = promise.then(
		(value) => { settled = true; return { ok: true as const, value }; },
		(error: unknown) => { settled = true; return { ok: false as const, error }; },
	);
	return { joined, get settled() { return settled; } };
}

for (const cut of ['caller-abort', 'image-load-failure'] as const) {
	test(`creation joins a late fulfilled inherited current session after ${cut}`, async (context) => {
		const fixture = inheritedFixture(), stop = new AbortController();
		const factoryEntered = gate(), factoryGate = gate();
		const reason = Object.freeze({ failure: cut });
		const image = imageFixture('creation-cleanup-image'), store = assetStore([image]);
		if (cut === 'image-load-failure') {
			context.mock.method(store, 'loadMediaAsset', () => Promise.reject(reason));
		}
		const options = request(stop.signal);
		const creating = observe(createSession({
			...options,
			...(cut === 'image-load-failure' ? { project: committedProject(image), store } : {}),
			async createInheritedSession() {
				factoryEntered.release();
				await factoryGate.promise;
				return fixture.inherited;
			},
		}));
		try {
			await factoryEntered.promise;
			if (cut === 'caller-abort') stop.abort(reason);
			factoryGate.release();
			await fixture.closeEntered.promise;
			await nextTurn();
			assert.equal(creating.settled, false, 'creation must join the independently held inherited close');
			assert.equal(fixture.events.filter((event) => event === 'close').length, 1);
			fixture.cleanupGate.release();
			const result = await creating.joined;
			assert.ok(!result.ok && Object.is(result.error, reason), 'joined cleanup must preserve the primary failure');
			assert.equal(fixture.events.at(-1), 'cleanup');
		} finally {
			factoryGate.release();
			await fixture.cleanup();
			await creating.joined;
		}
	});
}

for (const failure of ['same-opaque', 'distinct-opaque', 'undefined-primary'] as const) {
	test(`failed creation joins and preserves ${failure} cleanup evidence`, async (context) => {
		let traps = 0;
		const opaqueTrap = (): never => { traps += 1; throw new Error('Opaque creation failures must not be reflected.'); };
		const opaque = () => new Proxy(Object.freeze({}), {
			get: opaqueTrap, getPrototypeOf: opaqueTrap, getOwnPropertyDescriptor: opaqueTrap, ownKeys: opaqueTrap,
		});
		const primary = failure === 'undefined-primary' ? undefined : opaque();
		const cleanup = failure === 'same-opaque' ? primary : opaque();
		const fixture = inheritedFixture({ reason: cleanup });
		const image = imageFixture('failed-creation-image'), store = assetStore([image]);
		context.mock.method(store, 'loadMediaAsset', () => Promise.reject(primary));
		const creating = observe(createSession({ ...request(), project: committedProject(image), store,
			createInheritedSession: fixture.factory }));
		try {
			await fixture.closeEntered.promise;
			await nextTurn();
			assert.equal(creating.settled, false);
			fixture.cleanupGate.release();
			const result = await creating.joined;
			assert.equal(result.ok, false);
			if (!result.ok && failure === 'same-opaque') assert.ok(Object.is(result.error, primary));
			else if (!result.ok) {
				assert.ok(result.error instanceof AggregateError);
				assert.equal(result.error.errors.length, 2);
				assert.ok(Object.is(result.error.errors[0], primary));
				assert.ok(Object.is(result.error.errors[1], cleanup));
				assert.ok(Object.hasOwn(result.error, 'cause'));
				assert.ok(Object.is(result.error.cause, primary));
			}
			assert.equal(traps, 0);
		} finally { await fixture.cleanup(); await creating.joined; }
	});
}

for (const throwingDispose of [false, true]) {
	test(`failed creation retains legacy dispose-only compatibility with throwing=${throwingDispose}`, async (context) => {
		const primary = Object.freeze({ primary: 'legacy image failure' });
		const image = imageFixture('legacy-failed-image'), store = assetStore([image]);
		context.mock.method(store, 'loadMediaAsset', () => Promise.reject(primary));
		let disposals = 0;
		const legacy: ProductVideoVisualPreviewSession = {
			resolve: () => previewFrame(), resolveTransitionWeight: () => null,
			dispose() { assert.equal(this, legacy); disposals += 1; if (throwingDispose) throw new Error('Legacy disposal.'); },
		};
		const result = await observe(createSession({ ...request(), project: committedProject(image), store,
			createInheritedSession: () => Promise.resolve(legacy) })).joined;
		assert.ok(!result.ok && Object.is(result.error, primary));
		assert.equal(disposals, 1);
		assert.deepEqual(Object.keys(legacy).sort(), ['dispose', 'resolve', 'resolveTransitionWeight']);
	});
}

test('the extracted composition shares the exact optional preview owner without claiming sibling names', () => {
	const path = 'src/framescaper/editor-selected-timeline-image-image-preview-session.ts';
	for (const candidate of [path, path.replaceAll('/', '\\')]) {
		assert.ok(EDITOR_OPTIONAL_SURFACE_CHUNK_TEST.test(candidate));
		assert.equal(chunkGroupForModulePath(candidate), 'editor-optional-surfaces');
	}
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-selected-timeline-image-image-preview.ts'), 'editor-optional-surfaces');
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-selected-timeline-image-image-preview-controller.ts'), 'framescaper-timeline-images');
	assert.equal(EDITOR_OPTIONAL_SURFACE_CHUNK_TEST.test(path.replace('.ts', '-controller.ts')), false);
});

test('the actual default native companion retains its joined retirement port', async () => {
	const restore = installCanvasRuntime({ putImageData() {}, clearRect() {} });
	try {
		const options = request();
		const inherited = await createDefaultInheritedSession(options, options.store);
		assert.ok(inherited?.renderExact);
		assert.equal(typeof inherited.close, 'function');
		await inherited.close!();
	} finally { restore(); }
});

test('mid-creation cancellation retains one opaque caller reason after both branches join', async (context) => {
	const image = imageFixture('cancelled-image'), stop = new AbortController();
	const inheritedGate = gate(), loadGate = gate(), inheritedEntered = gate(), loadEntered = gate();
	const store = assetStore([image]);
	let traps = 0;
	const opaqueTrap = (): never => { traps += 1; throw new Error('An opaque cancellation must not be inspected.'); };
	const reason = new Proxy(Object.freeze({}), {
		get: opaqueTrap, getPrototypeOf: opaqueTrap, getOwnPropertyDescriptor: opaqueTrap, ownKeys: opaqueTrap,
	});
	const load = store.loadMediaAsset.bind(store);
	context.mock.method(store, 'loadMediaAsset', async (...args: Parameters<typeof load>) => {
		loadEntered.release();
		await loadGate.promise;
		return load(...args);
	});
	const creating = observe(createSession({
		...request(stop.signal), project: committedProject(image), store,
		async createInheritedSession(options) {
			inheritedEntered.release();
			await inheritedGate.promise;
			options.signal?.throwIfAborted();
			return null;
		},
	}));
	try {
		await Promise.all([inheritedEntered.promise, loadEntered.promise]);
		stop.abort(reason);
		assert.equal(creating.settled, false);
		inheritedGate.release();
		await Promise.resolve(); await Promise.resolve();
		assert.equal(creating.settled, false, 'the sibling image load must still join');
		loadGate.release();
		const result = await creating.joined;
		assert.equal(result.ok, false);
		assert.ok(!result.ok && Object.is(result.error, reason), 'both cancelled branches must preserve the caller reason');
		assert.equal(traps, 0);
	} finally {
		inheritedGate.release(); loadGate.release();
		await creating.joined;
	}
});

test('identical opaque creation failures remain two route failures without caller cancellation', async (context) => {
	const image = imageFixture('failed-image'), store = assetStore([image]);
	let traps = 0;
	const opaqueTrap = (): never => { traps += 1; throw new Error('An opaque failure must not be inspected.'); };
	const reason = new Proxy(Object.freeze({}), {
		get: opaqueTrap, getPrototypeOf: opaqueTrap, getOwnPropertyDescriptor: opaqueTrap, ownKeys: opaqueTrap,
	});
	context.mock.method(store, 'loadMediaAsset', () => Promise.reject(reason));
	const result = await observe(createSession({
		...request(new AbortController().signal), project: committedProject(image), store,
		createInheritedSession: () => Promise.reject(reason),
	})).joined;
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.ok(result.error instanceof AggregateError);
		assert.equal(result.error.errors.length, 2);
		assert.ok(Object.is(result.error.errors[0], reason));
		assert.ok(Object.is(result.error.errors[1], reason));
	}
	assert.equal(traps, 0);
});

test('the authenticated wrapper carries its factory signal into the inherited combined render', async () => {
	const fixture = inheritedFixture();
	const stop = new AbortController();
	const reason = Object.freeze({ cancellation: 'factory' });
	let wrapper: ProductVideoVisualPreviewSession | null = null;
	try {
		wrapper = await createSession({ ...request(stop.signal), createInheritedSession: fixture.factory });
		assert.ok(wrapper?.renderExact);
		const rendered = observe(wrapper.renderExact({ timelineSample: 0, mediaLayers: [] }));
		await fixture.entered.promise;
		stop.abort(reason);
		assert.equal(fixture.factorySignal, stop.signal, 'factory cancellation must reach the inherited owner');
		assert.equal(fixture.combined?.reason, reason);
		assert.equal(rendered.settled, false, 'abort still joins the held inherited frame');
		fixture.frameGate.release();
		const result = await rendered.joined;
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error, reason);
		assert.equal(fixture.events.includes('publish'), false);
	} finally { wrapper?.dispose(); await fixture.cleanup(); }
});

test('the wrapper carries the exact request signal and original borrowed render receiver', async () => {
	const fixture = inheritedFixture();
	const stop = new AbortController();
	const reason = Object.freeze({ cancellation: 'frame' });
	let wrapper: ProductVideoVisualPreviewSession | null = null;
	try {
		wrapper = await createSession({ ...request(), createInheritedSession: fixture.factory });
		assert.ok(wrapper?.renderExact);
		const exact: ExactRequest = { timelineSample: 0, mediaLayers: [], signal: stop.signal };
		const rendered = observe(wrapper.renderExact(exact));
		await fixture.entered.promise;
		stop.abort(reason);
		assert.equal(fixture.requestSignal, stop.signal, 'per-frame cancellation must reach the inherited owner');
		assert.equal(fixture.combined?.reason, reason);
		assert.equal(rendered.settled, false);
		fixture.frameGate.release();
		const result = await rendered.joined;
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error, reason);
		assert.equal(fixture.events.includes('publish'), false);
	} finally { wrapper?.dispose(); await fixture.cleanup(); }
});

test('wrapper retirement revokes publication and joins both the held inherited frame and cleanup', async () => {
	const fixture = inheritedFixture();
	let wrapper: ProductVideoVisualPreviewSession | null = null;
	try {
		wrapper = await createSession({ ...request(), createInheritedSession: fixture.factory });
		assert.ok(wrapper?.renderExact);
		const rendered = observe(wrapper.renderExact({ timelineSample: 0, mediaLayers: [] }));
		await fixture.entered.promise;
		assert.equal(typeof wrapper.close, 'function', 'current inherited retirement must stay joined through the wrapper');
		const pending = wrapper.close!();
		assert.equal(wrapper.close!(), pending);
		const closing = observe(pending);
		assert.throws(() => wrapper!.resolve(0), /disposed/u);
		assert.deepEqual(fixture.events, ['close', 'frame-abort']);
		assert.equal(closing.settled, false);
		fixture.frameGate.release();
		assert.equal((await rendered.joined).ok, false);
		assert.equal(closing.settled, false, 'joined retirement must also await independent cleanup');
		fixture.cleanupGate.release();
		assert.equal((await closing.joined).ok, true);
		assert.deepEqual(fixture.events, ['close', 'frame-abort', 'cleanup']);
	} finally { wrapper?.dispose(); await fixture.cleanup(); }
});

test('the actual coordinator discards a late fulfilled inherited frame without poisoning replacement', async () => {
	const fixture = inheritedFixture(undefined, true), replacement = inheritedFixture();
	const published: string[] = [], errors: unknown[] = [];
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('a hard barrier cannot redraw'), { mode: 'continuous' });
	let wrapper: ProductVideoVisualPreviewSession | null = null;
	let next: ProductVideoVisualPreviewSession | null = null;
	let running: Promise<void> | undefined;
	try {
		wrapper = await createSession({ ...request(), createInheritedSession: fixture.factory });
		assert.ok(wrapper?.renderExact);
		const render = wrapper.renderExact.bind(wrapper);
		running = coordinator.run({
			render: (signal) => render({ timelineSample: 0, mediaLayers: [], signal }),
			isCurrent: () => true, publish: () => { published.push('old'); },
			onError: (error) => { errors.push(error); },
		});
		await fixture.entered.promise;
		const barrier = observe(coordinator.supersede());
		const closing = observe(wrapper.close!());
		assert.equal(fixture.requestSignal?.aborted, true);
		assert.equal(fixture.combined?.reason, fixture.requestSignal?.reason);
		fixture.frameGate.release();
		await running;
		assert.equal((await barrier.joined).ok, true, 'a late successful render must not create a sticky cancellation mismatch');
		assert.equal(closing.settled, false, 'inherited retirement still joins independent cleanup');
		assert.equal(published.length, 0);
		assert.equal(errors.length, 0);
		assert.ok(fixture.events.includes('publish'), 'the borrowed renderer genuinely fulfilled after cancellation');
		fixture.cleanupGate.release();
		assert.equal((await closing.joined).ok, true);
		next = await createSession({ ...request(), createInheritedSession: replacement.factory });
		assert.ok(next?.renderExact);
		const renderNext = next.renderExact.bind(next);
		replacement.frameGate.release();
		await coordinator.run({
			render: (signal) => renderNext({ timelineSample: 0, mediaLayers: [], signal }),
			isCurrent: () => true, publish: () => { published.push('replacement'); },
			onError: (error) => { errors.push(error); },
		});
		assert.deepEqual(published, ['replacement']);
		assert.equal(errors.length, 0);
	} finally {
		wrapper?.dispose(); next?.dispose();
		await Promise.all([fixture.cleanup(), replacement.cleanup()]);
		await running;
		await coordinator.retire().catch(() => undefined);
	}
});

test('wrapper joined retirement preserves opaque inherited failure and still releases admitted image resources', async () => {
	let traps = 0;
	const reason = new Proxy(Object.freeze({}), {
		get() { traps += 1; throw new Error('An opaque cleanup reason must not be inspected.'); },
	});
	const fixture = inheritedFixture({ reason });
	const image = imageFixture('owned-image');
	const drawables: RecordedDrawableTimelineImage[] = [];
	let wrapper: ProductVideoVisualPreviewSession | null = null;
	try {
		wrapper = await createSession({
			...request(), project: committedProject(image), store: assetStore([image]),
			createImageDrawable: drawableFactory(drawables), createInheritedSession: fixture.factory,
		});
		assert.ok(wrapper);
		assert.equal(drawables.length, 1);
		assert.equal(typeof wrapper.close, 'function');
		const closing = observe(wrapper.close!());
		assert.equal(closing.settled, false);
		assert.equal(drawables[0]!.disposals, 0, 'image cleanup must await the inherited owner');
		fixture.cleanupGate.release();
		const result = await closing.joined;
		assert.equal(result.ok, false);
		if (!result.ok) assert.ok(Object.is(result.error, reason));
		assert.equal(traps, 0);
		assert.equal(drawables[0]!.disposals, 1, 'a failed inherited close must still release image resources');
		assert.throws(() => wrapper!.resolve(0), /disposed/u);
	} finally { wrapper?.dispose(); await fixture.cleanup(); }
});
