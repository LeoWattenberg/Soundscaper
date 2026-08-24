/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS,
	HelperAdmissionGate,
} from '../desktop/helper-admission-gate.ts';
import { HelperSupervisionError } from '../desktop/helper-supervision-state.ts';

test('helper admission gate is bounded, abort-aware, FIFO, and reusable', async () => {
	const gate = new HelperAdmissionGate();
	const releaseActive = await acquire(gate);
	const controller = new AbortController();
	const cancelled = acquire(gate, controller.signal);
	const queued = Array.from({ length: HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS - 2 }, () => acquire(gate));
	await assert.rejects(acquire(gate), (error: unknown) => cause(error) === 'capacity');
	controller.abort();
	await assert.rejects(cancelled, (error: unknown) => cause(error) === 'cancelled');
	const replacement = acquire(gate);
	const admitted: number[] = [];
	const observed = [...queued, replacement].map(async (entry, index) => {
		const release = await entry;
		admitted.push(index);
		return release;
	});
	releaseActive();
	releaseActive();
	const releaseFirstWaiter = await observed[0];
	assert.deepEqual(admitted, [0], 'double release cannot advance a second waiter');
	releaseFirstWaiter();
	for (const entry of observed.slice(1)) (await entry)();
	const recovered = await acquire(gate);
	recovered();
});

test('disposing helper admission rejects waiters while the active holder settles independently', async () => {
	const gate = new HelperAdmissionGate();
	const releaseActive = await acquire(gate);
	const queued = acquire(gate);
	gate.dispose();
	await assert.rejects(queued, (error: unknown) => cause(error) === 'disposed');
	releaseActive();
	await assert.rejects(acquire(gate), (error: unknown) => cause(error) === 'disposed');
});

async function acquire(gate: HelperAdmissionGate, signal?: AbortSignal): Promise<() => void> {
	return await gate.acquire(signal);
}

function cause(error: unknown): string | null {
	return error instanceof HelperSupervisionError ? error.cause_ : null;
}
