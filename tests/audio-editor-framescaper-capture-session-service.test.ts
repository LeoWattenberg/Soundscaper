/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';
import {
	createFramescaperCaptureSessionService,
} from '../src/common/editor/controller/framescaper-capture-session-service.ts';
import type {
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
} from '../src/common/editor/controller/framescaper-capture-session-types.ts';
import type { CapturePacket, CaptureSourceRole } from '../src/common/editor/framescaper-capture-domain.ts';

const SHA = 'ab'.repeat(32);

test('capture initialization probes complete support without opening a source', async () => {
	const harness = serviceHarness();
	await harness.service.initialize();
	assert.equal(harness.service.snapshot.availability.status, 'available');
	assert.deepEqual(harness.events, ['probe', 'runtime-prerequisites', 'recovery-inventory', 'change']);
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.deepEqual(harness.service.snapshot.sources, []);
});

test('live capture preregisters durability, pauses every stream, and publishes after release', async () => {
	const harness = serviceHarness();
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera', 'microphone']);
	assert.equal(harness.service.snapshot.phase, 'previewing');
	harness.service.actions.configure({ monitoring: true, inputGain: 1.25 });
	harness.service.actions.arm({ destination: 'both', countdownMs: 3_000 });
	await harness.service.actions.start();
	assert.equal(harness.service.snapshot.phase, 'recording');
	assert.ok(harness.events.indexOf('durable:prepare') < harness.events.indexOf('recorder:start:camera'));
	assert.ok(harness.events.indexOf('durable:prepare') < harness.events.indexOf('recorder:start:microphone'));
	assert.equal(harness.origin.snapshot('project-a').editBlocked, true);

	await harness.emit('microphone', pcmPacket());
	await harness.service.actions.pause();
	assert.equal(harness.service.snapshot.phase, 'paused');
	await harness.service.actions.resume();
	assert.equal(harness.service.snapshot.phase, 'recording');
	await harness.service.actions.stop();

	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.equal(harness.origin.snapshot('project-a').active, false);
	assert.ok(harness.events.indexOf('lease:dispose') < harness.events.indexOf('finalize:live'));
	assert.equal(harness.events.filter((event) => event.startsWith('recorder:pause:')).length, 2);
	assert.equal(harness.events.filter((event) => event.startsWith('recorder:resume:')).length, 2);
	assert.ok(harness.events.includes('durable:pause'));
	assert.ok(harness.events.includes('durable:seal'));
	assert.equal(harness.service.snapshot.metrics?.length, 0, 'settled metrics leave the inactive snapshot');
});

test('an active encoder failure seals recovery and exact discard releases its origin', async () => {
	const harness = serviceHarness();
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	await harness.service.actions.start();
	harness.failRecorder('camera', new Error('encoder crashed'));
	await harness.service.settled();

	assert.equal(harness.service.snapshot.phase, 'recovery');
	assert.equal(harness.origin.snapshot('project-a').active, true);
	assert.ok(harness.events.includes('durable:seal'));
	assert.equal(harness.events.includes('finalize:live'), false);
	await harness.service.actions.discard();
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.ok(harness.events.includes('durable:discard'));
	assert.equal(harness.origin.snapshot('project-a').active, false);
	await harness.service.dispose();
});

test('startup recovery remains actionable when source capture is unavailable', async () => {
	const harness = serviceHarness({
		availability: {
			status: 'unavailable', reason: 'permission-policy', detail: 'Capture is denied here.',
		},
		recovery: recoverySession(),
	});
	await harness.service.initialize();
	assert.equal(harness.service.snapshot.availability.status, 'unavailable');
	assert.equal(harness.service.snapshot.phase, 'recovery');
	await harness.service.actions.importAsIs();
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.ok(harness.events.includes('finalize:import-as-is'));
	assert.equal(harness.origin.snapshot('project-a').active, false);
});

function serviceHarness(options: Readonly<{
	availability?: Readonly<Record<string, unknown>>;
	recovery?: ReturnType<typeof recoverySession> | null;
}> = {}) {
	const events: string[] = [];
	const origin = createFramescaperCaptureOriginGuard();
	const packets = new Map<CaptureSourceRole, (packet: Readonly<CapturePacket>) => Promise<void>>();
	const errors = new Map<CaptureSourceRole, (error: unknown) => void>();
	let time = 100;
	const durable = {
		async prepare(request: Readonly<Record<string, unknown>>) {
			events.push('durable:prepare');
			return { ...request, marker: 'durable-session' };
		},
		async append(session: unknown) { events.push('durable:append'); return session; },
		async recordPauseSpan(session: unknown) { events.push('durable:pause'); return session; },
		async seal(session: unknown) { events.push('durable:seal'); return session; },
		async discard() { events.push('durable:discard'); },
		async findRecovery() { events.push('recovery-inventory'); return options.recovery ?? null; },
	};
	const service = createFramescaperCaptureSessionService({
		enabled: true,
		embedded: false,
		sourcePort: {
			async probe() {
				events.push('probe');
				return (options.availability ?? {
					status: 'available', sourceRoles: ['camera', 'microphone', 'display', 'system-audio'],
				}) as never;
			},
			async enumerate() { return { devices: [] }; },
			async openPreview(request) {
				events.push(`preview:${String(request.userActionGeneration)}`);
				return {
					sources: request.roles.map((role) => ({
						sourceId: `${role}-device`, role,
						stream: { role }, track: { role, label: `${role} label` },
						settings: role === 'microphone'
							? { sampleRate: 48_000, channelCount: 1 }
							: { width: 1_920, height: 1_080 },
						capabilities: {},
					})),
					async dispose() { events.push('lease:dispose'); },
				};
			},
		},
		async completeRuntimeProbe(availability) {
			events.push('runtime-prerequisites');
			return availability;
		},
		authorizeUserAction: (generation) => { events.push(`authorize:${String(generation)}`); },
		captureOrigin: () => ({
			projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
			origin: { sequenceId: 'sequence-a', playheadMicroseconds: 2_000_000, destination: 'both' },
		}),
		originGuard: origin,
		durable,
		async createRecorder(request: FramescaperCaptureRecorderRequest): Promise<FramescaperCaptureRecorder> {
			const role = request.source.role;
			packets.set(role, async (packet) => request.onPacket(packet));
			errors.set(role, request.onError);
			return {
				format: role === 'camera' || role === 'display'
					? { kind: 'encoded-media', mimeType: 'video/webm' }
					: { kind: 'raw-pcm', sampleRate: 48_000, channelCount: 1, chunkFrames: 480 },
				start() { events.push(`recorder:start:${role}`); },
				pause() { events.push(`recorder:pause:${role}`); return true; },
				resume() { events.push(`recorder:resume:${role}`); return true; },
				async stop() { events.push(`recorder:stop:${role}`); },
				async dispose() { events.push(`recorder:dispose:${role}`); },
				setMonitoring() {},
				setInputGain() {},
			};
		},
		async finalize({ provenance }) { events.push(`finalize:${provenance}`); },
		createId: (prefix) => `${prefix}-id`,
		now: () => { time += 10; return time; },
		async waitCountdown(_duration, signal) {
			events.push('countdown');
			if (signal.aborted) throw signal.reason;
		},
		onChange: () => { events.push('change'); },
	});
	return {
		service,
		events,
		origin,
		emit: async (role: CaptureSourceRole, packet: Readonly<CapturePacket>) => {
			const sink = packets.get(role);
			if (!sink) throw new Error(`Missing ${role} packet sink.`);
			await sink(packet);
		},
		failRecorder: (role: CaptureSourceRole, error: unknown) => {
			const fail = errors.get(role);
			if (!fail) throw new Error(`Missing ${role} error sink.`);
			fail(error);
		},
		settled: () => service.settled(),
	};
}

function recoverySession() {
	return {
		sessionId: 'recovery-session',
		sources: [{ streamId: 'display-stream', sourceId: 'display-source', role: 'display' as const }],
		destination: 'timeline' as const,
		projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 2_000_000, destination: 'timeline' as const },
	};
}

function pcmPacket(): CapturePacket {
	return {
		kind: 'pcm-audio', sessionId: 'framescaper-capture-session-id',
		streamId: 'microphone-capture-stream-id', role: 'microphone', sequence: 0,
		presentationTimeUs: 0, durationUs: 10_000, receiptTimeMs: 150,
		droppedBefore: { value: 0, confidence: 'exact' }, frameCount: 480,
		sampleRate: 48_000, channelCount: 1, samples: new Float32Array(480),
	};
}
