/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoNavigationService } from '../src/common/editor/controller/video-navigation-service.ts';
import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import type { VideoEditTargets } from '../src/common/editor/video-edit-targeting.ts';

const RATE = Object.freeze({ num: 25, den: 1 });

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function document(id = 'project-1') {
	return {
		id,
		sampleRate: 48_000,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-a', 'video-b', 'hidden'] }],
		tracks: [
			{ id: 'video-a', type: 'video', clipIds: ['a'] },
			{ id: 'video-b', type: 'video', clipIds: ['b'] },
			{ id: 'hidden', type: 'video', hidden: true, clipIds: ['h'] },
		],
		clips: [
			{ id: 'a', kind: 'video', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 20 },
			{ id: 'b', kind: 'video', sequenceId: 'main', sequenceStartFrame: 5, sequenceFrameCount: 10 },
			{ id: 'h', kind: 'video', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 100 },
		],
	};
}

function target(videoTrackId: string | null = null, explicit = false): VideoEditTargets {
	return Object.freeze({
		sequenceId: 'main',
		videoTrackId,
		audioTrackId: null,
		explicit,
	});
}

function harness(options: Readonly<{
	positionFrame?: number;
	project?: ReturnType<typeof document>;
	freshProjection?: boolean;
	scrub?: (frame: number) => unknown;
}> = {}) {
	let now = 0;
	let project = options.project ?? document();
	let positionFrame = options.positionFrame ?? 0;
	let nextTimer = 0;
	const timers = new Map<number, () => void>();
	const scrubs: number[] = [];
	const seeks: number[] = [];
	const published: unknown[] = [];
	const errors: unknown[] = [];
	let endScrubs = 0;
	let targets = target();
	const lifetime = new AbortController();
	const service = createVideoNavigationService({
		lifetime: {
			signal: lifetime.signal,
			assertActive() {
				if (lifetime.signal.aborted) throw lifetime.signal.reason;
			},
		},
		getProject: () => options.freshProjection ? structuredClone(project) : project,
		getProjectIdentity: () => project,
		getTargets: () => targets,
		getPositionFrames: () => positionFrame,
		now: () => now,
		setInterval(callback) {
			const identifier = ++nextTimer;
			timers.set(identifier, callback);
			return identifier;
		},
		clearInterval(identifier) {
			timers.delete(Number(identifier));
		},
		scrub(frame) {
			scrubs.push(frame);
			positionFrame = frame;
			return options.scrub?.(frame) ?? frame;
		},
		seek(frame) {
			seeks.push(frame);
			positionFrame = frame;
			return frame;
		},
		endScrub() {
			endScrubs += 1;
		},
		publish: (view) => published.push(view),
		handleError: (error) => errors.push(error),
	});
	return {
		service,
		scrubs,
		seeks,
		published,
		errors,
		timers,
		lifetime,
		setNow(value: number) { now = value; },
		setProject(value: ReturnType<typeof document>) { project = value; },
		setPosition(value: number) { positionFrame = value; },
		setTargets(value: VideoEditTargets) { targets = value; },
		tick() { for (const callback of [...timers.values()]) callback(); },
		endScrubs: () => endScrubs,
	};
}

test('repeated J/L presses retime one live timer and K settles the absolute position', () => {
	const start = sequenceFrameBoundarySample(2, RATE, 48_000);
	const context = harness({ positionFrame: start });
	assert.equal(context.service.shuttleForward().rate, 1);
	assert.equal(context.timers.size, 1);
	context.setNow(400);
	assert.equal(context.service.shuttleForward().rate, 2);
	assert.equal(context.timers.size, 1);
	assert.equal(context.service.view().positionFrame, sequenceFrameBoundarySample(12, RATE, 48_000));
	context.setNow(600);
	const stopped = context.service.shuttleStop();
	assert.equal(stopped.rate, 0);
	assert.equal(stopped.positionFrame, sequenceFrameBoundarySample(20, RATE, 48_000));
	assert.equal(context.timers.size, 0);
	assert.equal(context.endScrubs(), 1);
	assert.equal(context.seeks.at(-1), sequenceFrameBoundarySample(20, RATE, 48_000));
	assert.ok(Object.isFrozen(stopped));
	assert.ok(context.published.every(Object.isFrozen));
});

test('the timer resolves from its anchor and auto-stops exactly at either end', () => {
	const reverse = harness({ positionFrame: sequenceFrameBoundarySample(2, RATE, 48_000) });
	reverse.service.shuttleReverse();
	reverse.setNow(1_000);
	reverse.tick();
	assert.equal(reverse.service.view().positionFrame, 0);
	assert.equal(reverse.service.view().rate, 0);
	assert.equal(reverse.timers.size, 0);
	assert.equal(reverse.seeks.at(-1), 0);
	assert.equal(reverse.endScrubs(), 1);

	const forward = harness({ positionFrame: sequenceFrameBoundarySample(19, RATE, 48_000) });
	forward.service.shuttleForward();
	forward.setNow(1_000);
	forward.tick();
	const end = sequenceFrameBoundarySample(20, RATE, 48_000);
	assert.equal(forward.service.view().positionFrame, end);
	assert.equal(forward.service.view().rate, 0);
	assert.equal(forward.seeks.at(-1), end);
});

test('a project replacement ends the shuttle without seeking into the new document', () => {
	const context = harness({ positionFrame: sequenceFrameBoundarySample(2, RATE, 48_000) });
	context.service.shuttleForward();
	const seekCount = context.seeks.length;
	context.setProject(document('project-2'));
	context.tick();
	assert.equal(context.service.view().rate, 0);
	assert.equal(context.timers.size, 0);
	assert.equal(context.endScrubs(), 1);
	assert.equal(context.seeks.length, seekCount);
});

test('a snapshot view retires a replaced project without recursively publishing', () => {
	const context = harness();
	context.service.shuttleForward();
	const publicationCount = context.published.length;
	context.setProject(document('project-2'));
	assert.equal(context.service.view().rate, 0);
	assert.equal(context.published.length, publicationCount);
	assert.equal(context.timers.size, 0);
	assert.equal(context.endScrubs(), 1);
});

test('fresh command projections share an explicit stable project identity', () => {
	const context = harness({ freshProjection: true });
	context.service.shuttleForward();
	context.setNow(100);
	context.tick();
	assert.equal(context.service.view().rate, 1);
	assert.equal(context.timers.size, 1);
	assert.equal(context.scrubs.at(-1), sequenceFrameBoundarySample(2, RATE, 48_000));
});

test('lifetime abort clears the timer and scrub exactly once', () => {
	const context = harness();
	context.service.shuttleForward();
	context.lifetime.abort(new DOMException('disposed', 'AbortError'));
	context.lifetime.abort();
	assert.equal(context.timers.size, 0);
	assert.equal(context.endScrubs(), 1);
	assert.throws(() => context.service.view(), /disposed/u);
});

test('latest async scrub preparation publishes completion and stale failures are fenced', async () => {
	const first = deferred<number>();
	const second = deferred<number>();
	const queue = [first, second];
	const context = harness({ scrub: () => queue.shift()?.promise ?? 0 });
	assert.equal(context.service.shuttleForward().preparing, true);
	assert.equal(context.service.shuttleForward().rate, 2);
	assert.equal(context.scrubs.length, 1);
	first.reject(new Error('stale preparation'));
	await Promise.resolve();
	assert.deepEqual(context.errors, []);
	assert.equal(context.service.view().preparing, true);
	assert.equal(context.scrubs.length, 2);
	second.resolve(0);
	await Promise.resolve();
	assert.equal(context.service.view().preparing, false);
	assert.deepEqual(context.errors, []);
});

test('timer ticks serialize scrub preparation and retain only the latest absolute position', async () => {
	const first = deferred<number>();
	const second = deferred<number>();
	const queue = [first, second];
	const context = harness({ scrub: () => queue.shift()?.promise ?? 0 });
	context.service.shuttleForward();
	context.setNow(100);
	context.tick();
	context.setNow(200);
	context.tick();
	assert.equal(context.scrubs.length, 1);
	first.resolve(0);
	await Promise.resolve();
	assert.equal(context.scrubs.length, 2);
	assert.equal(context.scrubs[1], sequenceFrameBoundarySample(5, RATE, 48_000));
	second.resolve(0);
	await Promise.resolve();
	assert.equal(context.service.view().preparing, false);
});

test('a current scrub failure stops and reports exactly once', async () => {
	const preparation = deferred<number>();
	const context = harness({
		positionFrame: sequenceFrameBoundarySample(10, RATE, 48_000),
		scrub: () => preparation.promise,
	});
	context.service.shuttleReverse();
	const failure = new Error('audio preparation failed');
	preparation.reject(failure);
	await Promise.resolve();
	assert.equal(context.service.view().rate, 0);
	assert.equal(context.timers.size, 0);
	assert.equal(context.endScrubs(), 1);
	assert.deepEqual(context.errors, [failure]);
});

test('previous and next edit navigation use live targets and never mutate the document', () => {
	const value = document();
	const before = structuredClone(value);
	const atTen = sequenceFrameBoundarySample(10, RATE, 48_000);
	const context = harness({ project: value, positionFrame: atTen });
	context.setTargets(target('video-a', true));
	assert.equal(context.service.previousEditPoint(), 0);
	context.setPosition(atTen);
	assert.equal(context.service.nextEditPoint(), sequenceFrameBoundarySample(20, RATE, 48_000));
	context.setTargets(target(null, true));
	assert.equal(context.service.nextEditPoint(), null);
	assert.deepEqual(value, before);
	assert.deepEqual(context.seeks, [0, sequenceFrameBoundarySample(20, RATE, 48_000)]);
});
