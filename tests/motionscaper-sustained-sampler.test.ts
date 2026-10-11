/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMotionSustainedSampler } from '../scripts/performance/motionscaper-sustained-sampler.ts';
import { readMotionProcessIdentity } from '../scripts/performance/motionscaper-sustained-observation.ts';
import type { MotionSustainedTelemetry } from '../scripts/performance/motionscaper-sustained-cdp.ts';
const target = (): MotionSustainedTelemetry => ({ observedAt: new Date().toISOString(), monotonicMs: performance.now(), targetId: 'page', sessionId: 'session',
	type: 'page', url: 'about:blank', usedHeapBytes: 1, totalHeapBytes: 2, wasmCapacityBytes: [], workerName: '', workerFrames: 0, backend: null, revision: null });
test('Motionscaper sustained sampler retains an in-flight sampling failure during stop', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-sampler-'));
	try {
		let call = 0, entered!: () => void, reject!: (error: unknown) => void;
		const sampling = new Promise<void>(resolve => { entered = resolve; });
		const pending = new Promise<number>((_, fail) => { reject = fail; });
		const sampler = await startMotionSustainedSampler({ phase: 'synthetic-observer', owner: await readMotionProcessIdentity(process.pid),
			cdp: { sample: () => Promise.resolve([target()]) }, logPath: join(directory, 'samples.jsonl'),
			progress: () => { if (++call === 1) return Promise.resolve(0); entered(); return pending; } });
		await sampling; const stop = sampler.stop(), error = new Error('actual sample failure'); reject(error);
		await assert.rejects(stop, value => value === error); assert.equal(sampler.stop(), stop);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
test('Motionscaper sustained sampler refuses another target with the same worker name', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-sampler-'));
	try {
		await assert.rejects(startMotionSustainedSampler({ phase: 'synthetic-worker', owner: await readMotionProcessIdentity(process.pid),
			cdp: { sample: () => Promise.resolve([target(), { ...target(), type: 'worker', workerName: 'motionscaper-composition-preview', targetId: 'replacement', sessionId: 'new' }]) },
			logPath: join(directory, 'samples.jsonl'), progress: () => Promise.resolve(0), expectedWorker: () => ({ targetId: 'old', sessionId: 'old-session' }) }), /pinned preview worker/);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Motionscaper sustained sampler pins worker revision/backend and refuses regressed frame delivery', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-sampler-'));
	try {
		const worker = (): MotionSustainedTelemetry => ({ ...target(), type: 'worker', targetId: 'worker', sessionId: 'worker-session',
			workerName: 'motionscaper-composition-preview', revision: 7, backend: 'worker-webgl2', workerFrames: 10 });
		for (const [index, changed] of [{ revision: 8 }, { backend: 'worker-cpu' }, { workerFrames: 9 }].entries()) {
			let calls = 0, retained = 0;
			const sampler = await startMotionSustainedSampler({ phase: 'synthetic-worker-custody', owner: await readMotionProcessIdentity(process.pid),
				cdp: { sample: () => Promise.resolve([target(), { ...worker(), ...(calls++ ? changed : {}) }]) },
				logPath: join(directory, `worker-${index}.jsonl`), progress: () => Promise.resolve(0),
				expectedWorker: () => ({ targetId: 'worker', sessionId: 'worker-session', revision: 7, backend: 'worker-webgl2' }),
				retainProcesses: values => { assert.ok(values.some(value => value.pid === process.pid)); retained++; } });
			await assert.rejects(sampler.stop(), /pinned preview worker|frame count regressed/);
			assert.equal(retained, 2, 'Failure samples must still retain observed owned process identities.');
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Motionscaper sustained sampler retains process ownership when target telemetry rejects', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-sampler-'));
	try {
		let retained = false;
		const error = new Error('target observation failed');
		await assert.rejects(startMotionSustainedSampler({ phase: 'synthetic-observation-error', owner: await readMotionProcessIdentity(process.pid),
			cdp: { sample: () => Promise.reject(error) }, logPath: join(directory, 'samples.jsonl'), progress: () => Promise.resolve(0),
			retainProcesses: values => { retained = values.some(value => value.pid === process.pid); } }), value => value === error);
		assert.equal(retained, true, 'An independent telemetry failure must not lose already observed process ownership.');
	} finally { await rm(directory, { recursive: true, force: true }); }
});
