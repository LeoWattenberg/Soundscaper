/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PLATFORM_TRANSFER_HARD_LIMITS, createBoundedAudioChunk, createBoundedPortMessage,
	type AbortablePortOperation, type BoundedAudioChunk, type BoundedPortMessage,
} from '../src/common/editor/platform/bounded-transfer.ts';
import {
	createNativeAudioSession,
	type NativeAudioActivity, type NativeAudioCapturedPrefix, type NativeAudioDirection,
	type NativeAudioExclusivePolicy, type NativeAudioInputStreamPort, type NativeAudioInventoryReport,
	type NativeAudioLossDisposition, type NativeAudioOpenPortRequest, type NativeAudioOpenRequest,
	type NativeAudioOutputLossPolicy, type NativeAudioOutputStreamPort, type NativeAudioSession,
	type NativeAudioSessionStatus, type NativeAudioStreamGrant,
} from '../src/common/editor/controller/native-audio-session.ts';
import { createNativeAudioCalibrationStore } from '../src/common/editor/controller/native-audio-calibration.ts';

type FakePort = NativeAudioInputStreamPort & NativeAudioOutputStreamPort;
type GrantOverrides = Readonly<Partial<Record<NativeAudioDirection, Partial<NativeAudioStreamGrant>>>>;

const INPUT_ID = 'native:alsa:in:hw:0,0';
const OUTPUT_ID = 'native:alsa:out:hw:0,0';
const INVENTORY: NativeAudioInventoryReport = Object.freeze({
	backend: 'alsa',
	status: 'available',
	detail: '',
	devices: Object.freeze([
		Object.freeze({ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' as const, channelCount: 4, isDefault: true }),
		Object.freeze({ handle: 'usb:2', label: 'Interface', direction: 'input' as const, channelCount: 3 }),
	]),
});
const OPEN: NativeAudioOpenRequest = Object.freeze({
	backend: 'alsa', mode: 'shared', sampleRate: 48_000, bufferFrames: 512, channelCount: 2,
	inputDeviceId: INPUT_ID, outputDeviceId: OUTPUT_ID,
});

interface HarnessOptions {
	readonly inventory?: unknown;
	readonly enumerateHook?: (request: AbortablePortOperation) => Promise<BoundedPortMessage<NativeAudioInventoryReport>>;
	readonly openHook?: (direction: NativeAudioDirection, port: FakePort) => Promise<FakePort>;
	readonly readHook?: (request: AbortablePortOperation) => Promise<BoundedAudioChunk | null>;
	readonly writeHook?: () => Promise<void>;
	readonly grants?: GrantOverrides;
	readonly exclusivePolicy?: NativeAudioExclusivePolicy;
	readonly outputLossPolicy?: NativeAudioOutputLossPolicy;
	/** A device that has already vanished throws rather than closing politely. */
	readonly closeThrows?: boolean;
	/** A grant that answers truthfully while it is admitted and lies afterwards. */
	readonly poisonGrantAfterAdmission?: boolean;
}

interface Harness {
	readonly session: NativeAudioSession;
	readonly opens: Record<NativeAudioDirection, number>;
	readonly closes: Record<NativeAudioDirection, number>;
	readonly statuses: NativeAudioSessionStatus[];
	readonly commits: NativeAudioCapturedPrefix[];
	readonly policies: NativeAudioExclusivePolicy[];
}

function chunk(frames = 128): BoundedAudioChunk {
	return createBoundedAudioChunk([new Float32Array(frames), new Float32Array(frames)],
		{ sequence: 0, maximumFrameCount: PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames });
}

function tick(): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function grantOf(options: HarnessOptions, direction: NativeAudioDirection, request: NativeAudioOpenPortRequest): NativeAudioStreamGrant {
	const base = {
		backend: request.backend, requestedMode: request.mode, grantedMode: request.mode,
		sampleRate: request.format.sampleRate, bufferFrames: request.bufferFrames,
		channelCount: request.format.channelCount, latencyFrames: 64, ...options.grants?.[direction],
	};
	if (!options.poisonGrantAfterAdmission) return Object.freeze(base);
	let reads = 0;
	return Object.freeze({
		...base,
		get channelCount(): number {
			reads += 1;
			return reads > 1 ? 999_999 : base.channelCount;
		},
	});
}

function createHarness(options: HarnessOptions = {}): Harness {
	const opens: Record<NativeAudioDirection, number> = { input: 0, output: 0 };
	const closes: Record<NativeAudioDirection, number> = { input: 0, output: 0 };
	const statuses: NativeAudioSessionStatus[] = [];
	const commits: NativeAudioCapturedPrefix[] = [];
	const policies: NativeAudioExclusivePolicy[] = [];
	const openPort = (direction: NativeAudioDirection, request: NativeAudioOpenPortRequest): Promise<FakePort> => {
		opens[direction] += 1;
		const port: FakePort = Object.freeze({
			device: Object.freeze({
				id: request.deviceId, kind: direction === 'input' ? 'audio-input' as const : 'audio-output' as const,
				label: 'Built-in', isDefault: true,
			}),
			format: request.format,
			maximumChunkFrames: request.maximumChunkFrames,
			grant: grantOf(options, direction, request),
			read: options.readHook ?? ((): Promise<BoundedAudioChunk | null> => Promise.resolve(chunk())),
			write: options.writeHook ?? ((): Promise<void> => Promise.resolve()),
			close: (): Promise<void> => {
				closes[direction] += 1;
				if (options.closeThrows) throw new Error('the device is gone');
				return Promise.resolve();
			},
		});
		return options.openHook ? options.openHook(direction, port) : Promise.resolve(port);
	};
	const session = createNativeAudioSession({
		host: {
			enumerate: options.enumerateHook ?? ((): Promise<BoundedPortMessage<NativeAudioInventoryReport>> => Promise.resolve(
				createBoundedPortMessage('native-audio-inventory', (options.inventory ?? INVENTORY) as NativeAudioInventoryReport,
					{ sequence: 0, maximumEncodedBytes: PLATFORM_TRANSFER_HARD_LIMITS.messageBytes }),
			)),
			openInput: (request) => openPort('input', request),
			openOutput: (request) => openPort('output', request),
		},
		exclusivePolicy: options.exclusivePolicy,
		outputLossPolicy: options.outputLossPolicy,
		onStatus: (status) => statuses.push(status),
		onExclusivePolicy: (policy) => policies.push(policy),
		commitCapturedPrefix: (commit) => commits.push(commit),
	});
	return { session, opens, closes, statuses, commits, policies };
}

function failure(outcome: Readonly<{ status: string }>): Readonly<{ code: string; message: string }> {
	assert.equal(outcome.status, 'failed', `expected a failure, received ${outcome.status}`);
	return outcome as unknown as Readonly<{ code: string; message: string }>;
}

async function openHarness(options: HarnessOptions = {}, request: NativeAudioOpenRequest = OPEN): Promise<Harness> {
	const harness = createHarness(options);
	assert.equal((await harness.session.open(request)).status, 'opened');
	return harness;
}

test('enumerate answers with adapted rows and reports a backend that has none', async () => {
	const described = await createHarness().session.enumerate();
	assert.equal(described.status, 'described');
	if (described.status !== 'described') throw new Error('unreachable');
	assert.equal(described.inventory.backend, 'alsa');
	assert.equal(described.inventory.inputs.length, 2);
	const absent = await createHarness({
		inventory: { backend: 'jack', status: 'server-absent', detail: 'No JACK server is running.', devices: [] },
	}).session.enumerate();
	assert.equal(absent.status, 'described');
	if (absent.status !== 'described') throw new Error('unreachable');
	assert.deepEqual([absent.inventory.status, absent.inventory.detail, absent.inventory.inputs.length],
		['server-absent', 'No JACK server is running.', 0]);
});

test('enumerate turns a host fault or a malformed answer into a typed failure', async () => {
	const rejected = createHarness({ enumerateHook: () => Promise.reject(new Error('helper exited')) });
	assert.deepEqual(failure(await rejected.session.enumerate()), { status: 'failed', code: 'host-failed', message: 'helper exited' });
	const malformed = createHarness({ inventory: { backend: '', status: 'available', detail: '', devices: [] } });
	assert.equal(failure(await malformed.session.enumerate()).code, 'contract-violation');
});

test('an abort during enumerate settles once with a typed reason', async () => {
	const harness = createHarness({ enumerateHook: () => new Promise(() => undefined) });
	const controller = new AbortController();
	const enumerating = harness.session.enumerate({ signal: controller.signal });
	await tick();
	controller.abort();
	assert.equal(failure(await enumerating).code, 'aborted');
	assert.equal(failure(await harness.session.enumerate({ signal: controller.signal })).code, 'aborted',
		'an already-aborted request never reaches the host');
});

test('a granted mode is reported as granted and the request is remembered beside it', async () => {
	const harness = await openHarness();
	const status = harness.session.status();
	assert.equal(status.state, 'open');
	assert.equal(status.negotiation, 'granted');
	assert.equal(status.requestedMode, 'shared');
	assert.equal(status.grantedMode, 'shared');
	assert.equal(status.transport, 'native');
	assert.equal(status.sampleRate, 48_000);
	assert.equal(status.bufferFrames, 512);
	assert.equal(status.latencyFrames, 128, 'both endpoints report their own latency');
	assert.deepEqual(status.input, { deviceId: INPUT_ID, channelCount: 2, live: true, lost: false });
	assert.deepEqual(status.output, { deviceId: OUTPUT_ID, channelCount: 2, live: true, lost: false });
	assert.deepEqual(Object.keys(status).sort(), [
		'activity', 'backend', 'bufferFrames', 'capturedFrames', 'exclusivePolicy', 'fallback', 'grantedMode', 'input',
		'lastLoss', 'latencyFrames', 'negotiation', 'output', 'requestedMode', 'sampleRate', 'state', 'transport',
	], 'the published status is exactly its declared surface');
	assert.equal(failure(await harness.session.open(OPEN)).code, 'already-open');
});

test('a denied exclusive mode surfaces a choice and never opens as the mode that was asked for', async () => {
	const harness = createHarness({ grants: { input: { grantedMode: 'shared' }, output: { grantedMode: 'shared' } } });
	const outcome = await harness.session.open({ ...OPEN, mode: 'exclusive' });
	assert.equal(outcome.status, 'choice-required');
	if (outcome.status !== 'choice-required') throw new Error('unreachable');
	assert.deepEqual(outcome.choice, { backend: 'alsa', requestedMode: 'exclusive', grantedMode: 'shared' });
	const parked = harness.session.status();
	assert.equal(parked.state, 'opening', 'nothing may run before the user answers');
	assert.equal(parked.negotiation, 'awaiting-choice');
	assert.equal(parked.requestedMode, 'exclusive');
	assert.equal(parked.grantedMode, 'shared');
	assert.equal(harness.session.beginActivity('playing').status, 'failed');
	const accepted = harness.session.resolveModeChoice({ accept: true, remember: true });
	assert.equal(accepted.status, 'opened');
	assert.deepEqual(harness.policies, ['accept-shared']);
	const open = harness.session.status();
	assert.deepEqual([open.state, open.negotiation, open.requestedMode, open.grantedMode],
		['open', 'downgraded', 'exclusive', 'shared']);
	// Not one published status ever claimed the mode that was refused.
	assert.equal(harness.statuses.some((status) => status.grantedMode === 'exclusive'), false);
	assert.equal(harness.statuses.every((status) => status.requestedMode !== 'shared'), true);
});

test('a recorded policy answers the denial without asking again', async () => {
	const shared: GrantOverrides = { input: { grantedMode: 'shared' }, output: { grantedMode: 'shared' } };
	const accepting = createHarness({ grants: shared, exclusivePolicy: 'accept-shared' });
	const opened = await accepting.session.open({ ...OPEN, mode: 'exclusive' });
	assert.equal(opened.status, 'opened');
	assert.deepEqual([accepting.session.status().negotiation, accepting.session.status().grantedMode], ['downgraded', 'shared']);
	const refusing = createHarness({ grants: shared, exclusivePolicy: 'refuse' });
	assert.equal(failure(await refusing.session.open({ ...OPEN, mode: 'exclusive' })).code, 'mode-denied');
	assert.deepEqual(refusing.closes, { input: 1, output: 1 }, 'a refused session leaves no device open');
	assert.equal(refusing.session.status().state, 'closed');
	assert.equal(refusing.session.status().grantedMode, null);
});

test('declining the choice closes the streams and may record the refusal', async () => {
	const harness = createHarness({ grants: { input: { grantedMode: 'shared' }, output: { grantedMode: 'shared' } } });
	assert.equal((await harness.session.open({ ...OPEN, mode: 'exclusive' })).status, 'choice-required');
	assert.equal(failure(harness.session.resolveModeChoice({ accept: false, remember: true })).code, 'mode-denied');
	assert.deepEqual(harness.policies, ['refuse']);
	assert.deepEqual(harness.closes, { input: 1, output: 1 });
	assert.equal(failure(harness.session.resolveModeChoice({ accept: true })).code, 'invalid-request');
});

test('a mixed grant is a shared session, and a rewritten request is a contract violation', async () => {
	const mixed = createHarness({ grants: { input: { grantedMode: 'exclusive' }, output: { grantedMode: 'shared' } }, exclusivePolicy: 'accept-shared' });
	assert.equal((await mixed.session.open({ ...OPEN, mode: 'exclusive' })).status, 'opened');
	assert.equal(mixed.session.status().grantedMode, 'shared', 'the weaker endpoint governs what the user hears');
	for (const rewritten of [
		{ input: { requestedMode: 'shared' as const } },
		{ input: { backend: 'jack' } },
		{ input: { grantedMode: 'hog' as unknown as 'shared' } },
		{ output: { sampleRate: 44_100 } },
		{ output: { bufferFrames: 256 } },
	]) {
		const harness = createHarness({ grants: rewritten });
		assert.equal(failure(await harness.session.open({ ...OPEN, mode: 'exclusive' })).code, 'contract-violation');
		assert.equal(harness.session.status().state, 'closed');
		assert.ok(harness.opens.input > 0, 'the refusal happened after a device was actually opened');
		assert.deepEqual(harness.closes, harness.opens, 'every device a refused grant opened is closed exactly once');
	}
});

test('an open request is bounded before any device is touched', async () => {
	const harness = createHarness();
	for (const malformed of [
		null, { ...OPEN, backend: '' }, { ...OPEN, mode: 'hog' }, { ...OPEN, inputDeviceId: '', outputDeviceId: '' },
		{ ...OPEN, sampleRate: 7_999 }, { ...OPEN, bufferFrames: 0 }, { ...OPEN, channelCount: 0 },
		{ ...OPEN, channelCount: PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels + 1 },
		{ ...OPEN, inputDeviceId: 'x'.repeat(513) },
	]) {
		assert.equal(failure(await harness.session.open(malformed as NativeAudioOpenRequest)).code, 'invalid-request');
	}
	assert.deepEqual(harness.closes, { input: 0, output: 0 });
});

test('an abort during open settles once and closes the device that arrives too late', async () => {
	let release: () => void = () => undefined;
	const harness = createHarness({ openHook: (_direction, port) => new Promise((resolve) => { release = () => { resolve(port); }; }) });
	const controller = new AbortController();
	const opening = harness.session.open({ ...OPEN, signal: controller.signal });
	await tick();
	controller.abort();
	assert.equal(failure(await opening).code, 'aborted');
	release();
	await tick();
	assert.equal(harness.closes.input, 1, 'a late device is closed, not kept');
	assert.equal(harness.session.status().state, 'closed');
});

test('reads and writes carry frames, end and abort with typed outcomes', async () => {
	const harness = await openHarness();
	const read = await harness.session.readInput();
	assert.equal(read.status, 'read');
	assert.equal(harness.session.status().capturedFrames, 128);
	assert.equal((await harness.session.writeOutput({ chunk: chunk() })).status, 'written');
	assert.equal(failure(await harness.session.writeOutput({ chunk: null as unknown as BoundedAudioChunk })).code, 'invalid-request');
	const ended = await openHarness({ readHook: () => Promise.resolve(null) });
	assert.equal((await ended.session.readInput()).status, 'ended');
	assert.equal(ended.session.status().capturedFrames, 0);
	const failing = await openHarness({ writeHook: () => Promise.reject(new Error('device stalled')) });
	assert.deepEqual(failure(await failing.session.writeOutput({ chunk: chunk() })),
		{ status: 'failed', code: 'host-failed', message: 'device stalled' });
});

test('an abort during read or write settles once and never counts the discarded work', async () => {
	const reading = await openHarness({ readHook: () => new Promise(() => undefined) });
	const readController = new AbortController();
	const pendingRead = reading.session.readInput({ signal: readController.signal });
	await tick();
	readController.abort();
	assert.equal(failure(await pendingRead).code, 'aborted');
	assert.equal(reading.session.status().capturedFrames, 0, 'an aborted read contributes no frames');
	const writing = await openHarness({ writeHook: () => new Promise(() => undefined) });
	const writeController = new AbortController();
	const pendingWrite = writing.session.writeOutput({ chunk: chunk(), signal: writeController.signal });
	await tick();
	writeController.abort();
	assert.equal(failure(await pendingWrite).code, 'aborted');
});

test('closing twice is a no-op and each device is closed exactly once', async () => {
	const harness = await openHarness();
	const first = harness.session.close();
	assert.equal(harness.session.close(), first, 'a second close is the same settlement');
	await first;
	await harness.session.close();
	assert.deepEqual(harness.closes, { input: 1, output: 1 });
	assert.equal(harness.session.status().state, 'closed');
	assert.equal(failure(await harness.session.readInput()).code, 'not-open');
	assert.equal(failure(await harness.session.open(OPEN)).code, 'closed');
});

test('a close during an open settles both exactly once', async () => {
	const harness = createHarness({ openHook: () => new Promise(() => undefined) });
	const opening = harness.session.open(OPEN);
	await tick();
	const closing = harness.session.close();
	assert.equal(harness.session.close(), closing);
	assert.equal(failure(await opening).code, 'closed');
	await closing;
	assert.equal(harness.session.status().state, 'closed');
});

test('a read in flight when the session closes settles as closed', async () => {
	const harness = await openHarness({ readHook: () => new Promise(() => undefined) });
	const reading = harness.session.readInput();
	await tick();
	const closing = harness.session.close();
	assert.equal(failure(await reading).code, 'closed');
	await closing;
	assert.deepEqual(harness.closes, { input: 1, output: 1 });
});

interface LossCase {
	readonly direction: NativeAudioDirection;
	readonly activity: NativeAudioActivity;
	readonly disposition: NativeAudioLossDisposition;
	readonly after: NativeAudioActivity;
	readonly committed: number;
	readonly commits: number;
}

const LOSS_MATRIX: readonly LossCase[] = Object.freeze([
	{ direction: 'input', activity: 'idle', disposition: 'stream-closed', after: 'idle', committed: 0, commits: 0 },
	{ direction: 'input', activity: 'recording', disposition: 'prefix-committed', after: 'idle', committed: 256, commits: 1 },
	{ direction: 'input', activity: 'monitoring', disposition: 'monitoring-stopped', after: 'idle', committed: 0, commits: 0 },
	{ direction: 'input', activity: 'playing', disposition: 'stream-closed', after: 'playing', committed: 0, commits: 0 },
	{ direction: 'output', activity: 'idle', disposition: 'stream-closed', after: 'idle', committed: 0, commits: 0 },
	{ direction: 'output', activity: 'recording', disposition: 'stream-closed', after: 'recording', committed: 0, commits: 0 },
	{ direction: 'output', activity: 'monitoring', disposition: 'monitoring-stopped', after: 'idle', committed: 0, commits: 0 },
	{ direction: 'output', activity: 'playing', disposition: 'playback-stopped', after: 'idle', committed: 0, commits: 0 },
]);

for (const entry of LOSS_MATRIX) {
	test(`losing the ${entry.direction} while ${entry.activity} ${entry.disposition}`, async () => {
		const harness = await openHarness();
		if (entry.activity !== 'idle') assert.equal(harness.session.beginActivity(entry.activity).status, 'started');
		await harness.session.readInput();
		await harness.session.readInput();
		const survivor: NativeAudioDirection = entry.direction === 'input' ? 'output' : 'input';
		const outcome = harness.session.reportDeviceLoss({ direction: entry.direction });
		assert.deepEqual(outcome, {
			direction: entry.direction, activity: entry.activity, disposition: entry.disposition,
			committedFrames: entry.committed, fallback: null,
		});
		const status = harness.session.status();
		assert.equal(status.activity, entry.after);
		assert.deepEqual(status.lastLoss, outcome);
		assert.equal(status[entry.direction].lost, true);
		assert.equal(status[entry.direction].live, false);
		assert.equal(status[survivor].live, true, 'the other endpoint is untouched');
		assert.equal(status.state, 'open');
		assert.equal(harness.closes[entry.direction], 1);
		assert.equal(harness.closes[survivor], 0);
		assert.equal(harness.commits.length, entry.commits, 'only a lost recording input publishes anything');
		// The lost direction is refused; the survivor still works.
		assert.equal(failure(entry.direction === 'input'
			? await harness.session.readInput()
			: await harness.session.writeOutput({ chunk: chunk() })).code, 'device-lost');
		assert.equal(entry.direction === 'input'
			? (await harness.session.writeOutput({ chunk: chunk() })).status
			: (await harness.session.readInput()).status, entry.direction === 'input' ? 'written' : 'read');
		assert.equal(harness.session.reportDeviceLoss({ direction: entry.direction }).disposition, 'ignored');
	});
}

test('a lost recording input commits exactly the prefix it read and fabricates nothing', async () => {
	const harness = await openHarness();
	harness.session.beginActivity('recording');
	for (let index = 0; index < 3; index += 1) await harness.session.readInput();
	assert.equal(harness.session.status().capturedFrames, 384);
	const outcome = harness.session.reportDeviceLoss({ direction: 'input' });
	assert.equal(outcome.committedFrames, 384);
	assert.deepEqual(harness.commits, [{
		deviceId: INPUT_ID, frames: 384, channelCount: 2, sampleRate: 48_000, reason: 'device-lost',
	}]);
	assert.equal(failure(await harness.session.readInput()).code, 'device-lost');
	assert.equal(harness.session.status().capturedFrames, 384, 'no frame appears that the device never produced');
});

test('losing both endpoints closes the session without a project commit', async () => {
	const harness = await openHarness();
	harness.session.reportDeviceLoss({ direction: 'input' });
	assert.equal(harness.session.status().state, 'open');
	harness.session.reportDeviceLoss({ direction: 'output' });
	assert.equal(harness.session.status().state, 'closed');
	assert.equal(harness.commits.length, 0);
	assert.throws(() => harness.session.reportDeviceLoss({ direction: 'both' as NativeAudioDirection }), /input or an output/u);
	await harness.session.close();
	assert.deepEqual(harness.closes, { input: 1, output: 1 });
});

test('output loss during playback falls back only when a policy says so, and says so out loud', async () => {
	const stopped = await openHarness({ outputLossPolicy: 'stop' });
	stopped.session.beginActivity('playing');
	assert.equal(stopped.session.reportDeviceLoss({ direction: 'output' }).fallback, null);
	assert.equal(stopped.session.status().transport, 'native');
	const falling = await openHarness({ outputLossPolicy: 'web-core' });
	falling.session.beginActivity('playing');
	const published = falling.statuses.length;
	const outcome = falling.session.reportDeviceLoss({ direction: 'output' });
	assert.deepEqual(outcome.fallback, {
		from: 'native', to: 'web-core', reason: 'output-lost', backend: 'alsa', requestedMode: 'shared', grantedMode: 'shared',
	});
	const status = falling.session.status();
	assert.equal(status.transport, 'web-core');
	assert.deepEqual(status.fallback, outcome.fallback);
	assert.ok(falling.statuses.length > published, 'a fallback is a published status change, never a silent one');
});

test('an explicit Web Core fallback keeps a live recording and names its reason', async () => {
	const harness = await openHarness();
	harness.session.beginActivity('recording');
	const status = harness.session.fallBackToWebCore('helper-unavailable');
	assert.equal(status.transport, 'web-core');
	assert.equal(status.fallback?.reason, 'helper-unavailable');
	assert.equal(status.activity, 'recording', 'a recording input survives an output-side fallback');
	assert.equal(status.output.live, false);
	assert.equal(harness.closes.output, 1);
	assert.throws(() => harness.session.fallBackToWebCore('because' as 'user-request'), /must name why/u);
});

test('activities require the endpoints they use', async () => {
	const inputOnly = await openHarness({}, { ...OPEN, outputDeviceId: '' });
	assert.equal(inputOnly.session.status().latencyFrames, 64);
	assert.equal(inputOnly.session.beginActivity('recording').status, 'started');
	assert.equal(failure(inputOnly.session.beginActivity('playing')).code, 'not-open');
	assert.equal(failure(inputOnly.session.beginActivity('monitoring')).code, 'not-open');
	assert.equal(failure(inputOnly.session.beginActivity('idle')).code, 'invalid-request');
	assert.equal(inputOnly.session.endActivity().activity, 'idle');
	assert.equal(inputOnly.session.endActivity().activity, 'idle');
	const outputOnly = await openHarness({}, { ...OPEN, inputDeviceId: '' });
	assert.equal(outputOnly.session.beginActivity('playing').status, 'started');
	assert.equal(failure(outputOnly.session.beginActivity('recording')).code, 'not-open');
	assert.equal(failure(await outputOnly.session.readInput()).code, 'not-open');
	await outputOnly.session.close();
	assert.equal(failure(outputOnly.session.beginActivity('playing')).code, 'not-open');
});

test('the calibration identity names the granted tuple and goes stale when it moves', async () => {
	const harness = await openHarness();
	const identity = harness.session.calibrationIdentity();
	assert.deepEqual(identity, {
		inputDeviceId: INPUT_ID, outputDeviceId: OUTPUT_ID, backend: 'alsa',
		mode: 'shared', sampleRate: 48_000, bufferFrames: 512,
	});
	const store = createNativeAudioCalibrationStore();
	store.record(identity, 8);
	assert.equal(store.resolve(identity).offsetMilliseconds, 8);
	await harness.session.close();
	assert.equal(harness.session.calibrationIdentity(), null);
	const resized = await openHarness({ grants: { input: { bufferFrames: 256 }, output: { bufferFrames: 256 } } },
		{ ...OPEN, bufferFrames: 256 });
	const moved = store.resolve(resized.session.calibrationIdentity());
	assert.equal(moved.status, 'stale');
	assert.equal(moved.offsetMilliseconds, 0, 'a calibration measured at another buffer size is never applied');
});

test('a device that throws on close still commits its prefix and still settles the close', async () => {
	// A device that has already been unplugged is exactly the one whose close
	// fails, so teardown must not depend on it succeeding.
	const harness = await openHarness({ closeThrows: true });
	harness.session.beginActivity('recording');
	await harness.session.readInput();
	const outcome = harness.session.reportDeviceLoss({ direction: 'input' });
	assert.deepEqual([outcome.disposition, outcome.committedFrames], ['prefix-committed', 128]);
	assert.deepEqual(harness.commits.map((commit) => commit.frames), [128]);
	assert.deepEqual([harness.session.status().activity, harness.session.status().lastLoss], ['idle', outcome]);
	await harness.session.close();
	await harness.session.close();
	assert.equal(harness.session.status().state, 'closed', 'a port that cannot be closed must not wedge the session');
	assert.deepEqual(harness.closes, harness.opens);
});

test('a device identifier that reads as a path never reaches renderer state', async () => {
	const harness = createHarness();
	for (const path of ['/dev/snd/pcmC0D0c', 'C:\\Windows\\device', '\\\\?\\pipe\\audio', 'hw\\0']) {
		assert.equal(failure(await harness.session.open({ ...OPEN, inputDeviceId: path })).code, 'invalid-request');
		assert.equal(failure(await harness.session.open({ ...OPEN, outputDeviceId: path })).code, 'invalid-request');
	}
	assert.deepEqual(harness.opens, { input: 0, output: 0 }, 'no device is touched for a request that names a path');
	assert.deepEqual(harness.statuses, [], 'a path is refused before any status is published');
	assert.equal(harness.session.calibrationIdentity(), null);
});

test('a fresh open publishes this session, not the wreckage of the last one', async () => {
	const harness = await openHarness({ outputLossPolicy: 'web-core' });
	harness.session.beginActivity('playing');
	harness.session.reportDeviceLoss({ direction: 'output' });
	harness.session.reportDeviceLoss({ direction: 'input' });
	assert.equal(harness.session.status().transport, 'web-core');
	assert.equal(harness.session.status().state, 'closed');
	assert.equal((await harness.session.open(OPEN)).status, 'opened');
	const status = harness.session.status();
	assert.deepEqual([status.transport, status.fallback, status.lastLoss], ['native', null, null],
		'a native session must never be published as the fallback that preceded it');
	assert.deepEqual([status.input.lost, status.output.lost], [false, false]);
});

test('a device lost while a mode choice is pending cannot be answered into an open session', async () => {
	const harness = createHarness({ grants: { input: { grantedMode: 'shared' }, output: { grantedMode: 'shared' } } });
	assert.equal((await harness.session.open({ ...OPEN, mode: 'exclusive' })).status, 'choice-required');
	for (const direction of ['input', 'output'] as const) harness.session.reportDeviceLoss({ direction });
	assert.equal(failure(harness.session.resolveModeChoice({ accept: true, remember: true })).code, 'device-lost');
	assert.deepEqual(harness.policies, [], 'a negotiation whose hardware is gone records no policy');
	assert.deepEqual([harness.session.status().state, harness.session.status().negotiation], ['closed', null]);
	assert.equal(harness.session.calibrationIdentity(), null, 'a dead session has no tuple to calibrate');
});

test('the session republishes the grant it admitted, never the record the host kept', async () => {
	const harness = await openHarness({ poisonGrantAfterAdmission: true });
	assert.equal(harness.session.status().input.channelCount, 2, 'the admitted width is what the session reports');
	harness.session.beginActivity('recording');
	await harness.session.readInput();
	harness.session.reportDeviceLoss({ direction: 'input' });
	assert.deepEqual(harness.commits.map((commit) => commit.channelCount), [2],
		'a width the session never admitted must not reach the project');
});

test('a session refuses to run without a host port, and a throwing listener cannot break teardown', async () => {
	assert.throws(() => createNativeAudioSession({ host: undefined as unknown as never }), /host port/u);
	assert.throws(() => createNativeAudioSession({ host: { enumerate: () => Promise.reject(new Error('x')) } as unknown as never }), /host port/u);
	const session = createNativeAudioSession({
		host: {
			enumerate: () => Promise.reject(new Error('the helper is gone')),
			openInput: () => Promise.reject(new Error('the helper is gone')),
			openOutput: () => Promise.reject(new Error('the helper is gone')),
		},
		onStatus: () => { throw new Error('a listener exploded'); },
	});
	assert.equal(failure(await session.open({ ...OPEN, backend: '' })).code, 'invalid-request');
	assert.equal(failure(await session.open(OPEN)).code, 'host-failed');
	await session.close();
	assert.equal(session.status().state, 'closed');
});
