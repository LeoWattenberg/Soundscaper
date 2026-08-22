/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import test from 'node:test';

import { createVideoRetimePreviewExecutor } from '../src/common/editor/video-retime-preview-executor.ts';
import type { VideoRetimeFrameDescriptor } from '../src/common/editor/video-retime-frame-dispatch.ts';

interface VideoRetimePreviewMediaPort {
	pause(): void;
	assertCurrent(): void;
	present(request: Readonly<{
		readonly drawableSourceFrame: number; readonly intervalStartSeconds: number;
		readonly intervalEndSeconds: number; readonly targetSeconds: number;
		readonly signal: AbortSignal;
	}>): PromiseLike<Readonly<{ mediaTime: number }>>;
}
type VideoRetimePreviewResult = Readonly<{ kind: 'presented' | 'superseded' | 'cancelled' }>;
interface VideoRetimePreviewExecutor {
	requestFrame(descriptor: VideoRetimeFrameDescriptor): Promise<VideoRetimePreviewResult>;
	cancel(): void;
	dispose(): void;
}
type VideoRetimePreviewFactory = (
	port: VideoRetimePreviewMediaPort,
	options: Readonly<{ onPresented: (descriptor: VideoRetimeFrameDescriptor) => void }>,
) => VideoRetimePreviewExecutor;
const createExecutor: VideoRetimePreviewFactory = createVideoRetimePreviewExecutor;
type PresentRequest = Parameters<VideoRetimePreviewMediaPort['present']>[0];
type MediaResult = Readonly<{ mediaTime: number }>;
type RetimeMode = VideoRetimeFrameDescriptor['mode'];
interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
	readonly reject: (reason?: unknown) => void;
}
interface Presentation { readonly request: PresentRequest; readonly gate: Deferred<MediaResult> }
const EXECUTOR_SOURCE_URL = new URL('../src/common/editor/video-retime-preview-executor.ts', import.meta.url);
const EDITOR_SOURCE_ROOT = new URL('../src/common/editor/', import.meta.url);
const RESULT_ERROR = /current|media|present|terminal|disposed|consumer|callback/iu;

test('pins the factory, port request, exact midpoint, frozen result, and cached-picture API', async () => {
	const published: VideoRetimeFrameDescriptor[] = [];
	const harness = mediaHarness();
	const port = harness.port;
	const executor = createExecutor(port, {
		onPresented: (value) => { published.push(value); },
	});
	assert.equal(harness.pauseCalls(), 1);
	Object.defineProperties(port, {
		assertCurrent: { configurable: true, enumerable: true, value: () => { throw new Error('mutated currentness'); } },
		present: { configurable: true, enumerable: true, value: () => { throw new Error('mutated presenter'); } },
	});
	const input = frameDescriptor({ outerCell: 3, drawableSourceFrame: 10, start: exact(10n, 3n), end: exact(11n, 3n) });
	const pending = executor.requestFrame(input);
	assert.equal(harness.presentations.length, 1, 'the first request starts synchronously');
	assert.deepEqual(harness.events, ['pause', 'current', 'present:10']);
	const request = presentation(harness, 0).request;
	assert.deepEqual(Reflect.ownKeys(request), [
		'drawableSourceFrame', 'intervalStartSeconds', 'intervalEndSeconds', 'targetSeconds', 'signal',
	]);
	assert.equal(request.drawableSourceFrame, 10);
	assert.equal(request.intervalStartSeconds, 10 / 3);
	assert.equal(request.intervalEndSeconds, 11 / 3);
	assert.equal(request.targetSeconds, 3.5);
	assert.equal(request.signal.aborted, false);
	assert.equal(Object.isFrozen(request), true);
	presentation(harness, 0).gate.resolve(Object.freeze({ mediaTime: 3.5 }));
	await resultOf(pending, 'presented');
	assert.deepEqual(harness.events, ['pause', 'current', 'present:10', 'current']);
	assert.equal(published.length, 1);
	assert.deepEqual(published[0], input);
	assert.notStrictEqual(published[0], input);
	assertDeepFrozen(required(published[0]));
	const stale = new Error('cached source changed');
	harness.failCurrentAt(3, stale);
	const cached = executor.requestFrame(frameDescriptor({ outerCell: 99, segmentIndex: 4, mode: 'freeze',
		drawableSourceFrame: 10, start: exact(10n, 3n), end: exact(11n, 3n) }));
	await rejectsWith(cached, stale);
	assert.equal(harness.presentations.length, 1);
	assert.equal(published.length, 1, 'a stale cached picture does not republish metadata');
});
test('converts balanced 4,096-bit endpoints without intermediate Number infinity', async () => {
	const scale = 1n << 4_094n;
	const harness = mediaHarness();
	const executor = executorFor(harness);
	const pending = executor.requestFrame(frameDescriptor({
		start: exact(scale + 1n, scale),
		end: exact(2n * scale + 1n, scale),
	}));
	const request = presentation(harness, 0).request;
	assert.equal(Number.isFinite(request.intervalStartSeconds), true);
	assert.equal(Number.isFinite(request.intervalEndSeconds), true);
	assert.equal(request.intervalStartSeconds, 1);
	assert.equal(request.intervalEndSeconds, 2);
	assert.equal(request.targetSeconds, 1.5);
	presentation(harness, 0).gate.resolve({ mediaTime: 1.5 });
	await resultOf(pending, 'presented');
});
test('reduces admitted over-ceiling raw midpoint products before applying the normalized ceiling', async () => {
	const q = (1n << 2_047n) - 1n;
	const r = (1n << 2_046n) + 1n;
	const p = q - r;
	const m = (1n << 4_043n) - 1n;
	const startDenominator = p * q;
	const endDenominator = p * r;
	const start = exact(startDenominator - m, startDenominator);
	const end = exact(endDenominator + m, endDenominator);
	assert.equal(greatestCommonDivisor(start.numerator, start.denominator), 1n);
	assert.equal(greatestCommonDivisor(end.numerator, end.denominator), 1n);
	assert.ok(bitLength(p * q * r) > 4_096);
	assert.ok(bitLength(2n * q * r + m) <= 4_096);
	assert.ok(bitLength(2n * q * r) <= 4_096);
	const harness = mediaHarness();
	const pending = executorFor(harness).requestFrame(frameDescriptor({ start, end }));
	const request = presentation(harness, 0).request;
	assert.ok(request.intervalStartSeconds < 1);
	assert.ok(request.intervalEndSeconds > 1);
	assert.ok(request.intervalStartSeconds < request.targetSeconds);
	assert.ok(request.targetSeconds < request.intervalEndSeconds);
	presentation(harness, 0).gate.resolve({ mediaTime: request.targetSeconds });
	await resultOf(pending, 'presented');
});
test('refuses normalized over-ceiling midpoint work, invalid exact records, and collapsed Number intervals', () => {
	const harness = mediaHarness();
	const executor = executorFor(harness);
	const power = 1n << 4_095n;
	assert.throws(
		() => executor.requestFrame(frameDescriptor({
			start: exact(power - 1n, power),
			end: exact(power, power - 1n),
		})),
		/4096|4,096|bit|complexity|intermediate/iu,
	);
	const collapsedDenominator = 1n << 1_075n;
	assert.throws(
		() => executor.requestFrame(frameDescriptor({
			start: exact(1n),
			end: exact(collapsedDenominator + 1n, collapsedDenominator),
		})),
		/collapse|representable|underflow|number|interval/iu,
	);
	for (const [name, start, end] of [
		['noncanonical', exact(2n, 2n), exact(2n)],
		['zero denominator', exact(1n, 0n), exact(2n)],
		['negative denominator', exact(1n, -1n), exact(2n)],
		['reversed', exact(2n), exact(1n)],
		['equal', exact(1n), exact(1n)],
		['oversized', exact(1n << 4_096n), exact((1n << 4_096n) + 1n)],
	] as const) {
		assert.throws(
			() => executor.requestFrame(frameDescriptor({ start, end })),
			/exact|canonical|denominator|positive|interval|4096|4,096|bit|complexity|order/iu,
			name,
		);
	}
	assert.equal(harness.presentations.length, 0);
});
test('takes one closed deep descriptor snapshot and ignores every later raw mutation', async () => {
	const published: VideoRetimeFrameDescriptor[] = [];
	const expected = frameDescriptor({
		outerCell: 7, segmentIndex: 2, mode: 'ramp-reverse', drawableSourceFrame: 12,
		start: exact(5n, 2n), end: exact(8n, 3n),
	});
	const tracked = trackedDescriptor(frameDescriptorRecord({
		outerCell: 7, segmentIndex: 2, mode: 'ramp-reverse', drawableSourceFrame: 12,
		start: exact(5n, 2n), end: exact(8n, 3n),
	}));
	const harness = mediaHarness();
	const executor = createExecutor(harness.port, {
		onPresented: (value) => { published.push(value); },
	});
	const pending = executor.requestFrame(tracked.proxy);
	assert.equal(tracked.ownKeyReads(), 1);
	assert.equal(tracked.propertyReads(), 0);
	const target = presentation(harness, 0).request.targetSeconds;
	tracked.target.outerCell = 99;
	tracked.target.mode = 'freeze';
	tracked.target.drawableSourceFrame = 99;
	tracked.target.drawableSourceStartTime.numerator = 99n;
	tracked.target.drawableSourceEndTime.denominator = 99n;
	presentation(harness, 0).gate.resolve({ mediaTime: target });
	await resultOf(pending, 'presented');
	assert.equal(tracked.ownKeyReads(), 1);
	assert.equal(tracked.propertyReads(), 0);
	assert.deepEqual(published, [expected]);
	assertDeepFrozen(required(published[0]));
	assert.equal(Object.isFrozen(tracked.target), false, 'snapshotting must not freeze caller state');
});
test('refuses top-level and nested accessors without invoking them, plus missing or extra fields', () => {
	for (const field of descriptorFields()) {
		let reads = 0;
		const candidate = frameDescriptorRecord();
		Object.defineProperty(candidate, field, {
			enumerable: true,
			get() { reads += 1; return undefined; },
		});
		assert.throws(() => executorFor(mediaHarness()).requestFrame(asDescriptor(candidate)), /accessor|data property|closed|own/iu, field);
		assert.equal(reads, 0, field);
	}
	for (const rationalField of ['sourceFrame', 'sourceTime', 'drawableSourceStartTime', 'drawableSourceEndTime'] as const) {
		for (const exactField of ['numerator', 'denominator'] as const) {
			let reads = 0;
			const candidate = frameDescriptorRecord();
			Object.defineProperty(candidate[rationalField], exactField, {
				enumerable: true,
				get() { reads += 1; return 1n; },
			});
			assert.throws(() => executorFor(mediaHarness()).requestFrame(asDescriptor(candidate)), /accessor|data property|closed|own/iu);
			assert.equal(reads, 0, `${rationalField}.${exactField}`);
		}
	}
	const extra = Object.assign(frameDescriptorRecord(), { unexpected: true });
	assert.throws(() => executorFor(mediaHarness()).requestFrame(asDescriptor(extra)), /closed|extra|unexpected|field|key/iu);
	const nestedExtra = frameDescriptorRecord();
	Object.assign(nestedExtra.drawableSourceStartTime, { unexpected: true });
	assert.throws(() => executorFor(mediaHarness()).requestFrame(asDescriptor(nestedExtra)), /closed|extra|unexpected|field|key/iu);
	const missing = frameDescriptorRecord();
	delete (missing as Partial<typeof missing>).sourceTime;
	assert.throws(() => executorFor(mediaHarness()).requestFrame(asDescriptor(missing)), /closed|missing|required|field|key/iu);
});
test('keeps only the latest pending key for every A/B/C permutation', async () => {
	const descriptors = {
		A: frameDescriptor({ outerCell: 1, drawableSourceFrame: 1, start: exact(1n), end: exact(2n) }),
		B: frameDescriptor({ outerCell: 2, drawableSourceFrame: 2, start: exact(2n), end: exact(3n) }),
		C: frameDescriptor({ outerCell: 3, drawableSourceFrame: 3, start: exact(3n), end: exact(4n) }),
	};
	const permutations = [
		['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'],
		['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A'],
	] as const;
	for (const [firstKey, replacedKey, latestKey] of permutations) {
		const published: VideoRetimeFrameDescriptor[] = [];
		const harness = mediaHarness();
		const executor = createExecutor(harness.port, {
			onPresented: (value) => { published.push(value); },
		});
		const first = executor.requestFrame(descriptors[firstKey]);
		const replaced = executor.requestFrame(descriptors[replacedKey]);
		const latest = executor.requestFrame(descriptors[latestKey]);
		await resultOf(replaced, 'superseded');
		assert.deepEqual(harness.presentations.map(({ request }) => request.drawableSourceFrame), [
			descriptors[firstKey].drawableSourceFrame,
		]);
		presentation(harness, 0).gate.resolve({ mediaTime: presentation(harness, 0).request.targetSeconds });
		await resultOf(first, 'superseded');
		assert.equal(harness.presentations.length, 2);
		presentation(harness, 1).gate.resolve({ mediaTime: presentation(harness, 1).request.targetSeconds });
		await resultOf(latest, 'presented');
		assert.deepEqual(published.map(({ outerCell }) => outerCell), [descriptors[latestKey].outerCell]);
	}
});
test('coalesces active and pending picture keys onto one Promise while retaining latest metadata', async () => {
	const published: VideoRetimeFrameDescriptor[] = [];
	const harness = mediaHarness();
	const executor = createExecutor(harness.port, {
		onPresented: (value) => { published.push(value); },
	});
	const activeFirst = frameDescriptor({ outerCell: 1, drawableSourceFrame: 4, start: exact(4n), end: exact(5n) });
	const activeLatest = frameDescriptor({
		outerCell: 11, mode: 'freeze', drawableSourceFrame: 4, start: exact(4n), end: exact(5n),
	});
	const active = executor.requestFrame(activeFirst);
	assert.strictEqual(executor.requestFrame(activeLatest), active);
	const pendingFirst = frameDescriptor({ outerCell: 2, drawableSourceFrame: 5, start: exact(5n), end: exact(6n) });
	const pendingLatest = frameDescriptor({
		outerCell: 22, mode: 'constant-reverse', drawableSourceFrame: 5, start: exact(5n), end: exact(6n),
	});
	const pending = executor.requestFrame(pendingFirst);
	assert.strictEqual(executor.requestFrame(pendingLatest), pending);
	assert.equal(harness.presentations.length, 1);
	presentation(harness, 0).gate.resolve({ mediaTime: 4.5 });
	await resultOf(active, 'superseded');
	presentation(harness, 1).gate.resolve({ mediaTime: 5.5 });
	await resultOf(pending, 'presented');
	assert.deepEqual(published.map(({ outerCell, mode }) => ({ outerCell, mode })), [
		{ outerCell: 22, mode: 'constant-reverse' },
	]);
	const secondHarness = mediaHarness();
	const secondPublished: VideoRetimeFrameDescriptor[] = [];
	const second = createExecutor(secondHarness.port, {
		onPresented: (value) => { secondPublished.push(value); },
	});
	const a = second.requestFrame(activeFirst);
	const b = second.requestFrame(pendingFirst);
	assert.strictEqual(second.requestFrame(activeLatest), a);
	await resultOf(b, 'superseded');
	presentation(secondHarness, 0).gate.resolve({ mediaTime: 4.5 });
	await resultOf(a, 'presented');
	assert.deepEqual(secondPublished.map(({ outerCell }) => outerCell), [11]);
	assert.equal(secondHarness.presentations.length, 1, 'A/B/A never starts B');
});
test('makes currentness and media failures terminal for active and pending requests', async () => {
	for (const phase of ['before-present', 'after-present', 'media'] as const) {
		const failure = new Error(`${phase} failure`);
		const harness = mediaHarness();
		if (phase === 'before-present') harness.failCurrentAt(1, failure);
		if (phase === 'after-present') harness.failCurrentAt(2, failure);
		const executor = executorFor(harness);
		const active = executor.requestFrame(frameDescriptor({ drawableSourceFrame: 1, start: exact(1n), end: exact(2n) }));
		const pending = phase === 'before-present' ? null : executor.requestFrame(
			frameDescriptor({ drawableSourceFrame: 2, start: exact(2n), end: exact(3n) }),
		);
		if (phase === 'after-present') presentation(harness, 0).gate.resolve({ mediaTime: 1.5 });
		if (phase === 'media') presentation(harness, 0).gate.reject(failure);
		await rejectsWith(active, failure);
		if (pending) await rejectsWith(pending, failure);
		assert.equal(harness.presentations.length, phase === 'before-present' ? 0 : 1);
		assert.equal(harness.published.length, 0);
		await assert.rejects(
			Promise.resolve().then(() => executor.requestFrame(frameDescriptor())),
			(error: unknown) => error === failure || RESULT_ERROR.test(String(error)),
		);
	}
});
test('accepts rounded mediaTime at the inclusive lower edge but rejects invalid evidence', async () => {
	for (const [name, mediaTime] of [
		['end', 0.3], ['below', 0.199], ['NaN', Number.NaN], ['infinity', Number.POSITIVE_INFINITY],
	] as const) {
		const harness = mediaHarness();
		const executor = executorFor(harness);
		const pending = executor.requestFrame(frameDescriptor({ start: exact(1n, 5n), end: exact(3n, 10n) }));
		presentation(harness, 0).gate.resolve({ mediaTime });
		await assert.rejects(pending, /finite|mediaTime|interval|picture|evidence|range/iu, name);
		assert.equal(harness.published.length, 0);
	}
	const accepted = mediaHarness();
	const pending = executorFor(accepted).requestFrame(frameDescriptor({ start: exact(3n, 10n), end: exact(2n, 5n) }));
	presentation(accepted, 0).gate.resolve({ mediaTime: 0.3 });
	await resultOf(pending, 'presented');
});
test('installs presented state before callback re-entry and terminally propagates callback throws', async () => {
	const descriptor = frameDescriptor({ drawableSourceFrame: 8, start: exact(8n), end: exact(9n) });
	const harness = mediaHarness();
	let reentered: Promise<VideoRetimePreviewResult> | null = null;
	let callbacks = 0;
	const executor = createExecutor(harness.port, {
		onPresented: (snapshot) => {
			callbacks += 1;
			reentered = executor.requestFrame(snapshot);
		},
	});
	const active = executor.requestFrame(descriptor);
	presentation(harness, 0).gate.resolve({ mediaTime: 8.5 });
	await resultOf(active, 'presented');
	await resultOf(required<Promise<VideoRetimePreviewResult>>(reentered), 'presented');
	assert.equal(callbacks, 1);
	assert.equal(harness.presentations.length, 1);
	const callbackFailure = new Error('callback failed');
	const throwingHarness = mediaHarness();
	let reenteredDifferent: Promise<VideoRetimePreviewResult> | null = null;
	const throwing = createExecutor(throwingHarness.port, {
		onPresented: () => {
			reenteredDifferent = throwing.requestFrame(frameDescriptor({
				drawableSourceFrame: 9, start: exact(9n), end: exact(10n),
			}));
			throw callbackFailure;
		},
	});
	const throwingActive = throwing.requestFrame(descriptor);
	presentation(throwingHarness, 0).gate.resolve({ mediaTime: 8.5 });
	await rejectsWith(throwingActive, callbackFailure);
	await rejectsWith(required<Promise<VideoRetimePreviewResult>>(reenteredDifferent), callbackFailure);
	assert.equal(throwingHarness.presentations.length, 1);
	await assert.rejects(
		Promise.resolve().then(() => throwing.requestFrame(descriptor)),
		(error: unknown) => error === callbackFailure,
	);
});
test('cancels immediately but drains the issued seek before starting one latest replacement', async () => {
	const harness = mediaHarness();
	const executor = executorFor(harness);
	const aDescriptor = frameDescriptor({ outerCell: 1, drawableSourceFrame: 1, start: exact(1n), end: exact(2n) });
	const a = executor.requestFrame(aDescriptor);
	const b = executor.requestFrame(frameDescriptor({ outerCell: 2, drawableSourceFrame: 2, start: exact(2n), end: exact(3n) }));
	const issuedSignal = presentation(harness, 0).request.signal;
	executor.cancel();
	assert.equal(issuedSignal.aborted, true);
	const duringDrain = executor.requestFrame(frameDescriptor({
		outerCell: 11, mode: 'freeze', drawableSourceFrame: 1, start: exact(1n), end: exact(2n),
	}));
	assert.notStrictEqual(duringDrain, a, 'a cancelled Promise is never reused by a post-cancel request');
	const latest = executor.requestFrame(frameDescriptor({
		outerCell: 4, drawableSourceFrame: 4, start: exact(4n), end: exact(5n),
	}));
	assert.equal(harness.presentations.length, 1, 'requests cannot overlap the draining seek');
	await resultOf(a, 'cancelled');
	await resultOf(b, 'cancelled');
	await resultOf(duringDrain, 'superseded');
	presentation(harness, 0).gate.resolve({ mediaTime: 1.5 });
	await waitFor(() => harness.presentations.length === 2);
	assert.deepEqual(harness.presentations.map(({ request }) => request.drawableSourceFrame), [1, 4]);
	presentation(harness, 1).gate.resolve({ mediaTime: 4.5 });
	await resultOf(latest, 'presented');
	assert.deepEqual(harness.published.map(({ outerCell }) => outerCell), [4]);
});
test('disposal is terminal and fences every late active or pending publication', async () => {
	const harness = mediaHarness();
	const executor = executorFor(harness);
	const active = executor.requestFrame(frameDescriptor({ drawableSourceFrame: 1, start: exact(1n), end: exact(2n) }));
	const pending = executor.requestFrame(frameDescriptor({ drawableSourceFrame: 2, start: exact(2n), end: exact(3n) }));
	const signal = presentation(harness, 0).request.signal;
	executor.dispose();
	assert.equal(signal.aborted, true);
	await resultOf(active, 'cancelled');
	await resultOf(pending, 'cancelled');
	await assert.rejects(
		Promise.resolve().then(() => executor.requestFrame(frameDescriptor())),
		/disposed|terminal|closed/iu,
	);
	presentation(harness, 0).gate.resolve({ mediaTime: 1.5 });
	await waitFor(() => true);
	assert.equal(harness.presentations.length, 1);
	assert.equal(harness.published.length, 0);
});
test('keeps retime execution behind its reviewed exact consumer boundaries', async () => {
	const executorSource = await readFile(EXECUTOR_SOURCE_URL, 'utf8');
	const importStatements = executorSource.match(/^import[\s\S]*?;$/gmu) ?? [];
	for (const statement of importStatements) {
		assert.match(statement, /^import\s+type\b/u, 'executor dependencies must be type-only');
		assert.match(statement, /from ['"]\.\/video-retime-frame-dispatch\.ts['"]/u);
	}
	assert.ok(executorSource.split(/\r\n|\n|\r/u).length - 1 <= 600);
	const outputCadenceConsumers = new Set(['video-retime-exact-ordinal-oracle.ts', 'video-retime-export-domain.ts', 'video-retime-export-plan.ts']);
	const previewExecutorConsumers = new Set(['video-retime-html-video-seek-port.ts', 'video-retime-ordinal-consumers.ts']);
	const rawOracleFactoryConsumers = new Set(['video-retime-exact-ordinal-authority.ts']);
	for (const path of await maintainedSources(new URL('.', EDITOR_SOURCE_ROOT))) {
		const name = path.pathname.split('/').at(-1) ?? ''; const source = await readFile(path, 'utf8');
		if (name !== 'video-retime-output-cadence.ts' && !outputCadenceConsumers.has(name)) {
			assert.doesNotMatch(source, /from\s+['"][^'"]*video-retime-output-cadence(?:\.ts)?['"]|import\s*\(\s*['"][^'"]*video-retime-output-cadence(?:\.ts)?['"]\s*\)/u,
				`${path.pathname} must not bypass the reviewed exact cadence consumers`);
		}
		if (name !== 'video-retime-preview-executor.ts' && !previewExecutorConsumers.has(name)) {
			assert.doesNotMatch(source, /from\s+['"][^'"]*video-retime-preview-executor(?:\.ts)?['"]|import\s*\(\s*['"][^'"]*video-retime-preview-executor(?:\.ts)?['"]\s*\)/u,
				`${path.pathname} must not bypass the reviewed exact preview consumers`);
		}
		if (name !== 'video-retime-exact-ordinal-oracle.ts' && !rawOracleFactoryConsumers.has(name))
			assert.doesNotMatch(source, /\bcreateVideoRetimeExactOrdinalOracle\b/u,
				`${path.pathname} must not bypass the authenticated exact authority`);
	}
});
function executorFor(harness: ReturnType<typeof mediaHarness>) {
	return createExecutor(harness.port, {
		onPresented: (value) => { harness.published.push(value); },
	});
}
function mediaHarness() {
	const events: string[] = [];
	const presentations: Presentation[] = [];
	const published: VideoRetimeFrameDescriptor[] = [];
	let pauses = 0;
	let currentChecks = 0;
	let currentFailure: Readonly<{ call: number; error: Error }> | null = null;
	const port: VideoRetimePreviewMediaPort = {
		pause() { pauses += 1; events.push('pause'); },
		assertCurrent() {
			currentChecks += 1;
			events.push('current');
			if (currentFailure?.call === currentChecks) throw currentFailure.error;
		},
		present(request) {
			events.push(`present:${String(request.drawableSourceFrame)}`);
			const gate = deferred<MediaResult>();
			presentations.push(Object.freeze({ request, gate }));
			return gate.promise;
		},
	};
	return {
		events, port, presentations, published,
		pauseCalls: () => pauses,
		failCurrentAt(call: number, error: Error) { currentFailure = Object.freeze({ call, error }); },
	};
}
function frameDescriptor(options: Readonly<{
	readonly outerCell?: number;
	readonly segmentIndex?: number;
	readonly mode?: RetimeMode;
	readonly drawableSourceFrame?: number;
	readonly start?: MutableExact;
	readonly end?: MutableExact;
}> = {}): VideoRetimeFrameDescriptor {
	return asDescriptor(frameDescriptorRecord(options));
}
interface MutableExact { numerator: bigint; denominator: bigint }
interface MutableDescriptorRecord {
	outerCell: number;
	segmentIndex: number;
	mode: RetimeMode;
	sourceFrame: MutableExact;
	sourceTime: MutableExact;
	drawableSourceFrame: number;
	drawableSourceStartTime: MutableExact;
	drawableSourceEndTime: MutableExact;
}
function frameDescriptorRecord(options: Readonly<{
	readonly outerCell?: number;
	readonly segmentIndex?: number;
	readonly mode?: RetimeMode;
	readonly drawableSourceFrame?: number;
	readonly start?: MutableExact;
	readonly end?: MutableExact;
}> = {}): MutableDescriptorRecord {
	const frame = options.drawableSourceFrame ?? 0;
	const start = options.start ?? exact(BigInt(frame));
	const end = options.end ?? exact(BigInt(frame + 1));
	return {
		outerCell: options.outerCell ?? 0,
		segmentIndex: options.segmentIndex ?? 0,
		mode: options.mode ?? 'constant-forward',
		sourceFrame: exact(BigInt(frame)),
		sourceTime: exact(start.numerator, start.denominator),
		drawableSourceFrame: frame,
		drawableSourceStartTime: exact(start.numerator, start.denominator),
		drawableSourceEndTime: exact(end.numerator, end.denominator),
	};
}
function exact(numerator: bigint, denominator = 1n): MutableExact {
	return { numerator, denominator };
}
function asDescriptor(value: unknown): VideoRetimeFrameDescriptor {
	return value as VideoRetimeFrameDescriptor;
}
function descriptorFields(): readonly (keyof MutableDescriptorRecord)[] {
	return [
		'outerCell', 'segmentIndex', 'mode', 'sourceFrame', 'sourceTime',
		'drawableSourceFrame', 'drawableSourceStartTime', 'drawableSourceEndTime',
	];
}
function trackedDescriptor(target: MutableDescriptorRecord) {
	let ownKeyReads = 0;
	let propertyReads = 0;
	const proxy = new Proxy(target, {
		ownKeys(value) { ownKeyReads += 1; return Reflect.ownKeys(value); },
		get(value, property, receiver) { propertyReads += 1; return Reflect.get(value, property, receiver); },
	});
	return {
		proxy: asDescriptor(proxy), target,
		ownKeyReads: () => ownKeyReads,
		propertyReads: () => propertyReads,
	};
}
function presentation(harness: ReturnType<typeof mediaHarness>, index: number): Presentation {
	return required(harness.presentations[index]);
}
async function resultOf(
	promise: Promise<VideoRetimePreviewResult>,
	kind: VideoRetimePreviewResult['kind'],
): Promise<VideoRetimePreviewResult> {
	const result = await promise;
	assert.deepEqual(result, { kind });
	assert.deepEqual(Reflect.ownKeys(result), ['kind']);
	assert.equal(Object.isFrozen(result), true);
	return result;
}
async function rejectsWith(promise: PromiseLike<unknown>, expected: unknown): Promise<void> {
	await assert.rejects(Promise.resolve(promise), (error: unknown) => error === expected);
}
function deferred<Value>(): Deferred<Value> {
	let resolve: Deferred<Value>['resolve'] = () => undefined;
	let reject: Deferred<Value>['reject'] = () => undefined;
	const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
	return Object.freeze({ promise, reject, resolve });
}
async function waitFor(predicate: () => boolean): Promise<void> {
	for (let turn = 0; turn < 20 && !predicate(); turn += 1) await Promise.resolve();
	assert.equal(predicate(), true, 'expected asynchronous state did not settle');
}
function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor && Object.hasOwn(descriptor, 'value')) assertDeepFrozen(descriptor.value, seen);
	}
}
function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	left = left < 0n ? -left : left;
	right = right < 0n ? -right : right;
	while (right !== 0n) [left, right] = [right, left % right];
	return left || 1n;
}
function bitLength(value: bigint): number {
	return (value < 0n ? -value : value).toString(2).length;
}
async function maintainedSources(root: URL): Promise<URL[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const nested = await Promise.all(entries.map(async (entry): Promise<URL[]> => {
		const path = new URL(entry.name, root);
		if (entry.isDirectory()) return maintainedSources(new URL(`${entry.name}/`, root));
		return entry.isFile() && ['.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
	}));
	return nested.flat();
}
function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new Error('Expected a test fixture value.');
	return value;
}
