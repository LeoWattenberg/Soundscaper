/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Kill/reload acceptance for the operations that move media bytes.
 *
 * Both consolidate and trim-media declare the same recovery class: atomically
 * restartable, not resumable. Neither keeps a journal, and neither needs one,
 * because the only step that changes what the project points at is the last —
 * so a process killed anywhere before it leaves the project exactly as it was,
 * and a process killed after it leaves the project on media that was already
 * verified. Re-running is always safe and always converges.
 *
 * This proves that by killing every step in turn rather than one representative
 * step: for each port call in an uninterrupted run, the run is repeated and
 * aborted at that call, and the world is checked. A recovery class that held
 * for the first and last step but not the middle one is exactly what a single
 * example would miss.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createConsolidatePlan } from '../src/common/editor/consolidate-plan.ts';
import { runConsolidate } from '../src/common/editor/consolidate-operation.ts';
import { createTrimMediaPlan } from '../src/common/editor/trim-media-plan.ts';
import { runTrimMedia } from '../src/common/editor/trim-media-operation.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

const ORIGINAL = Uint8Array.from({ length: 256 }, (_value, index) => index);
const DIGEST = digestScapeBytes(ORIGINAL);

test('a consolidate killed at any step leaves the original in place and the project consistent', async () => {
	const uninterrupted = createWorld();
	const finished = await runConsolidate(consolidatePlan(), uninterrupted.consolidatePorts());
	assert.equal(finished.complete, true);
	const settled = uninterrupted.snapshot();
	assert.equal(uninterrupted.calls, 4);

	for (let killAt = 0; killAt < uninterrupted.calls; killAt += 1) {
		const world = createWorld();
		// However the run ends — reported as a failed source or thrown outright —
		// the claim under test is about the world it leaves, not about which of
		// the two happened.
		const interrupted = await settle(runConsolidate(
			consolidatePlan(), world.consolidatePorts({ killAt }),
		));
		assert.notEqual(
			interrupted.value?.complete, true,
			`a kill at call ${killAt} must not report a complete consolidate`,
		);

		// The external file is never touched, whatever happened.
		assert.deepEqual(world.original, ORIGINAL, `kill at ${killAt} altered the linked original`);
		// The binding is either untouched or the verified new one; never partial.
		assert.ok(
			world.binding === null || world.binding.sha256 === DIGEST,
			`kill at ${killAt} left a binding pointing at unverified bytes`,
		);

		// Reload: nothing to resume, so the run simply starts again and converges.
		const restarted = await runConsolidate(consolidatePlan(), world.consolidatePorts());
		assert.equal(restarted.complete, true, `kill at ${killAt} left a project that could not be restarted`);
		assert.deepEqual(world.snapshot().binding, settled.binding);
	}
});

test('a trim killed at any step leaves the pre-trim media and can simply be re-run', async () => {
	const uninterrupted = createWorld();
	const finished = await runTrimMedia({ plan: trimPlan() }, uninterrupted.trimPorts());
	assert.equal(finished.trimmedSources, 1);
	const settled = uninterrupted.snapshot();
	assert.equal(uninterrupted.calls, 2);

	for (let killAt = 0; killAt < uninterrupted.calls; killAt += 1) {
		const world = createWorld();
		const interrupted = await settle(runTrimMedia(
			{ plan: trimPlan() }, world.trimPorts({ killAt }),
		));
		assert.notEqual(
			interrupted.value?.trimmedSources, 1,
			`a kill at call ${killAt} must not report a trimmed source`,
		);

		// The bytes a trim would replace are still there, which is what makes the
		// operation's undo claim true after an interruption as well as before one.
		assert.deepEqual(world.original, ORIGINAL, `kill at ${killAt} destroyed the pre-trim media`);
		assert.ok(
			world.binding === null || world.binding.frameCount === 20,
			`kill at ${killAt} bound the project to a copy that was never checked`,
		);

		const restarted = await runTrimMedia({ plan: trimPlan() }, world.trimPorts());
		assert.equal(restarted.trimmedSources, 1);
		assert.deepEqual(world.snapshot().binding, settled.binding);
	}
});

test('an interrupted run leaves managed copies behind, and never a missing one', async () => {
	// The orphan is the price of the ordering, and it is the right price: an
	// unreferenced copy is garbage to collect, while a binding that pointed at
	// bytes which were never written would be a project that lost its media.
	const world = createWorld();
	await settle(runConsolidate(consolidatePlan(), world.consolidatePorts({ killAt: 2 })));
	assert.equal(world.binding, null, 'nothing was rebound');
	assert.ok(world.managed.size <= 1, 'at most the one copy that was in flight');
	for (const [, bytes] of world.managed) {
		assert.equal(bytes.byteLength, ORIGINAL.byteLength, 'a copy that exists is a complete one');
	}
});

function consolidatePlan() {
	return createConsolidatePlan({
		project: { sources: [{ id: 'a' }], clips: [{ sourceId: 'a' }] },
		bindings: [{
			sourceId: 'a',
			storageKey: 'linked/a.wav',
			byteLength: ORIGINAL.byteLength,
			sha256: DIGEST,
			bindingToken: 'token-1',
			kind: 'audio' as const,
		}],
	});
}

function trimPlan() {
	return createTrimMediaPlan({
		project: {
			sources: [{ id: 'a', frameCount: 100 }],
			clips: [{ id: 'c', sourceId: 'a', sourceStartFrame: 40, sourceDurationFrames: 20 }],
		},
		handleFrames: 0,
	});
}

/** Run to whichever end it reaches: the world is what this acceptance is about. */
async function settle<Value>(operation: Promise<Value>): Promise<{ value: Value | null }> {
	try {
		return { value: await operation };
	} catch {
		return { value: null };
	}
}

interface Binding {
	readonly storageKey: string;
	readonly sha256?: string;
	readonly frameCount?: number;
}

/**
 * The world an operation acts on, and the switch that kills it mid-step.
 *
 * Built as a closure rather than a class so the ports are plain functions over
 * one piece of state, which is what an operation actually sees.
 */
function createWorld() {
	const original = ORIGINAL.slice();
	const managed = new Map<string, Uint8Array>();
	let binding: Binding | null = null;
	let calls = 0;

	const step = (killAt: number | undefined): void => {
		const index = calls;
		calls += 1;
		if (killAt === index) throw new Error(`the process was killed at step ${String(index)}`);
	};

	return {
		original,
		managed,
		get binding() { return binding; },
		get calls() { return calls; },
		snapshot() {
			return { binding, managed: [...managed.keys()].sort() };
		},
		consolidatePorts(options: { killAt?: number } = {}) {
			return {
				async *readOriginal() {
					step(options.killAt);
					yield original;
				},
				async writeManaged(source: { sourceId: string }, chunks: AsyncIterable<Uint8Array>) {
					step(options.killAt);
					const collected: number[] = [];
					for await (const chunk of chunks) collected.push(...chunk);
					const storageKey = `managed/${source.sourceId}`;
					managed.set(storageKey, Uint8Array.from(collected));
					return { storageKey, byteLength: collected.length };
				},
				async *readManaged(storageKey: string) {
					step(options.killAt);
					yield managed.get(storageKey) ?? new Uint8Array(0);
				},
				async rebind(request: { storageKey: string; sha256: string }) {
					step(options.killAt);
					binding = { storageKey: request.storageKey, sha256: request.sha256 };
					return true;
				},
				async discardManaged(storageKey: string) { managed.delete(storageKey); },
			};
		},
		trimPorts(options: { killAt?: number } = {}) {
			return {
				async writeTrimmedCopy(
					source: { sourceId: string },
					runs: readonly { startFrame: number; endFrame: number }[],
				) {
					step(options.killAt);
					const frameCount = runs.reduce((sum, run) => sum + (run.endFrame - run.startFrame), 0);
					const storageKey = `managed/${source.sourceId}.trimmed`;
					managed.set(storageKey, new Uint8Array(frameCount));
					return { storageKey, frameCount, byteLength: frameCount };
				},
				async rebind(request: { storageKey: string; frameCount: number }) {
					step(options.killAt);
					binding = { storageKey: request.storageKey, frameCount: request.frameCount };
					return true;
				},
				async discardTrimmedCopy(storageKey: string) { managed.delete(storageKey); },
			};
		},
	};
}
