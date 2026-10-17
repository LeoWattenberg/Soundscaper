/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineRealtimeContextFactory } from '../src/common/editor/engine/runtime-types.ts';
import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { MotionDeliveryCleanupFailure } from '../src/common/editor/motion-delivery-cleanup.ts';
import { createFramescaperSuccessorNativeAudioLease } from '../src/framescaper/editor-successor-native-audio-lease.ts';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { motionscaperSuccessorNativeFixture } from './helpers/motionscaper-successor-native-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';

for (const resource of ['engine-context', 'owned-staffpad-worker'] as const) test(`M10 captured native cleanup retains and retries a transient ${resource} failure`, async () => {
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY });
	const fault = new Error(`Transient ${resource} close failure`); let attempts = 0, released = 0, publication = 0;
	const context = { state: 'suspended', async close() { attempts++; if (attempts <= 2) throw fault; this.state = 'closed'; } };
	const engine = createAudioEditorEngine({ audioContextFactory: (() => context) as unknown as EngineRealtimeContextFactory });
	const worker = { addEventListener() {}, postMessage() {}, terminate() { attempts++; if (attempts <= 2) throw fault; } };
	const cache = new ClipTimePitchRenderCacheCoordinator({ store: environment.store, staffPadClientOptions: { workerFactory: () => worker } });
	try {
		await controller.ready; const fixture = motionscaperSuccessorNativeFixture();
		const receipt = await framescaperSuccessorControllerContext(controller).links.receive(createMotionCompositionOffer('main', fixture.revision), { readAsset: async () => new Blob([fixture.bytes]) });
		if (resource === 'engine-context') await engine.getAudioContext({ resume: false });
		else cache.client.getWorker();
		const lease = createFramescaperSuccessorNativeAudioLease(environment, receipt.project, new AbortController().signal, () => {}, () => { released++; }, { createEngine: () => engine, createCache: () => cache });
		await lease.prepare(); let retained: MotionDeliveryCleanupFailure | null = null;
		await assert.rejects(async () => { await lease.release(); publication++; }, error => { assert.ok(error instanceof MotionDeliveryCleanupFailure); retained = error; return true; });
		assert.equal(publication, 0); assert.equal(released, 0); assert.equal(attempts, 1);
		await assert.rejects(lease.release(), error => error instanceof MotionDeliveryCleanupFailure);
		assert.equal(released, 0); assert.equal(attempts, 2, 'a retry must call the same physical resource again');
		assert.ok(retained); const cleanup: MotionDeliveryCleanupFailure = retained;
		assert.equal(cleanup.cleanupRequired, true); await cleanup.retryCleanup();
		assert.equal(attempts, 3); assert.equal(released, 1); assert.equal(cleanup.cleanupRequired, false);
		await lease.release(); assert.equal(attempts, 3); assert.equal(released, 1);
		await assert.rejects(engine.getAudioContext(), { code: 'ENGINE_DISPOSED' });
	} finally {
		attempts = Math.max(2, attempts); await engine.dispose().catch(() => undefined); await cache.dispose().catch(() => undefined);
		await controller.dispose(); await environment.close();
	}
});

test('M10 native PCM preserves render and cleanup failures and awaits the owned engine close', async () => {
	const { renderProductNativeAudioToSink } = await import('../src/common/editor/controller/composition/product-native-render-audio-stream.ts');
	const primary = new Error('Pinned PCM render failed'), cleanup = new Error('Pinned engine close failed');
	let release!: () => void, entered!: () => void, settled = false;
	const closing = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
	const operation = renderProductNativeAudioToSink({ sourceBuffers: new Map<string, AudioBuffer>(), signal: new AbortController().signal, assertCurrent() {}, async prepareCommittedTimePitchCaches() {},
		createRenderEngine: () => ({ loadProject() {}, async renderMixToSink() { throw primary; }, async dispose() { entered(); await closing; throw cleanup; } }),
	}, {}, {}, () => undefined);
	const rejection = assert.rejects(operation, error => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(error.cause, primary); return true; });
	void operation.then(() => { settled = true; }, () => { settled = true; });
	await started; assert.equal(settled, false); release(); await rejection; assert.equal(settled, true);
});
