/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createParallelStackBuffers, createParallelStackViews, startParallelStackBuffers,
	stopParallelStackBuffers, claimParallelStackBank, ParallelStackStatus, ParallelStackFault,
} from '../src/common/editor/engine/parallel-stack-protocol.ts';
import { ParallelStackCollector } from '../src/common/editor/engine/parallel-stack-collector.ts';
import { createParallelStackScheduler } from '../src/common/editor/engine/parallel-stack-scheduler.ts';

function setup() {
	const shared = createParallelStackBuffers({ generation: 1, planeCount: 4, taskCount: 3, workerCount: 2 });
	const tasks = [{ worker: 0, dependencies: [] }, { worker: 1, dependencies: [] }, { worker: 0, dependencies: [0, 1] }];
	const calls: number[][] = [[], [], []];
	const execute = (task: number, planes: readonly Float32Array[], sequence: number) => {
		calls[task].push(sequence);
		for (let frame = 0; frame < 256; frame += 1) {
			if (task === 0) planes[1][frame] = planes[0][frame] * 2;
			else if (task === 1) planes[2][frame] = planes[0][frame] * 3;
			else planes[3][frame] = planes[1][frame] + planes[2][frame];
		}
	};
	const workers = [0, 1].map((worker) => createParallelStackScheduler(shared, tasks, worker, execute));
	const collector = new ParallelStackCollector({ shared, inputPlaneIndices: [[0]], outputPlaneIndices: [[3]], startFrame: 0 });
	const output = [[new Float32Array(128)]];
	startParallelStackBuffers(shared);
	return { shared, calls, workers, collector, output };
}

test('parallel stacks publish complete mixes with exactly one pipeline delay across ring reuse', () => {
	const { calls, workers, collector, output } = setup();
	for (let quantum = 0; quantum < 54; quantum += 1) {
		const input = [[new Float32Array(128).fill(quantum + 1)]];
		assert.equal(collector.process(input, output, quantum * 128), true);
		assert.equal(output[0][0][0], quantum < 6 ? 0 : (quantum - 5) * 5);
		workers[0].runReady();
		workers[1].runReady();
		workers[0].runReady();
	}
	for (const history of calls) assert.deepEqual(history, Array.from({ length: 27 }, (_, i) => i));
});

test('dependencies do not run before every producer and completion is single publication', () => {
	const { shared, calls, workers, collector, output } = setup();
	const input = [[new Float32Array(128).fill(1)]];
	collector.process(input, output, 0);
	assert.equal(workers[0].runReady(), 0);
	collector.process(input, output, 128);
	assert.equal(workers[0].runReady(), 1);
	assert.equal(workers[0].runReady(), 0);
	assert.deepEqual(calls[2], []);
	assert.equal(workers[1].runReady(), 1);
	assert.equal(workers[0].runReady(), 1);
	assert.equal(workers[0].runReady(), 0);
	assert.equal(createParallelStackViews(shared).banks[0].unfinished(), 0);
});

test('an overdue output faults its epoch without reading partial or stale PCM', () => {
	const { shared, workers, collector, output } = setup();
	const input = [[new Float32Array(128).fill(1)]];
	for (let quantum = 0; quantum < 6; quantum += 1) {
		collector.process(input, output, quantum * 128);
		workers[0].runReady();
	}
	assert.equal(collector.process(input, output, 768), false);
	assert.equal(collector.fault, ParallelStackFault.Deadline);
	assert.equal(createParallelStackViews(shared).status(), ParallelStackStatus.Faulted);
	assert.ok(output[0][0].every((sample) => sample === 0));
	assert.equal(workers[1].runReady(), 0);
});

test('stop wakes idle workers and silences by the next render quantum', () => {
	const { shared, workers, collector, output } = setup();
	const views = createParallelStackViews(shared);
	const previousWake = Atomics.load(views.control, views.workerWakeIndex(1));
	stopParallelStackBuffers(shared);
	assert.notEqual(Atomics.load(views.control, views.workerWakeIndex(1)), previousWake);
	assert.equal(workers[0].runReady(), 0);
	output[0][0].fill(99);
	assert.equal(collector.process([], output, 0), false);
	assert.ok(output[0][0].every((sample) => sample === 0));
});

test('changed render geometry and missing quanta fault rather than shift audio', () => {
	const first = setup();
	assert.equal(first.collector.process([], [[new Float32Array(64)]], 0), false);
	assert.equal(first.collector.fault, ParallelStackFault.Quantum);
	const second = setup();
	second.collector.process([], second.output, 0);
	assert.equal(second.collector.process([], second.output, 256), false);
	assert.equal(second.collector.fault, ParallelStackFault.Clock);
});

test('fresh generation memory cannot be changed by retired schedulers', () => {
	const old = setup();
	const replacement = setup();
	old.collector.process([[new Float32Array(128).fill(9)]], old.output, 0);
	old.collector.process([[new Float32Array(128).fill(9)]], old.output, 128);
	stopParallelStackBuffers(old.shared);
	old.workers[0].runReady();
	assert.ok(new Float32Array(replacement.shared.pcm).every((sample) => sample === 0));
	assert.equal(createParallelStackViews(replacement.shared).status(), ParallelStackStatus.Running);
});

test('shared allocation rejects malformed and excessive resource geometry', () => {
	const valid = { generation: 1, planeCount: 4, taskCount: 3, workerCount: 2 };
	assert.throws(() => createParallelStackBuffers({ ...valid, planeCount: 1_000_000 }), RangeError);
	assert.throws(() => createParallelStackBuffers({ ...valid, bankCount: 3 }), RangeError);
	assert.throws(() => createParallelStackBuffers({ ...valid, generation: NaN }), RangeError);
	assert.throws(() => createParallelStackBuffers({ ...valid, latencyFrames: 769 }), RangeError);
});

test('the unarmed collector handshakes before origin and accepts large absolute frame clocks', () => {
	const shared = createParallelStackBuffers({ generation: 7, planeCount: 2, taskCount: 1, workerCount: 1, latencyFrames: 1536 });
	const collector = new ParallelStackCollector({ shared, inputPlaneIndices: [[0]], outputPlaneIndices: [[1]] });
	const output = [[new Float32Array(128).fill(99)]];
	const startFrame = 2 ** 40;
	assert.equal(collector.process([], output, startFrame - 128), true);
	assert.equal(output[0][0][0], 0);
	collector.arm(startFrame);
	assert.throws(() => collector.arm(startFrame), RangeError);
	startParallelStackBuffers(shared);
	assert.equal(collector.process([], output, startFrame), true);
	assert.equal(collector.process([], output, startFrame + 128), true);
	const bank = createParallelStackViews(shared).banks[0];
	assert.equal(bank.sequence(), 0);
	assert.ok(bank.planes[0].every((sample) => sample === 0));
});

test('an active bank is never overwritten and the collector reports a fault once', () => {
	const shared = createParallelStackBuffers({ generation: 1, planeCount: 2, taskCount: 1, workerCount: 1 });
	const views = createParallelStackViews(shared);
	const bank = claimParallelStackBank(views, 0);
	assert.ok(bank);
	bank.planes[0].fill(.75);
	const faults: number[] = [];
	const collector = new ParallelStackCollector({ shared, inputPlaneIndices: [[0]], outputPlaneIndices: [[1]], startFrame: 0 }, (code) => { faults.push(code); });
	startParallelStackBuffers(shared);
	const output = [[new Float32Array(128)]];
	assert.equal(collector.process([[new Float32Array(128).fill(1)]], output, 0), false);
	assert.equal(collector.process([], output, 128), false);
	assert.deepEqual(faults, [ParallelStackFault.Capacity]);
	assert.ok(bank.planes[0].every((sample) => sample === .75));
});

test('deadline failure ramps the last audible sample to zero within one quantum', () => {
	const { shared, collector, workers, output } = setup();
	const input = [[new Float32Array(128).fill(.1)]];
	for (let quantum = 0; quantum < 8; quantum += 1) {
		assert.equal(collector.process(input, output, quantum * 128), true);
		if (quantum < 2) { workers[0].runReady(); workers[1].runReady(); workers[0].runReady(); }
	}
	assert.equal(output[0][0][127], .5);
	assert.equal(collector.process(input, output, 1024), false);
	assert.equal(output[0][0][0], .5 * 127 / 128);
	assert.equal(output[0][0][127], 0);
	assert.equal(createParallelStackViews(shared).fault(), ParallelStackFault.Deadline);
});

test('sequence metadata preserves safe integers across the 32-bit boundary', () => {
	const { shared } = setup();
	const views = createParallelStackViews(shared);
	const bank = claimParallelStackBank(views, 2 ** 32 + 3);
	assert.equal(bank?.sequence(), 2 ** 32 + 3);
});

test('finite playback truncates at the exact requested output sample inside a quantum', () => {
	const { shared, collector, workers, output } = setup();
	collector.setEndFrame(900);
	const input = [[new Float32Array(128).fill(.1)]];
	for (let quantum = 0; quantum < 8; quantum += 1) {
		assert.equal(collector.process(input, output, quantum * 128), quantum < 7);
		workers[0].runReady(); workers[1].runReady(); workers[0].runReady();
	}
	assert.deepEqual([...output[0][0].subarray(0, 4)], [.5, .5, .5, .5]);
	assert.ok(output[0][0].subarray(4).every((sample) => sample === 0));
	assert.equal(createParallelStackViews(shared).status(), ParallelStackStatus.Stopped);
	assert.equal(collector.fault, ParallelStackFault.None);
});

test('an empty finite output range stops without demanding an unused overdue bank', () => {
	const { shared, collector, output } = setup();
	collector.setEndFrame(768);
	for (let quantum = 0; quantum < 6; quantum += 1) assert.equal(collector.process([], output, quantum * 128), quantum < 5);
	assert.equal(collector.process([], output, 768), false);
	assert.ok(output[0][0].every((sample) => sample === 0));
	assert.equal(createParallelStackViews(shared).status(), ParallelStackStatus.Stopped);
	assert.equal(collector.fault, ParallelStackFault.None);
});
