/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { parallelPlanningFixture } from './helpers/responsiveness-round4-parallel-fixtures.ts';

interface FrozenCase { seed: number; sampleRate: number; sha256: string; outcome: string; }
const receipt = JSON.parse(readFileSync(new URL('./fixtures/responsiveness-round4-parallel-parity.json', import.meta.url), 'utf8')) as {
	baselineSourceRevision: string; hashes: FrozenCase[];
};

test('complete parallel plans and exact refusals match 144 frozen pre-change outputs', () => {
	assert.equal(receipt.hashes.length, 144);
	for (const { seed, sampleRate, sha256 } of receipt.hashes) {
		let value: unknown;
		try { value = { plan: compileParallelStackPlan(parallelPlanningFixture(seed), { sampleRate, workerCount: seed % 8 + 1 }) }; }
		catch (error) {
			assert.ok(error instanceof Error);
			value = { error: { name: error.name, message: error.message } };
		}
		assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), sha256,
			`seed ${String(seed)}, rate ${String(sampleRate)} must preserve the entire plan or refusal`);
	}
});
