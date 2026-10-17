/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionPreviewClient } from '../src/common/editor/controller/composition/motion-preview-client.ts';
import type { MotionPreviewBackend, MotionPreviewFrame, MotionPreviewState } from '../src/common/editor/controller/composition/motion-preview-types.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';

const project = () => createMotionscaperProject({ id: 'project', title: 'Preview', compositionId: 'main', width: 2, height: 2, frameRate: { num: 30000, den: 1001 } });
const assets = () => Promise.reject(new Error('No asset expected'));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pixels = (request: Parameters<MotionPreviewBackend['render']>[0], revision = 0): MotionPreviewFrame => ({ ...request, width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(42), revision, backend: 'host-cpu' });

test('M05 preview permits one render plus one replaceable seek and publishes only the latest generation', async () => {
	const renders: { request: Parameters<MotionPreviewBackend['render']>[0]; signal: AbortSignal; resolve(frame: MotionPreviewFrame): void }[] = [];
	const frames: MotionPreviewFrame[] = [];
	const backend: MotionPreviewBackend = { setProject: () => Promise.resolve('host-cpu'), dispose() {},
		render: (request, signal) => new Promise((resolve) => renders.push({ request, signal, resolve })) };
	const client = await createMotionPreviewClient({ backendFactory: () => Promise.resolve(backend), onFrame: (frame) => frames.push(frame), onState() {} });
	await client.setProject(project(), assets);
	const first = client.seek({ compositionId: 'main', time: 0 }); await settle();
	const discarded = client.seek({ compositionId: 'main', time: 1 });
	const latest = client.seek({ compositionId: 'main', time: 2 });
	assert.equal(renders.length, 1); assert.equal(renders[0]!.signal.aborted, true);
	renders[0]!.resolve(pixels(renders[0]!.request)); await settle();
	assert.equal(renders.length, 2); assert.deepEqual(renders[1]!.request.time, { num: 2, den: 1 });
	renders[1]!.resolve(pixels(renders[1]!.request)); await Promise.all([first, discarded, latest]);
	assert.equal(frames.length, 1); assert.deepEqual(frames[0]!.time, { num: 2, den: 1 });
	client.dispose();
});

test('M05 preview frame cache is bounded, evicts oldest entries and never exposes its retained pixel array', async () => {
	let renderCount = 0; const observed: number[] = [];
	const backend: MotionPreviewBackend = { setProject: () => Promise.resolve('host-cpu'), dispose() {}, render: (request) => { renderCount++; return Promise.resolve(pixels(request)); } };
	const client = await createMotionPreviewClient({ maximumCacheBytes: 32, backendFactory: () => Promise.resolve(backend), onState() {},
		onFrame(frame) { observed.push(frame.rgba[0]!); frame.rgba[0] = 0; } });
	await client.setProject(project(), assets);
	for (const time of [0, 1, 0, 2, 0, 1]) await client.seek({ compositionId: 'main', time });
	assert.equal(renderCount, 4); assert.deepEqual(observed, [42, 42, 42, 42, 42, 42]);
	assert.equal(client.snapshot().cacheBytes, 32);
	client.dispose(); assert.equal(client.snapshot().cacheBytes, 0);
});

test('M05 closing preview cancels pending work and a late backend completion cannot publish a frame', async () => {
	let complete: ((frame: MotionPreviewFrame) => void) | null = null; let disposed = 0; let emitted = 0;
	let request: Parameters<MotionPreviewBackend['render']>[0] | null = null;
	const backend: MotionPreviewBackend = { setProject: () => Promise.resolve('host-cpu'), dispose() { disposed++; }, render: (value) => { request = value; return new Promise((resolve) => { complete = resolve; }); } };
	const client = await createMotionPreviewClient({ backendFactory: () => Promise.resolve(backend), onFrame() { emitted++; }, onState() {} });
	await client.setProject(project(), assets); const pending = client.seek({ compositionId: 'main', time: 0 }); await settle();
	client.dispose(); client.dispose();
	assert.equal(client.snapshot().status, 'disposed'); assert.equal(disposed, 1);
	assert.ok(complete); assert.ok(request);
	(complete as (frame: MotionPreviewFrame) => void)(pixels(request)); await pending;
	assert.equal(emitted, 0);
	await assert.rejects(client.seek({ compositionId: 'main', time: 1 }), /disposed/iu);
});

test('M05 preview playback uses exact rational composition frames and skips late presentation without queuing every frame', async () => {
	let now = 0; const callbacks: (() => void)[] = []; const frames: MotionPreviewFrame[] = [];
	const backend: MotionPreviewBackend = { setProject: () => Promise.resolve('host-cpu'), dispose() {}, render: (request) => Promise.resolve(pixels(request)) };
	const client = await createMotionPreviewClient({ backendFactory: () => Promise.resolve(backend), onFrame: (frame) => frames.push(frame), onState() {},
		clock: { now: () => now, schedule(callback) { callbacks.push(callback); return callback; }, cancel(token) { const index = callbacks.indexOf(token as () => void); if (index >= 0) callbacks.splice(index, 1); } } });
	await client.setProject(project(), assets);
	client.play({ compositionId: 'main', startTime: { num: 1, den: 3 }, endTime: 1 }); await settle();
	assert.deepEqual(frames[0]!.time, { num: 1, den: 3 });
	now = 100; callbacks.shift()!(); await settle();
	assert.deepEqual(frames[1]!.time, { num: 6001, den: 15000 });
	now = 1000; callbacks.shift()!(); await settle();
	assert.equal(client.snapshot().status, 'paused'); assert.equal(callbacks.length, 0);
	client.dispose();
});

test('M05 a new revision clears old frames and render failures can be corrected with another seek', async () => {
	const errors: Error[] = []; const states: MotionPreviewState[] = []; let revision = 0; let fail = true;
	const backend: MotionPreviewBackend = { setProject: (value) => { revision = value.revision; return Promise.resolve('host-cpu'); }, dispose() {},
		render: (request) => fail ? Promise.reject(new Error('Missing font')) : Promise.resolve(pixels(request, revision)) };
	const client = await createMotionPreviewClient({ backendFactory: () => Promise.resolve(backend), onFrame() {}, onState: (state) => states.push(state), onError: (error) => errors.push(error) });
	await client.setProject(project(), assets); await assert.rejects(client.seek({ compositionId: 'main', time: 0 }), /Missing font/iu);
	assert.equal(client.snapshot().status, 'error'); assert.equal(errors.length, 1);
	fail = false; await client.seek({ compositionId: 'main', time: 0 }); assert.equal(client.snapshot().cacheBytes, 16);
	await client.setProject({ ...project(), revision: 1 }, assets); assert.equal(client.snapshot().cacheBytes, 0);
	await client.seek({ compositionId: 'main', time: 0 }); assert.equal(states.at(-1)!.status, 'paused');
	client.dispose();
});

test('M09 preview cache separates explicit temporal and lens quality and validates reductions before rendering', async () => {
	const requested: unknown[] = []; const red: number[] = [];
	const backend: MotionPreviewBackend = { setProject: () => Promise.resolve('host-cpu'), dispose() {}, render: request => {
		requested.push(request.quality); const frame = pixels(request); frame.rgba[0] = request.quality?.temporalSamples ?? 4; return Promise.resolve(frame);
	} };
	const client = await createMotionPreviewClient({ backendFactory: () => Promise.resolve(backend), onState() {}, onFrame: frame => { red.push(frame.rgba[0]!); } });
	const base = project(); await client.setProject({ ...base, compositions: [{ ...base.compositions[0]!, temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 4 }, depthOfFieldSamples: 8 }] }, assets);
	try {
		await client.seek({ compositionId: 'main', time: 0 });
		await client.seek({ compositionId: 'main', time: 0, quality: { temporalSamples: 1 } });
		await client.seek({ compositionId: 'main', time: 0, quality: { temporalSamples: 4 } });
		assert.deepEqual(red, [4, 1, 4]); assert.equal(requested.length, 2);
		// An explicit root-equivalent lens cap can still change nested compositions, so it has a distinct cache key.
		await client.seek({ compositionId: 'main', time: 0, quality: { depthOfFieldSamples: 8 } }); assert.equal(requested.length, 3);
		await assert.rejects(client.seek({ compositionId: 'main', time: 0, quality: { temporalSamples: 5 } }), /quality|samples/iu); assert.equal(requested.length, 3);
	} finally { client.dispose(); }
});
