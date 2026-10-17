/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRenderRequest } from '../src/motionscaper/editor-render-task.ts';
import { createMotionRenderQueue, renderMotionFrameSequence, type MotionRenderFrame } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createMotionAudioMixer } from '../src/common/editor/motion-audio-mixer.ts';
import { addRationals, compareRationals } from '../src/common/editor/timeline-time.ts';
import type { MotionAudioMixBlock } from '../src/common/editor/motion-audio-contract.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}
function fixture() {
	const project = createMotionscaperProject({ id: 'motion-1', compositionId: 'comp-1', title: 'Render',
		width: 2, height: 2, frameRate: { num: 30000, den: 1001 }, durationFrames: 3 });
	const frames: MotionRenderFrame[] = [];
	const events: string[] = [];
	const request = createMotionscaperRenderRequest({ project, compositionId: 'comp-1',
		acquire: async (revision) => {
			events.push(`acquire:${revision.project.title}`);
			return { rasterizer: { async rasterize() { throw new Error('Empty scenes have no source rasterization.'); } },
				async release() { events.push('release'); } };
		},
		sink: { async write(frame) { frames.push(frame); events.push(`write:${frame.index}`); },
			async finish() { events.push('finish'); return 'delivered'; }, async abort() { events.push('abort'); } },
	});
	return { project, request, frames, events };
}

test('M05 exports exact fractional-rate times and releases pinned resources before publication', async () => {
	const { request, frames, events } = fixture();
	const receipt = await renderMotionFrameSequence(request);
	assert.equal(receipt.output, 'delivered');
	assert.equal(receipt.renderedFrames, 3);
	assert.deepEqual(frames.map((frame) => frame.time), [{ num: 0, den: 1 }, { num: 1001, den: 30000 }, { num: 1001, den: 15000 }]);
	assert.deepEqual(frames.map((frame) => frame.duration), Array.from({ length: 3 }, () => ({ num: 1001, den: 30000 })));
	assert.deepEqual(events, ['acquire:Render', 'write:0', 'write:1', 'write:2', 'release', 'finish']);
	assert.equal(receipt.identity.revisionDigest, request.plan.identity.revisionDigest);
});

test('M05 a backpressured sink holds at most one frame and cancellation cannot publish output', async () => {
	const { request, frames, events } = fixture();
	const entered = deferred<void>(); const resume = deferred<void>();
	const controller = new AbortController();
	const running = renderMotionFrameSequence({ ...request, signal: controller.signal,
		sink: { ...request.sink, async write(frame) { frames.push(frame); entered.resolve(); await resume.promise; } } });
	await entered.promise;
	assert.equal(frames.length, 1);
	controller.abort(new DOMException('Cancelled render', 'AbortError'));
	resume.resolve();
	await assert.rejects(running, /Cancelled render/u);
	assert.equal(frames.length, 1);
	assert.deepEqual(events, ['acquire:Render', 'release', 'abort']);
});

test('M05 starting revision stays immutable when authoring continues during queued rendering', async () => {
	const { project } = fixture();
	const draft = { ...project, title: 'Pinned' };
	let acquiredTitle = '';
	const request = createMotionscaperRenderRequest({ project: draft, compositionId: 'comp-1',
		acquire: async (revision) => { acquiredTitle = revision.project.title; return {
			rasterizer: { async rasterize() { throw new Error('Empty'); } }, async release() {} }; },
		sink: { async write() {}, async finish() { return 'done'; }, async abort() {} } });
	draft.title = 'Later edit';
	await renderMotionFrameSequence(request);
	assert.equal(acquiredTitle, 'Pinned');
});

test('M05 render failures preserve the primary error and report all cleanup failures', async () => {
	const { request, events } = fixture();
	await assert.rejects(renderMotionFrameSequence({ ...request,
		acquire: async (signal) => ({ ...await request.acquire(signal), async release() { events.push('release'); throw new Error('release failed'); } }),
		sink: { async write() { throw new Error('disk full'); }, async finish() { assert.fail('No publication'); }, async abort() { events.push('abort'); throw new Error('abort failed'); } },
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /failed/u);
		assert.match(String(error.errors), /disk full/u);
		assert.match(String(error.errors), /release failed/u);
		assert.match(String(error.errors), /abort failed/u);
		return true;
	});
	assert.deepEqual(events, ['acquire:Render', 'release', 'abort']);
});

test('M05 the queue caps pending jobs, cancels waiting jobs without acquiring assets, and closes idempotently', async () => {
	const { request } = fixture();
	const queue = createMotionRenderQueue({ maximumQueuedJobs: 1 });
	const entered = deferred<void>(); const resume = deferred<void>();
	const first = queue.enqueue({ ...request, sink: { ...request.sink, async write() { entered.resolve(); await resume.promise; } } });
	await entered.promise;
	const second = queue.enqueue(request);
	const secondFailure = assert.rejects(second.completion, /Cancelled|closed/u);
	assert.throws(() => queue.enqueue(request), /full/u);
	second.cancel();
	resume.resolve();
	assert.equal((await first.completion).output, 'delivered');
	await secondFailure;
	await queue.close(); await queue.close();
	assert.throws(() => queue.enqueue(request), /closed/u);
});

test('M05 invalid ranges and mismatched evaluator frames fail before output publication', async () => {
	const { project, request, events } = fixture();
	assert.throws(() => createMotionscaperRenderRequest({ project, compositionId: 'comp-1', firstFrame: 3,
		acquire: async () => ({ rasterizer: { async rasterize() { throw new Error('Empty'); } }, async release() {} }), sink: request.sink }), /range/u);
	await assert.rejects(renderMotionFrameSequence({ ...request, plan: { ...request.plan, width: 3 } }), /dimensions/u);
	assert.deepEqual(events, ['acquire:Render', 'release', 'abort']);
});

test('M05 retained render leases forward their working-memory admission before any output frame', async () => {
	const { request, events } = fixture();
	await assert.rejects(renderMotionFrameSequence({ ...request, acquire: async (signal) => ({ ...await request.acquire(signal), maximumWorkingBytes: 1 }) }), /budget/u);
	assert.deepEqual(events, ['acquire:Render', 'release', 'abort']);
});

test('M05 video cannot silently discard authored audio, while image sequences may explicitly exclude it', async () => {
	const { request, events } = fixture();
	const acquire = async (signal?: AbortSignal) => {
		const lease = await request.acquire(signal);
		return { ...lease, evaluator: { ...lease.evaluator, evaluate(input: Parameters<typeof lease.evaluator.evaluate>[0]) {
			return { ...lease.evaluator.evaluate(input), audio: [{ occurrenceId: 'comp/audio', assetId: 'audio', sourceTime: { num: 0, den: 1 }, gain: 1, playbackRate: { num: 1, den: 1 } }] };
		} } };
	};
	await assert.rejects(renderMotionFrameSequence({ ...request, acquire }), /audio/u);
	assert.deepEqual(events, ['acquire:Render', 'release', 'abort']);
	const excluded = await renderMotionFrameSequence({ ...request, acquire, sink: { ...request.sink, audioPolicy: 'exclude' } });
	assert.equal(excluded.renderedFrames, 3);
});

test('M05 video preflight detects subframe audio that falls between visual frame samples', () => {
	const { project, request } = fixture();
	const audio = { kind: 'audio' as const, id: 'audio', name: 'Audio', mimeType: 'audio/wav', byteLength: 1, sha256: 'a'.repeat(64),
		storageKey: `motion-sha256:${'a'.repeat(64)}`, sampleRate: 48000, channels: 1, duration: { num: 1, den: 1 } };
	const placement = { id: 'placement', assetId: audio.id, startFrame: { num: 1, den: 4 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 1, den: 4 },
		sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, gain: motionScalar(1), enabled: true };
	const authored = { ...project, assets: [audio], compositions: [{ ...project.compositions[0], audio: [placement] }] };
	assert.throws(() => createMotionscaperRenderRequest({ project: authored, compositionId: 'comp-1', sink: request.sink,
		acquire: async () => ({ rasterizer: { async rasterize() { throw new Error('Empty'); } }, async release() {} }) }), /audio/u);
});

test('M05 audio delivery preserves fractional work-area starts and cumulative sample boundaries with one block in flight', async () => {
	const { project, request, events } = fixture(); const blocks: MotionAudioMixBlock[] = [];
	const sink = { ...request.sink, audio: { sampleRate: 48000, channels: 2 as const,
		async write(block: MotionAudioMixBlock) { blocks.push(block); events.push(`audio:${block.sampleCount}`); } } };
	const audioRequest = createMotionscaperRenderRequest({ project, compositionId: 'comp-1', firstFrame: 1, sink,
		acquire: async (revision, signal) => {
			const lease = await request.acquire(signal);
			const audioMixer = createMotionAudioMixer({ project: revision.project, provider: {
				async describe() { throw new Error('Empty audio has no decoded source.'); }, async read() { throw new Error('Empty audio has no decoded source.'); },
			} });
			return { ...lease, audioMixer, async release() { audioMixer.dispose(); await lease.release(); } };
		} });
	await renderMotionFrameSequence(audioRequest);
	assert.deepEqual(blocks.map((block) => block.sampleCount), [1602, 1602]);
	assert.deepEqual(blocks[0]!.startSample, { num: 8008, den: 5 });
	assert.equal(compareRationals(blocks[1]!.startSample, addRationals(blocks[0]!.startSample, 1602)), 0);
	assert.ok(blocks.every((block) => block.interleaved.length === block.sampleCount * 2 && block.interleaved.every((sample) => sample === 0)));
	assert.deepEqual(events, ['acquire:Render', 'audio:1602', 'write:0', 'audio:1602', 'write:1', 'release', 'finish']);
});

test('M05 a PCM sink requires the pinned audio mixer and rejects stale returned revision bytes before writing them', async () => {
	const { project, request, events } = fixture(); let written = false;
	const sink = { ...request.sink, audio: { sampleRate: 48000, channels: 1 as const, async write() { written = true; } } };
	await assert.rejects(renderMotionFrameSequence({ ...request, sink }), /audio mixer/u);
	const mixer = createMotionAudioMixer({ project, provider: { async describe() { throw new Error('Empty'); }, async read() { throw new Error('Empty'); } } });
	await assert.rejects(renderMotionFrameSequence({ ...request, sink, acquire: async (signal) => ({ ...await request.acquire(signal),
		audioMixer: { ...mixer, async mixBlock(...args) { return { ...await mixer.mixBlock(...args), revisionDigest: 'b'.repeat(64) }; } },
	}) }), /stale|malformed/u);
	assert.equal(written, false); assert.equal(events.filter((value) => value === 'finish').length, 0); mixer.dispose();
});

test('M05 synchronous render and sink work yields to a host cancellation task before publication', async () => {
	const { request, frames, events } = fixture(); const controller = new AbortController();
	const cancelTask = setTimeout(() => { controller.abort(new DOMException('Cancelled from the host task', 'AbortError')); }, 0);
	try { await assert.rejects(renderMotionFrameSequence({ ...request, signal: controller.signal }), /host task/u); }
	finally { clearTimeout(cancelTask); }
	assert.equal(frames.length, 1); assert.deepEqual(events, ['acquire:Render', 'write:0', 'release', 'abort']);
});
