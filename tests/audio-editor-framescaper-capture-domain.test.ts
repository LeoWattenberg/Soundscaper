/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createCaptureRuntimeAvailability,
	normalizeCaptureSelectedSources,
	type CaptureEncodedVideoPacket,
	type CapturePcmAudioPacket,
	type CaptureStreamMetrics,
} from '../src/common/editor/framescaper-capture-domain.ts';
import {
	createFramescaperCaptureStateMachine,
} from '../src/common/editor/controller/framescaper-capture-state-machine.ts';
import {
	createFramescaperCaptureActiveTimeClock,
} from '../src/common/editor/controller/framescaper-capture-active-time-clock.ts';
import {
	createIdempotentCaptureLease,
} from '../src/common/editor/controller/framescaper-capture-lease.ts';

const AVAILABLE = createCaptureRuntimeAvailability({
	status: 'available',
	sourceRoles: ['camera', 'microphone', 'display', 'system-audio'],
});

test('capture domain closes runtime availability and selected source roles', () => {
	assert.deepEqual(AVAILABLE, {
		status: 'available',
		sourceRoles: ['camera', 'microphone', 'display', 'system-audio'],
	});
	assert.equal(Object.isFrozen(AVAILABLE), true);
	assert.equal(Object.isFrozen(AVAILABLE.sourceRoles), true);
	assert.throws(
		() => createCaptureRuntimeAvailability({
			status: 'available', sourceRoles: ['camera', 'camera'],
		}),
		/Duplicate capture source role camera/u,
	);
	assert.throws(
		() => createCaptureRuntimeAvailability({
			status: 'unavailable', reason: 'unsupported-platform', detail: null, extra: true,
		}),
		/invalid closed shape/u,
	);

	const sources = normalizeCaptureSelectedSources([
		{ sourceId: 'display-1', role: 'display' },
		{ sourceId: 'system-1', role: 'system-audio' },
	]);
	assert.deepEqual(sources, [
		{ sourceId: 'display-1', role: 'display' },
		{ sourceId: 'system-1', role: 'system-audio' },
	]);
	assert.equal(Object.isFrozen(sources), true);
	assert.equal(Object.isFrozen(sources[0]), true);
	assert.throws(
		() => normalizeCaptureSelectedSources([
			{ sourceId: 'system-1', role: 'system-audio' },
		]),
		/System audio requires a selected display source/u,
	);
	assert.throws(
		() => normalizeCaptureSelectedSources([
			{ sourceId: 'same', role: 'camera' },
			{ sourceId: 'same', role: 'microphone' },
		]),
		/Duplicate capture source ID same/u,
	);
});

test('packet and metric contracts describe bounded timestamped video and PCM observations', () => {
	const videoPacket: CaptureEncodedVideoPacket = {
		kind: 'encoded-video', sessionId: 'session-1', streamId: 'camera-1', role: 'camera',
		sequence: 0, presentationTimeUs: 0, durationUs: 33_333, receiptTimeMs: 12.5,
		byteLength: 3, bytes: new Uint8Array([1, 2, 3]), mimeType: 'video/webm;codecs=vp8',
		keyFrame: true, droppedBefore: { value: 0, confidence: 'exact' },
	};
	const audioPacket: CapturePcmAudioPacket = {
		kind: 'pcm-audio', sessionId: 'session-1', streamId: 'microphone-1', role: 'microphone',
		sequence: 0, presentationTimeUs: 0, durationUs: 10_000, receiptTimeMs: 12.5,
		frameCount: 480, sampleRate: 48_000, channelCount: 1,
		samples: new Float32Array(480), droppedBefore: { value: null, confidence: 'unavailable' },
	};
	const metrics: CaptureStreamMetrics = {
		streamId: 'camera-1', role: 'camera', packetCount: 1, capturedDurationUs: 33_333,
		droppedUnits: { value: 0, confidence: 'exact' },
		droppedRatio: { value: 0, confidence: 'exact' },
		currentDriftUs: { value: 4, confidence: 'estimated' },
		maximumAbsoluteDriftUs: { value: 4, confidence: 'estimated' },
	};
	assert.equal(videoPacket.bytes.byteLength, 3);
	assert.equal(audioPacket.samples.length, 480);
	assert.equal(metrics.maximumAbsoluteDriftUs.value, 4);
});

test('capture state requires a fresh direct gesture and rejects stale permission completion', () => {
	const machine = createFramescaperCaptureStateMachine();
	assert.equal(machine.snapshot.phase, 'inactive');
	assert.throws(() => machine.issueDirectGesture(), /runtime is not available/u);
	machine.setRuntimeAvailability(AVAILABLE);

	const staleGesture = machine.issueDirectGesture();
	const currentGesture = machine.issueDirectGesture();
	assert.throws(
		() => machine.requestPreview(staleGesture, ['camera']),
		/stale or was not issued by this capture controller/u,
	);
	const invalidGesture = machine.issueDirectGesture();
	assert.throws(
		() => machine.requestPreview(invalidGesture, ['camera', 'camera']),
		/Duplicate capture source role camera/u,
	);
	assert.throws(
		() => machine.requestPreview(invalidGesture, ['camera']),
		/stale or was not issued by this capture controller/u,
	);
	const authorizedGesture = machine.issueDirectGesture();
	const requestGeneration = machine.requestPreview(authorizedGesture, ['camera', 'microphone']);
	assert.equal(machine.snapshot.phase, 'permission-pending');
	assert.throws(
		() => machine.previewReady(requestGeneration + 1, [
			{ sourceId: 'camera-1', role: 'camera' },
			{ sourceId: 'microphone-1', role: 'microphone' },
		]),
		/stale capture preview completion/u,
	);
	machine.previewReady(requestGeneration, [
		{ sourceId: 'camera-1', role: 'camera' },
		{ sourceId: 'microphone-1', role: 'microphone' },
	]);
	assert.equal(machine.snapshot.phase, 'previewing');
	assert.throws(
		() => machine.requestPreview(currentGesture, ['camera']),
		/stale or was not issued by this capture controller/u,
	);
});

test('capture state freezes sources at arm and follows the complete happy-path lifecycle', () => {
	const machine = previewingMachine([
		{ sourceId: 'display-1', role: 'display' },
		{ sourceId: 'microphone-1', role: 'microphone' },
	]);
	machine.arm({ destination: 'both', countdownMs: 3_000 });
	assert.deepEqual(machine.snapshot, {
		phase: 'armed', availability: AVAILABLE,
		requestedRoles: ['display', 'microphone'],
		sources: [
			{ sourceId: 'display-1', role: 'display' },
			{ sourceId: 'microphone-1', role: 'microphone' },
		],
		sourcesFrozen: true, destination: 'both', countdownMs: 3_000,
		permissionRequestGeneration: null, failure: null,
	});
	assert.throws(() => machine.issueDirectGesture(), /cannot issue.*while armed/u);

	machine.beginCountdown();
	assert.equal(machine.snapshot.phase, 'countdown');
	machine.startRecording();
	assert.equal(machine.snapshot.phase, 'recording');
	machine.pause();
	assert.equal(machine.snapshot.phase, 'paused');
	machine.resume();
	assert.equal(machine.snapshot.phase, 'recording');
	machine.stop();
	assert.equal(machine.snapshot.phase, 'finalizing');
	machine.completeFinalization();
	assert.equal(machine.snapshot.phase, 'inactive');
	assert.deepEqual(machine.snapshot.sources, []);
});

test('capture state separates recoverable exits from pre-capture failures', () => {
	const active = previewingMachine([{ sourceId: 'camera-1', role: 'camera' }]);
	active.arm({ destination: 'project-bin', countdownMs: 0 });
	active.beginCountdown();
	active.startRecording();
	assert.throws(
		() => active.fail({ code: 'encoder-failed', message: 'encoder stopped' }),
		/enter recovery instead of failing an active capture/u,
	);
	active.enterRecovery({ code: 'encoder-failed', message: 'encoder stopped' });
	assert.equal(active.snapshot.phase, 'recovery');
	assert.equal(active.snapshot.sourcesFrozen, true);
	active.completeRecovery();
	assert.equal(active.snapshot.phase, 'inactive');

	const pending = createFramescaperCaptureStateMachine({ availability: AVAILABLE });
	const request = pending.requestPreview(pending.issueDirectGesture(), ['camera']);
	pending.previewFailed(request, { code: 'permission-denied', message: 'denied' });
	assert.equal(pending.snapshot.phase, 'failed');
	assert.equal(pending.snapshot.failure?.code, 'permission-denied');
	pending.resetFailure();
	assert.equal(pending.snapshot.phase, 'inactive');
});

test('capture state restores a sealed session without reopening any source', () => {
	const restored = createFramescaperCaptureStateMachine({ availability: AVAILABLE });
	restored.restoreRecovery({
		sources: [{ sourceId: 'display-source', role: 'display' }],
		destination: 'timeline',
		failure: { code: 'runtime-lost', message: 'The previous session ended unexpectedly.' },
	});
	assert.equal(restored.snapshot.phase, 'recovery');
	assert.equal(restored.snapshot.sourcesFrozen, true);
	assert.equal(restored.snapshot.destination, 'timeline');
	assert.deepEqual(restored.snapshot.requestedRoles, ['display']);
	assert.throws(() => restored.issueDirectGesture(), /while recovery/u);
	restored.beginRecoveryFinalization();
	assert.equal(restored.snapshot.phase, 'finalizing');
	restored.completeFinalization();
	assert.equal(restored.snapshot.phase, 'inactive');
});

test('active-time clock removes pause spans without allowing time to move backwards', () => {
	const clock = createFramescaperCaptureActiveTimeClock(100);
	assert.deepEqual(clock.snapshot(150), {
		startedAtMs: 100, observedAtMs: 150, stoppedAtMs: null,
		wallTimeMs: 50, pausedTimeMs: 0, activeTimeMs: 50, activeTimeUs: 50_000,
		paused: false, pauseSpans: [],
	});
	clock.pause(160);
	assert.equal(clock.snapshot(220).activeTimeMs, 60);
	clock.resume(260);
	assert.deepEqual(clock.snapshot(300).pauseSpans, [
		{ startedAtMs: 160, endedAtMs: 260, durationMs: 100 },
	]);
	assert.equal(clock.snapshot(300).activeTimeMs, 100);
	assert.throws(() => clock.pause(299), /cannot move backwards/u);
	clock.pause(320);
	const stopped = clock.stop(400);
	assert.equal(stopped.activeTimeMs, 120);
	assert.equal(stopped.pausedTimeMs, 180);
	assert.equal(clock.snapshot(500).activeTimeMs, 120);
	assert.throws(() => clock.resume(500), /already stopped/u);
});

test('capture lease cleanup is exactly once across concurrent and repeated disposal', async () => {
	let calls = 0;
	let resolveDisposal = (): void => {
		assert.fail('Capture lease disposal resolver was not installed.');
	};
	const lease = createIdempotentCaptureLease(() => {
		calls += 1;
		return new Promise<void>((resolve) => {
			resolveDisposal = resolve;
		});
	});
	const first = lease.dispose();
	const second = lease.dispose();
	assert.equal(first, second);
	assert.equal(lease.disposalStarted, true);
	assert.equal(lease.disposed, false);
	assert.equal(calls, 1);
	resolveDisposal();
	await first;
	assert.equal(lease.disposed, true);
	assert.equal(lease.dispose(), first);
	assert.equal(calls, 1);

	const disposalFailure = new Error('release failed');
	let failedCalls = 0;
	const failedLease = createIdempotentCaptureLease(() => {
		failedCalls += 1;
		throw disposalFailure;
	});
	const failed = failedLease.dispose();
	await assert.rejects(failed, disposalFailure);
	assert.equal(failedLease.dispose(), failed);
	assert.equal(failedLease.disposed, false);
	assert.equal(failedCalls, 1);
});

function previewingMachine(
	sources: readonly Readonly<{ sourceId: string; role: 'camera' | 'microphone' | 'display' }>[],
) {
	const machine = createFramescaperCaptureStateMachine({ availability: AVAILABLE });
	const request = machine.requestPreview(
		machine.issueDirectGesture(),
		sources.map(({ role }) => role),
	);
	machine.previewReady(request, sources);
	return machine;
}
