/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTrimMediaPlan,
	trimMediaMapFrame,
	trimMediaRetainedRuns,
	trimMediaRetainsFrame,
} from '../src/common/editor/trim-media-plan.ts';
import {
	runTrimMedia,
	type TrimMediaPorts,
} from '../src/common/editor/trim-media-operation.ts';

test('every retained frame maps to exactly one place in the trimmed source', () => {
	const plan = createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 });
	const source = plan.sources.find(({ sourceId }) => sourceId === 'a')!;
	assert.deepEqual(trimMediaRetainedRuns(source), [
		{ startFrame: 10, endFrame: 20, trimmedStartFrame: 0 },
		{ startFrame: 60, endFrame: 70, trimmedStartFrame: 10 },
	]);

	// Exhaustive, not by example: the mapping is a bijection onto the trimmed
	// source, and a discarded frame answers null rather than a nearby survivor.
	const mapped = new Set<number>();
	for (let frame = 0; frame < source.frameCount; frame += 1) {
		const target = trimMediaMapFrame(source, frame);
		if (!trimMediaRetainsFrame(source, frame)) {
			assert.equal(target, null, `frame ${frame} is discarded and must not map anywhere`);
			continue;
		}
		assert.ok(target !== null && target >= 0 && target < source.retainedFrames);
		assert.equal(mapped.has(target!), false, `two source frames mapped to ${String(target)}`);
		mapped.add(target!);
	}
	assert.equal(mapped.size, source.retainedFrames);
});

test('a trimmed copy is written, checked against the plan, and only then rebound', async () => {
	const harness = createHarness();
	const plan = createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 });
	const result = await runTrimMedia({ plan }, harness.ports);

	const trimmed = result.sources.find(({ sourceId }) => sourceId === 'a');
	assert.equal(trimmed?.outcome, 'trimmed');
	assert.equal(trimmed?.retainedFrames, 20);
	assert.equal(trimmed?.discardedFrames, 80);
	assert.equal(result.trimmedSources, 1);
	assert.equal(result.discardedFrames, 80);
	assert.deepEqual(harness.events, ['write:a', 'rebind:a']);
	// The runs travel with the rebind, so a caller can move its clips without
	// recomputing where the frames went.
	assert.deepEqual(harness.rebinds[0]?.runs, trimMediaRetainedRuns(
		plan.sources.find(({ sourceId }) => sourceId === 'a')!,
	));
});

test('a writer that produced fewer frames than the plan retained is refused', async () => {
	const harness = createHarness({ frameCountDelta: -1 });
	const result = await runTrimMedia(
		{ plan: createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 }) },
		harness.ports,
	);

	assert.equal(result.sources.find(({ sourceId }) => sourceId === 'a')?.outcome, 'frame-count-mismatch');
	assert.equal(result.trimmedSources, 0);
	assert.equal(harness.rebinds.length, 0, 'a short copy must never be bound to');
	assert.equal(harness.written.size, 0, 'and must not be kept');
	assert.equal(reportItem(result, 'trim.frame-count-mismatch')?.severity, 'error');
});

test('a copy widened back to a keyframe is accepted, and the document follows what was written', async () => {
	// A lossless cut may only begin at a keyframe, so the writer is allowed to
	// keep more than the plan asked for — and then every reference has to be
	// remapped against what was written, not against what was requested. A run
	// that starts 5 frames earlier moves every later frame by 5.
	const harness = createHarness({ widenTo: 25 });
	const plan = createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 });
	const result = await runTrimMedia({ plan }, harness.ports);

	const trimmed = result.sources.find(({ sourceId }) => sourceId === 'a');
	assert.equal(trimmed?.outcome, 'trimmed', 'keeping more than was asked for is not a shortfall');
	assert.deepEqual(harness.rebinds[0]?.runs, [
		{ startFrame: 0, endFrame: 20, trimmedStartFrame: 0 },
		{ startFrame: 50, endFrame: 70, trimmedStartFrame: 20 },
	]);
	assert.deepEqual(trimmed?.runs, harness.rebinds[0]?.runs);
	assert.equal(harness.rebinds[0]?.frameCount, 40);
	// And the length the document must be told is what the copy holds, not what
	// the plan asked for.
	assert.equal(trimmed?.writtenFrames, 40);
	assert.equal(trimmed?.retainedFrames, 20);
});

test('a copy that lost a referenced frame is refused however many frames it holds', async () => {
	// Widening one run while dropping another keeps the total plausible, so the
	// count alone would let it through. What matters is that every frame the
	// plan proved was referenced is somewhere in the copy.
	const harness = createHarness();
	harness.ports.writeTrimmedCopy = async (source) => ({
		storageKey: `managed/${source.sourceId}.trimmed`,
		frameCount: 20,
		byteLength: 80,
		runs: [{ startFrame: 0, endFrame: 20 }],
	});
	const result = await runTrimMedia(
		{ plan: createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 }) },
		harness.ports,
	);

	assert.equal(result.sources.find(({ sourceId }) => sourceId === 'a')?.outcome, 'frame-count-mismatch');
	assert.equal(harness.rebinds.length, 0, 'a copy missing referenced frames must never be bound to');
});

test('an external file is refused rather than rewritten in place', async () => {
	const harness = createHarness();
	const result = await runTrimMedia({
		plan: createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 }),
		linkedSourceIds: ['a'],
	}, harness.ports);

	assert.equal(result.sources.find(({ sourceId }) => sourceId === 'a')?.outcome, 'linked-original-refused');
	assert.deepEqual(harness.events, [], 'nothing is written for a source that is somebody else’s file');
	assert.match(
		String(reportItem(result, 'trim.linked-original-refused')?.message),
		/consolidate it first/u,
	);
});

test('a fully referenced source is left alone rather than copied to itself', async () => {
	const harness = createHarness();
	const result = await runTrimMedia({
		plan: createTrimMediaPlan({
			project: { sources: [{ id: 'a', frameCount: 20 }], clips: [{ id: 'c', sourceId: 'a', sourceStartFrame: 0, sourceDurationFrames: 20 }] },
		}),
		linkedSourceIds: [],
	}, harness.ports);

	assert.equal(result.sources[0]?.outcome, 'whole-source-retained');
	assert.deepEqual(harness.events, []);
});

test('the pre-trim bytes are never removed, so the run stays undoable', async () => {
	const harness = createHarness();
	const result = await runTrimMedia(
		{ plan: createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 }) },
		harness.ports,
	);

	assert.equal(result.undoable, true);
	// Structural, not documentary: there is no port that could remove them.
	assert.deepEqual(Object.keys(harness.ports).sort(), [
		'discardTrimmedCopy', 'rebind', 'writeTrimmedCopy',
	]);
});

test('a source rebound elsewhere mid-trim drops the trimmed copy', async () => {
	const harness = createHarness({ rebindSucceeds: false });
	const result = await runTrimMedia(
		{ plan: createTrimMediaPlan({ project: gappedProject(), handleFrames: 0 }) },
		harness.ports,
	);

	assert.equal(result.sources.find(({ sourceId }) => sourceId === 'a')?.outcome, 'rebind-superseded');
	assert.equal(harness.written.size, 0);
});

test('cancellation stops before the next source is written', async () => {
	const controller = new AbortController();
	const harness = createHarness({ onWrite: () => { controller.abort(new Error('cancelled')); } });

	await assert.rejects(runTrimMedia(
		{ plan: createTrimMediaPlan({ project: twoTrimmableSources(), handleFrames: 0 }) },
		harness.ports,
		{ signal: controller.signal },
	), /cancelled/u);
	assert.equal(harness.rebinds.length, 0);
});

function gappedProject() {
	return {
		sources: [{ id: 'a', frameCount: 100 }],
		clips: [
			{ id: 'c1', sourceId: 'a', sourceStartFrame: 10, sourceDurationFrames: 10 },
			{ id: 'c2', sourceId: 'a', sourceStartFrame: 60, sourceDurationFrames: 10 },
		],
	};
}

function twoTrimmableSources() {
	return {
		sources: [{ id: 'a', frameCount: 100 }, { id: 'b', frameCount: 100 }],
		clips: [
			{ id: 'c1', sourceId: 'a', sourceStartFrame: 10, sourceDurationFrames: 10 },
			{ id: 'c2', sourceId: 'b', sourceStartFrame: 10, sourceDurationFrames: 10 },
		],
	};
}

function reportItem(result: { report: unknown }, code: string) {
	return (result.report as { items: readonly {
		code: string; severity: string; message?: string;
	}[] }).items.find((item) => item.code === code);
}

function createHarness(options: {
	frameCountDelta?: number;
	rebindSucceeds?: boolean;
	onWrite?: () => void;
	/** Stand in for a writer that may only begin a run at a keyframe. */
	widenTo?: number;
} = {}) {
	const events: string[] = [];
	const written = new Map<string, number>();
	const rebinds: Record<string, unknown>[] = [];
	const ports: TrimMediaPorts = {
		async writeTrimmedCopy(source, runs) {
			events.push(`write:${source.sourceId}`);
			options.onWrite?.();
			const grid = options.widenTo ?? 0;
			const written_ = grid > 0
				? runs.map((run) => ({
					startFrame: Math.floor(run.startFrame / grid) * grid,
					endFrame: run.endFrame,
				}))
				: runs.map((run) => ({ startFrame: run.startFrame, endFrame: run.endFrame }));
			const frameCount = written_.reduce(
				(sum, run) => sum + (run.endFrame - run.startFrame), 0,
			) + (options.frameCountDelta ?? 0);
			const storageKey = `managed/${source.sourceId}.trimmed`;
			written.set(storageKey, frameCount);
			return { storageKey, frameCount, byteLength: frameCount * 4, runs: written_ };
		},
		async rebind(request) {
			events.push(`rebind:${request.sourceId}`);
			if (options.rebindSucceeds === false) return false;
			rebinds.push({ ...request });
			return true;
		},
		async discardTrimmedCopy(storageKey) { written.delete(storageKey); },
	};
	return { events, written, rebinds, ports };
}
