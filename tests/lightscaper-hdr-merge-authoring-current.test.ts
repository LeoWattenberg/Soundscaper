/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageHdrMergeAuthoringCurrentV1 } from '../src/common/editor/controller/shared/image-hdr-merge-authoring-current-v1.ts';
import type { ImageHdrMergeAuthoringPortCurrentV1, ImageHdrMergeAuthoringOptionsCurrentV1 } from '../src/common/editor/image-hdr-merge-authoring-port-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const DIAGNOSTICS = Object.freeze({ motionPixels: 0, inconsistentPixels: 0, referenceClippedPixels: 1, unresolvedPixels: 0, fallbackChannels: 0 });
const SELECTION = Object.freeze({ schemaVersion: 1 as const, sources: Object.freeze([
	Object.freeze({ key: 'photo-a@3', label: 'Bracket A.dng', width: 2, height: 1, exposureSeconds: .01, aperture: 4, iso: 100 }),
	Object.freeze({ key: 'photo-b@7', label: 'Bracket B.dng', width: 2, height: 1, exposureSeconds: .04, aperture: 4, iso: 100 }),
]), suggestedExposureMultipliers: Object.freeze([1, 4]) });

function observe<T>(work: Promise<T>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function model() {
	const calls: { kind: string; options?: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>; signal?: AbortSignal }[] = [];
	const receipt = Object.freeze({ product: 'test-publication', id: 'created-result' });
	const hooks = { afterPreview: async () => undefined as void, afterMerge: async () => undefined as void };
	let active = false;
	// A scalar lifecycle double, not a source decoder/radiance/managed writer proof.
	const port: ImageHdrMergeAuthoringPortCurrentV1<typeof receipt> = {
		schemaVersion: 1,
		async readSelection(options) { assert.equal(this, port); calls.push({ kind: 'read', signal: options?.signal }); return SELECTION; },
		async withPreview(options, consume, runtime) {
			assert.equal(this, port); calls.push({ kind: 'preview', options, signal: runtime?.signal });
			const pixels = new Uint8Array([255, 128, 0, 255, 16, 32, 64, 255]); active = true;
			try {
				const result = await consume(Object.freeze({ frame: Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1 as const, width: 2, height: 1,
					sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }), pixels }),
					descriptor: Object.freeze({ schemaVersion: 1 as const, width: 2, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }), diagnostics: DIAGNOSTICS }));
				await hooks.afterPreview(); return result;
			} finally { active = false; pixels.fill(0); }
		},
		async merge(options, runtime) {
			assert.equal(this, port); calls.push({ kind: 'merge', options, signal: runtime?.signal }); runtime?.onAcknowledged?.(receipt);
			await hooks.afterMerge(); return Object.freeze({ acknowledgement: receipt, diagnostics: DIAGNOSTICS });
		},
	};
	return { port, calls, hooks, receipt, active: () => active };
}

test('HDR authoring captures selection once and renormalizes authored exposure ratios around the selected reference', async () => {
	const f = model(), owner = new ImageHdrMergeAuthoringCurrentV1({ port: f.port, isCurrent: () => true });
	try {
		await owner.open(); assert.deepEqual(owner.snapshot().options?.exposureMultipliers, [1, 4]);
		assert.equal(owner.snapshot().options?.referenceIndex, 0); assert.equal(f.calls.length, 1);
		await owner.setReference(1); assert.deepEqual(owner.snapshot().options?.exposureMultipliers, [.25, 1]);
		assert.equal(owner.snapshot().options?.referenceIndex, 1);
		const options = owner.snapshot().options; assert.ok(options);
		await assert.rejects(owner.setOptions({ ...options, exposureMultipliers: [.25, 2] }), /reference|exposure/u);
		assert.deepEqual(owner.snapshot().options?.exposureMultipliers, [.25, 1]);
		await owner.merge(); assert.equal(f.calls.at(-1)?.options?.referenceIndex, 1);
		assert.deepEqual(f.calls.at(-1)?.options?.exposureMultipliers, [.25, 1]); assert.equal(owner.snapshot().acknowledged, f.receipt);
	} finally { await owner.close(); }
});

test('Preview remains unready until its scoped consumer and native retirement both join, and changed options clear readiness', async () => {
	const f = model(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.afterPreview = async () => { entered.resolve(); await release.promise; };
	const owner = new ImageHdrMergeAuthoringCurrentV1({ port: f.port, isCurrent: () => true }); let borrowed: Uint8Array | undefined;
	try {
		await owner.open(); const work = owner.preview(view => { assert.equal(f.active(), true); borrowed = view.frame.pixels; });
		await entered.promise; assert.equal(owner.snapshot().previewReady, false); assert.equal(await remainsPending(work), true);
		assert.equal(owner.snapshot().acknowledged, null); release.resolve(); await work;
		assert.equal(owner.snapshot().previewReady, true); assert.deepEqual(owner.snapshot().diagnostics, DIAGNOSTICS);
		assert.ok(borrowed?.every(value => value === 0)); assert.equal(f.calls.some(call => call.kind === 'merge'), false);
		const options = owner.snapshot().options; assert.ok(options);
		await owner.setOptions({ ...options, deghost: { mode: 'reference-v1', threshold: .125 } });
		assert.equal(owner.snapshot().previewReady, false); assert.equal(owner.snapshot().diagnostics, null);
	} finally { release.resolve(); await owner.close(); }
});

test('Close cancels and joins a held Preview without acquiring a second native operation', async () => {
	const f = model(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.afterPreview = async () => { entered.resolve(); await release.promise; };
	const owner = new ImageHdrMergeAuthoringCurrentV1({ port: f.port, isCurrent: () => true }); await owner.open();
	const preview = observe(owner.preview(() => undefined)); await entered.promise;
	const close = owner.close();
	try {
		assert.equal(f.calls.at(-1)?.signal?.aborted, true); assert.equal(await remainsPending(close), true);
		assert.equal(f.active(), true); await assert.rejects(owner.merge(), /closed|unavailable/u);
		release.resolve(); await close; await preview; assert.equal(f.active(), false); assert.equal(owner.snapshot().closed, true);
		assert.equal(f.calls.filter(call => call.kind === 'preview').length, 1); assert.equal(owner.snapshot().previewReady, false);
	} finally { release.resolve(); await preview; await close; }
});

test('a genuine acknowledgement is retained when native publication later rejects cancellation', async () => {
	const f = model(), entered = deferred<void>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	f.hooks.afterMerge = async () => { entered.resolve(); await release.promise; throw opaque.proxy; };
	const owner = new ImageHdrMergeAuthoringCurrentV1({ port: f.port, isCurrent: () => true }); await owner.open();
	const work = observe(owner.merge()); await entered.promise; assert.equal(owner.snapshot().acknowledged, f.receipt);
	const close = owner.close(); const closed = observe(close);
	try {
		assert.equal(await remainsPending(close), true); release.resolve();
		const result = await work; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy));
		await closed; assert.equal(owner.snapshot().acknowledged, f.receipt); assert.equal(f.calls.filter(call => call.kind === 'merge').length, 1);
	} finally { release.resolve(); await work; await closed; }
});

test('old source generations cannot preview or publish, and preabort avoids hostile capability reflection', async () => {
	const f = model(); let current = true;
	const owner = new ImageHdrMergeAuthoringCurrentV1({ port: f.port, isCurrent: () => current });
	try {
		await owner.open(); current = false;
		await assert.rejects(owner.preview(() => undefined), /changed|current|stale/u);
		await assert.rejects(owner.merge(), /changed|current|stale/u);
		assert.deepEqual(f.calls.map(call => call.kind), ['read']);
	} finally { await owner.close(); }
	const stop = new AbortController(), reason = Object.freeze({ cancelled: true }); stop.abort(reason); let traps = 0;
	const hostile = new Proxy({}, { ownKeys() { traps++; throw new Error('Reflected capability.'); } });
	const aborted = new ImageHdrMergeAuthoringCurrentV1({ port: hostile, isCurrent: () => true });
	const result = await observe(aborted.open(undefined, { signal: stop.signal }));
	assert.ok(!result.ok); assert.equal(result.error, reason); assert.equal(traps, 0); await aborted.close();
});

test('an independent Preview retirement failure remains exact and prevents a successful readiness claim', async () => {
	const f = model(), failure = new Error('Preview reader failed after painting.');
	f.hooks.afterPreview = async () => { throw failure; };
	const owner = new ImageHdrMergeAuthoringCurrentV1({ port: f.port, isCurrent: () => true });
	try {
		await owner.open(); const result = await observe(owner.preview(() => undefined));
		assert.ok(!result.ok); assert.equal(result.error, failure); assert.equal(owner.snapshot().previewReady, false);
		assert.equal(owner.snapshot().failed, true); assert.equal(f.active(), false);
	} finally { await observe(owner.close()); }
});
