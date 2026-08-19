/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createConsolidatePlan } from '../src/common/editor/consolidate-plan.ts';
import {
	runConsolidate,
	type ConsolidatePorts,
} from '../src/common/editor/consolidate-operation.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

const ORIGINAL = Uint8Array.from({ length: 96 }, (_value, index) => index % 251);
const DIGEST = digestScapeBytes(ORIGINAL);

test('a copy is written, read back, verified, and only then rebound', async () => {
	const harness = createHarness();
	const result = await runConsolidate(plan(), harness.ports);

	assert.equal(result.complete, true);
	assert.equal(result.copiedByteLength, ORIGINAL.byteLength);
	assert.deepEqual(result.sources.map(({ outcome }) => outcome), ['copied']);
	assert.equal(result.sources[0]?.sha256, DIGEST);
	// The writer pulls the original, so it opens first. What matters is the tail:
	// verification reads the stored bytes rather than trusting the write, and the
	// rebind is last, so an interrupted run never points at media that is absent.
	assert.deepEqual(harness.events, ['write-managed', 'read-original', 'read-managed', 'rebind']);
	assert.deepEqual([...harness.managed.keys()], ['managed/linked-source']);
	assert.deepEqual(harness.rebinds, [{
		sourceId: 'linked-source',
		storageKey: 'managed/linked-source',
		byteLength: ORIGINAL.byteLength,
		sha256: DIGEST,
		expectedBindingToken: 'token-1',
	}]);
});

test('an original that changed since it was bound is refused, not silently swapped in', async () => {
	const harness = createHarness({ original: Uint8Array.from(ORIGINAL, (value) => value ^ 0xff) });
	const result = await runConsolidate(plan(), harness.ports);

	assert.equal(result.complete, false);
	assert.deepEqual(result.sources.map(({ outcome }) => outcome), ['original-changed']);
	assert.equal(harness.rebinds.length, 0, 'nothing may be rebound to a file that changed');
	assert.equal(harness.managed.size, 0, 'the copy of the changed file is not kept');
	const item = reportItem(result, 'consolidate.original-changed');
	assert.equal(item?.data.expectedSha256, DIGEST);
	assert.notEqual(item?.data.actualSha256, DIGEST);
});

test('storage that returns different bytes than it accepted fails verification', async () => {
	const harness = createHarness({ corruptOnRead: true });
	const result = await runConsolidate(plan(), harness.ports);

	assert.deepEqual(result.sources.map(({ outcome }) => outcome), ['copy-corrupt']);
	assert.equal(harness.rebinds.length, 0);
	assert.equal(harness.managed.size, 0, 'a copy that does not read back is discarded');
	assert.ok(reportItem(result, 'consolidate.copy-corrupt'));
});

test('a source rebound elsewhere mid-copy keeps its new binding and drops this copy', async () => {
	const harness = createHarness({ rebindSucceeds: false });
	const result = await runConsolidate(plan(), harness.ports);

	assert.deepEqual(result.sources.map(({ outcome }) => outcome), ['rebind-superseded']);
	assert.equal(result.complete, false);
	assert.equal(harness.managed.size, 0);
	assert.equal(reportItem(result, 'consolidate.rebind-superseded')?.severity, 'warning');
});

test('an unreachable original is reported by the run, not just by the plan', async () => {
	const harness = createHarness();
	const unreachablePlan = createConsolidatePlan({
		project: project(),
		bindings: [binding()],
		isReachable: () => false,
	});
	const result = await runConsolidate(unreachablePlan, harness.ports);

	assert.equal(result.complete, false);
	assert.deepEqual(result.sources.map(({ outcome }) => outcome), ['unreachable']);
	assert.equal(harness.events.length, 0, 'nothing is read from an original that cannot be reached');
	assert.ok(reportItem(result, 'consolidate.incomplete'));
});

test('the operation has no way to remove or rewrite a linked original', () => {
	const harness = createHarness();
	// The rule is structural rather than written down and trusted: there is no
	// port that could touch the original, so no caller can be asked to be careful.
	assert.deepEqual(Object.keys(harness.ports).sort(), [
		'discardManaged', 'readManaged', 'readOriginal', 'rebind', 'writeManaged',
	]);
});

test('cancellation stops between chunks and leaves nothing rebound', async () => {
	const controller = new AbortController();
	const harness = createHarness({ onChunk: () => { controller.abort(new Error('cancelled')); } });

	await assert.rejects(
		runConsolidate(plan(), harness.ports, { signal: controller.signal }),
		/cancelled/u,
	);
	assert.equal(harness.rebinds.length, 0);
});

test('progress counts the planned copies rather than every source', async () => {
	const harness = createHarness();
	const progress: { completed: number; total: number }[] = [];
	await runConsolidate(
		createConsolidatePlan({
			project: {
				sources: [{ id: 'linked-source' }, { id: 'managed-source' }],
				clips: [{ sourceId: 'linked-source' }, { sourceId: 'managed-source' }],
			},
			bindings: [binding()],
		}),
		harness.ports,
		{ onProgress: (value) => progress.push({ ...value }) },
	);

	assert.deepEqual(progress, [{ completed: 1, total: 1 }]);
});

function plan() {
	return createConsolidatePlan({ project: project(), bindings: [binding()] });
}

function project() {
	return { sources: [{ id: 'linked-source' }], clips: [{ sourceId: 'linked-source' }] };
}

function binding() {
	return {
		sourceId: 'linked-source',
		storageKey: 'linked/original.wav',
		byteLength: ORIGINAL.byteLength,
		sha256: DIGEST,
		bindingToken: 'token-1',
		kind: 'audio' as const,
	};
}

function reportItem(result: { report: { items: readonly Record<string, never>[] } }, code: string) {
	return (result.report.items as unknown as readonly {
		code: string; severity: string; data: Record<string, unknown>;
	}[]).find((item) => item.code === code);
}

function createHarness(options: {
	original?: Uint8Array;
	corruptOnRead?: boolean;
	rebindSucceeds?: boolean;
	onChunk?: () => void;
} = {}) {
	const bytes = options.original ?? ORIGINAL;
	const events: string[] = [];
	const managed = new Map<string, Uint8Array>();
	const rebinds: Record<string, unknown>[] = [];
	const ports: ConsolidatePorts = {
		async *readOriginal() {
			events.push('read-original');
			for (let offset = 0; offset < bytes.byteLength; offset += 32) {
				options.onChunk?.();
				yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + 32));
			}
		},
		async writeManaged(source, chunks) {
			events.push('write-managed');
			const collected: Uint8Array[] = [];
			let byteLength = 0;
			for await (const chunk of chunks) {
				collected.push(chunk.slice());
				byteLength += chunk.byteLength;
			}
			const stored = new Uint8Array(byteLength);
			let offset = 0;
			for (const chunk of collected) {
				stored.set(chunk, offset);
				offset += chunk.byteLength;
			}
			const storageKey = `managed/${source.sourceId}`;
			managed.set(storageKey, stored);
			return { storageKey, byteLength };
		},
		async *readManaged(storageKey) {
			events.push('read-managed');
			const stored = managed.get(storageKey);
			if (!stored) throw new Error(`No managed copy at ${storageKey}.`);
			yield options.corruptOnRead ? Uint8Array.from(stored, (value) => value ^ 1) : stored;
		},
		async rebind(request) {
			events.push('rebind');
			if (options.rebindSucceeds === false) return false;
			rebinds.push({ ...request });
			return true;
		},
		async discardManaged(storageKey) {
			managed.delete(storageKey);
		},
	};
	return { events, managed, rebinds, ports };
}
