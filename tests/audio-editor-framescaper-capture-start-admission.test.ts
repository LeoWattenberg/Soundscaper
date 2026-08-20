/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';
import { createFramescaperCaptureSessionService } from '../src/common/editor/controller/framescaper-capture-session-service.ts';
import type {
	FramescaperCaptureDurablePort,
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
	FramescaperCaptureSessionService,
} from '../src/common/editor/controller/framescaper-capture-session-types.ts';
import type { CapturePacket, CaptureSourceRole } from '../src/common/editor/framescaper-capture-domain.ts';

const SHA = 'ab'.repeat(32);

test('a partial recorder factory failure releases every recorder already acquired', async () => {
	const harness = startHarness({ factoryFailureRole: 'microphone' });
	await harness.preparePreview();

	await assert.rejects(harness.service.actions.start(), /microphone factory failed/iu);

	assert.equal(harness.service.snapshot.phase, 'failed');
	assert.equal(harness.events.includes('durable:prepare'), false);
	assert.deepEqual(harness.events.filter((event) => event.startsWith('recorder:')), [
		'recorder:create:camera',
		'recorder:create:microphone',
		'recorder:stop:camera',
		'recorder:dispose:camera',
	]);
	assert.equal(harness.events.filter((event) => event === 'lease:dispose').length, 1);
});

test('recording admits an immediate first packet and shares one start time across recorders', async () => {
	const harness = startHarness({ immediatePacketRole: 'camera' });
	await harness.preparePreview();

	await harness.service.actions.start();

	assert.equal(harness.service.snapshot.phase, 'recording');
	assert.deepEqual(harness.startPhases, ['recording', 'recording']);
	assert.equal(harness.appendPhases[0], 'recording');
	assert.equal(harness.startTimes.length, 2);
	assert.equal(harness.startTimes[0], harness.startTimes[1]);
	assert.equal(Number.isSafeInteger(harness.startTimes[0]), true);
	assert.ok((harness.startTimes[0] ?? -1) >= 0);

	await harness.service.actions.pause();
	await harness.service.actions.resume();
	assert.deepEqual(harness.resumeDurations, [10_000, 10_000]);
	await harness.service.actions.stop();
	assert.equal(harness.service.snapshot.phase, 'inactive');
});

test('a second recorder start failure seals recovery and releases the whole graph', async () => {
	const harness = startHarness({ startFailureRole: 'microphone' });
	await harness.preparePreview();

	await assert.rejects(harness.service.actions.start(), /microphone start failed/iu);

	assert.equal(harness.service.snapshot.phase, 'recovery');
	assert.deepEqual(harness.startPhases, ['recording', 'recording']);
	assert.equal(harness.startTimes[0], harness.startTimes[1]);
	assert.deepEqual(harness.events.filter((event) => event.startsWith('recorder:stop:')), [
		'recorder:stop:camera', 'recorder:stop:microphone',
	]);
	assert.deepEqual(harness.events.filter((event) => event.startsWith('recorder:dispose:')), [
		'recorder:dispose:camera', 'recorder:dispose:microphone',
	]);
	assert.equal(harness.events.filter((event) => event === 'lease:dispose').length, 1);
	assert.equal(harness.events.filter((event) => event === 'durable:seal').length, 1);
});

function startHarness(options: Readonly<{
	factoryFailureRole?: CaptureSourceRole;
	immediatePacketRole?: CaptureSourceRole;
	startFailureRole?: CaptureSourceRole;
}> = {}) {
	const events: string[] = [];
	const startPhases: string[] = [];
	const appendPhases: string[] = [];
	const startTimes: Array<number | undefined> = [];
	const resumeDurations: Array<number | undefined> = [];
	let time = 100;
	const durable: FramescaperCaptureDurablePort = {
		async prepare(request) { events.push('durable:prepare'); return request; },
		async append(session) {
			events.push('durable:append');
			appendPhases.push(service.snapshot.phase);
			return session;
		},
		async recordPauseSpan(session, span) {
			events.push(`durable:pause:${String(span.endMicroseconds - span.startMicroseconds)}`);
			return session;
		},
		async seal(session) { events.push('durable:seal'); return session; },
		async discard() {},
		async findRecovery() { return null; },
	};
	const service: FramescaperCaptureSessionService = createFramescaperCaptureSessionService({
		enabled: true,
		embedded: false,
		sourcePort: {
			async probe() {
				return { status: 'available' as const, sourceRoles: ['camera', 'microphone'] as const };
			},
			async enumerate() { return { devices: [] }; },
			async openPreview(request) {
				return {
					sources: request.roles.map((role) => ({
						sourceId: `${role}-device`, role,
						stream: { role }, track: { role }, settings: {}, capabilities: {},
					})),
					async dispose() { events.push('lease:dispose'); },
				};
			},
		},
		originGuard: createFramescaperCaptureOriginGuard(),
		durable,
		captureOrigin: () => ({
			projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
			origin: { sequenceId: 'sequence-a', playheadMicroseconds: 2_000_000, destination: 'both' },
		}),
		createRecorder(request: FramescaperCaptureRecorderRequest): FramescaperCaptureRecorder {
			const role = request.source.role;
			events.push(`recorder:create:${role}`);
			if (role === options.factoryFailureRole) throw new Error(`${role} factory failed`);
			return {
				format: role === 'camera'
					? { kind: 'encoded-media', mimeType: 'video/webm' }
					: { kind: 'raw-pcm', sampleRate: 48_000, channelCount: 1, chunkFrames: 480 },
				async start(activeTimeUs?: number) {
					events.push(`recorder:start:${role}`);
					startPhases.push(service.snapshot.phase);
					startTimes.push(activeTimeUs);
					if (role === options.immediatePacketRole) await request.onPacket(packetFor(request));
					if (role === options.startFailureRole) throw new Error(`${role} start failed`);
				},
				pause() { return true; },
				resume(excludedPauseDurationUs?: number) {
					resumeDurations.push(excludedPauseDurationUs);
					return true;
				},
				async stop() { events.push(`recorder:stop:${role}`); },
				async dispose() { events.push(`recorder:dispose:${role}`); },
			};
		},
		finalize: () => undefined,
		createId: (prefix) => `${prefix}-id`,
		now: () => { time += 10; return time; },
		waitCountdown: async () => undefined,
	});
	return {
		service, events, startPhases, appendPhases, startTimes, resumeDurations,
		async preparePreview() {
			await service.initialize();
			await service.actions.requestPreview(['camera', 'microphone']);
			service.actions.arm({ destination: 'both', countdownMs: 0 });
		},
	};
}

function packetFor(request: FramescaperCaptureRecorderRequest): Readonly<CapturePacket> {
	return {
		kind: 'encoded-video', sessionId: request.sessionId, streamId: request.streamId,
		role: 'camera', sequence: 0, presentationTimeUs: 0, durationUs: 33_333,
		receiptTimeMs: 130, droppedBefore: { value: 0, confidence: 'exact' },
		byteLength: 1, bytes: Uint8Array.of(1), mimeType: 'video/webm', keyFrame: true,
	};
}
