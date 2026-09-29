/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ParallelStackCollector } from '../src/common/editor/engine/parallel-stack-collector.ts';
import {
	createParallelStackBuffers, createParallelStackViews, ParallelStackFault, ParallelStackStatus, startParallelStackBuffers,
} from '../src/common/editor/engine/parallel-stack-protocol.ts';

test('a late finite endpoint faults visibly and silences the next quantum without a worklet exception', () => {
	const shared = createParallelStackBuffers({ generation: 1, planeCount: 2, taskCount: 1, workerCount: 1 });
	const faults: number[] = [];
	const collector = new ParallelStackCollector({ shared, inputPlaneIndices: [[0]], outputPlaneIndices: [[1]], startFrame: 0 },
		(code) => { faults.push(code); });
	const output = [[new Float32Array(128)]];
	startParallelStackBuffers(shared);
	for (let quantum = 0; quantum < 6; quantum += 1) {
		assert.equal(collector.process([], output, quantum * 128), true);
	}
	// Source scheduling can finish after a short range's audible endpoint.
	collector.setEndFrame(700);
	assert.equal(collector.process([], output, 768), false);
	assert.ok(output[0]![0]!.every((sample) => sample === 0));
	const views = createParallelStackViews(shared);
	assert.equal(views.status(), ParallelStackStatus.Faulted);
	assert.equal(views.fault(), ParallelStackFault.Clock);
	assert.deepEqual(faults, [ParallelStackFault.Clock]);
});
