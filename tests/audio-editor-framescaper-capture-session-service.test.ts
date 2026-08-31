/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';
import {
	createFramescaperCaptureSessionService,
} from '../src/common/editor/controller/framescaper-capture-session-service.ts';
import type {
	FramescaperCaptureDisplaySelectionPort,
	FramescaperCaptureDurablePort,
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
} from '../src/common/editor/controller/framescaper-capture-session-types.ts';
import type { CapturePacket, CaptureSourceRole } from '../src/common/editor/framescaper-capture-domain.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

const SHA = 'ab'.repeat(32);

test('capture initialization probes complete support without opening a source', async () => {
	const harness = serviceHarness();
	await harness.service.initialize();
	assert.equal(harness.service.snapshot.availability.status, 'available');
	assert.deepEqual(harness.events, ['probe', 'runtime-prerequisites', 'recovery-inventory', 'change']);
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.deepEqual(harness.service.snapshot.sources, []);
});

test('desktop source-list authority never chooses a display and grants non-display media too', async () => {
	const grants: unknown[] = [];
	let listCount = 0;
	const displaySelection: FramescaperCaptureDisplaySelectionPort = {
		mode: 'source-list',
		listSources: () => {
			listCount += 1;
			return [
			{ token: 'screen-token', name: 'Main screen', kind: 'screen' },
			{ token: `window-token-${String(listCount)}`, name: 'Slides', kind: 'window' },
			];
		},
		authorize(request) { grants.push(request); },
	};
	const harness = serviceHarness({ displaySelection, devices: [
		{ id: 'camera-b', kind: 'camera' as const, label: 'Document camera' },
	] });
	await harness.service.initialize();
	await assert.rejects(
		harness.service.actions.requestPreview(['display']),
		/choose a display source/iu,
	);
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.equal(harness.events.some((event) => event.startsWith('preview:')), false);

	await harness.service.actions.listDisplaySources();
	assert.equal(harness.service.snapshot.selectedDisplaySourceToken, null);
	assert.deepEqual(harness.service.snapshot.displaySources.map(({ name }) => name), ['Main screen', 'Slides']);
	harness.service.actions.selectDisplaySource('window-token-1');
	await harness.service.actions.requestPreview(['display', 'camera']);
	assert.deepEqual(grants[0], { generation: 1, roles: ['display', 'camera'], sourceToken: 'window-token-1' });
	assert.deepEqual(harness.service.snapshot.displaySources, []);
	assert.equal(harness.service.snapshot.selectedDisplaySourceToken, null);
	await harness.service.actions.selectDevice('camera', 'camera-b');
	assert.deepEqual(grants[1], { generation: 2, roles: ['display', 'camera'], sourceToken: 'window-token-2' });
	await harness.service.actions.release();

	await harness.service.actions.requestPreview(['camera']);
	assert.deepEqual(grants[2], { generation: 3, roles: ['camera'], sourceToken: null });
	await harness.service.actions.release();
});

test('failed display authorization releases its one-shot user action', async () => {
	const displaySelection: FramescaperCaptureDisplaySelectionPort = {
		mode: 'system-picker',
		authorize() { throw new Error('display permission failed'); },
	};
	const harness = serviceHarness({ displaySelection });
	await harness.service.initialize();

	await assert.rejects(harness.service.actions.requestPreview(['display']),
		/display permission failed/iu);
	assert.deepEqual(harness.events.filter((event) =>
		event.startsWith('authorize:') || event.startsWith('release-user-action:')), [
		'authorize:1', 'release-user-action:1',
	]);
});

test('live capture preregisters durability, measures before storage delay, and publishes after release', async () => {
	const harness = serviceHarness({ appendDelayMs: 5_000 });
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
	const microphoneMetrics = harness.service.snapshot.metrics.find(({ role }) => role === 'microphone');
	assert.ok(Math.abs(microphoneMetrics?.currentDriftUs.value ?? Infinity) < 100_000,
		'storage latency is not reported as capture drift');
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

test('dispose joins a start already admitted to durable preparation before recovering it', async () => {
	const prepared = deferred<void>();
	const harness = serviceHarness({ prepareGate: prepared.promise });
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	const starting = harness.service.actions.start();
	await waitForEvent(harness.events, 'durable:prepare');
	const disposal = harness.service.dispose();
	assert.equal(await remainsPending(disposal), true);
	prepared.resolve();
	await Promise.all([starting, disposal]);
	assert.equal(harness.service.snapshot.phase, 'recovery');
	assert.equal(harness.events.filter((event) => event === 'durable:seal').length, 1);
});

test('stopping during durable setup discards the empty session without offering recovery', async () => {
	const prepared = deferred<void>();
	const harness = serviceHarness({ prepareGate: prepared.promise });
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	const starting = harness.service.actions.start();
	await waitForEvent(harness.events, 'durable:prepare');
	const stopping = harness.service.actions.stop();
	prepared.resolve();
	await Promise.all([starting, stopping]);
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.equal(harness.events.filter((event) => event === 'durable:discard').length, 1);
	assert.equal(harness.events.includes('finalize:live'), false);
});

test('dispose joins permission opening and releases its late preview lease', async () => {
	const opened = deferred<void>();
	const harness = serviceHarness({ previewGate: opened.promise });
	await harness.service.initialize();
	const previewing = harness.service.actions.requestPreview(['camera']);
	await waitForEvent(harness.events, 'preview:1');
	const settling = harness.service.settled();
	const disposal = harness.service.dispose();
	assert.equal(await remainsPending(settling), true);
	assert.equal(await remainsPending(disposal), true);
	opened.resolve();
	await Promise.all([previewing, settling, disposal]);
	assert.equal(harness.events.filter((event) => event === 'lease:dispose').length, 1);
});

test('dispose joins a live finalization without starting concurrent active recovery', async () => {
	const finalized = deferred<void>();
	const harness = serviceHarness({ finalizeGates: { live: finalized.promise } });
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	await harness.service.actions.start();
	const stopping = harness.service.actions.stop();
	await waitForEvent(harness.events, 'finalize:live');
	const disposal = harness.service.dispose();
	assert.equal(harness.service.dispose(), disposal, 'concurrent disposal shares one join');
	assert.equal(await remainsPending(disposal), true);
	assert.equal(harness.events.filter((event) => event === 'durable:seal').length, 1);
	finalized.resolve();
	await Promise.all([stopping, disposal]);
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.equal(harness.events.filter((event) => event === 'durable:seal').length, 1);
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

test('a late recorder failure after settlement cannot disable recovery for the next capture', async () => {
	const harness = serviceHarness();
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	await harness.service.actions.start();
	const lateFailure = harness.recorderFailure('camera');
	await harness.service.actions.stop();
	lateFailure(new Error('late recorder callback'));

	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	await harness.service.actions.start();
	harness.failRecorder('camera', new Error('current encoder crashed'));
	await harness.service.settled();

	assert.equal(harness.service.snapshot.phase, 'recovery');
	assert.equal(harness.events.filter((event) => event === 'durable:seal').length, 2);
});

test('dispose and settled join active recovery while its durable seal is pending', async () => {
	const sealed = deferred<void>();
	const harness = serviceHarness({ sealGate: sealed.promise });
	await harness.service.initialize();
	await harness.service.actions.requestPreview(['camera']);
	harness.service.actions.arm({ destination: 'timeline', countdownMs: 0 });
	await harness.service.actions.start();
	harness.failRecorder('camera', new Error('encoder crashed'));
	await waitForEvent(harness.events, 'durable:seal');
	const settling = harness.service.settled();
	const disposal = harness.service.dispose();
	assert.equal(await remainsPending(settling), true);
	assert.equal(await remainsPending(disposal), true);
	sealed.resolve();
	await Promise.all([settling, disposal]);
	assert.equal(harness.service.snapshot.phase, 'recovery');
});

test('dispose and settled join durable recovery discard', async () => {
	const discarded = deferred<void>();
	const harness = serviceHarness({ recovery: recoverySession(), discardGate: discarded.promise });
	await harness.service.initialize();
	const discarding = harness.service.actions.discard();
	await waitForEvent(harness.events, 'durable:discard');
	const settling = harness.service.settled();
	const disposal = harness.service.dispose();
	assert.equal(await remainsPending(settling), true);
	assert.equal(await remainsPending(disposal), true);
	discarded.resolve();
	await Promise.all([discarding, settling, disposal]);
	assert.equal(harness.service.snapshot.phase, 'inactive');
	assert.equal(harness.origin.snapshot('project-a').active, false);
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

for (const provenance of ['recovered', 'import-as-is'] as const) {
	test(`dispose and settled join deferred ${provenance} recovery finalization`, async () => {
		const finalized = deferred<void>();
		const harness = serviceHarness({
			recovery: recoverySession(), finalizeGates: { [provenance]: finalized.promise },
		});
		await harness.service.initialize();
		const finalizing = provenance === 'recovered'
			? harness.service.actions.recover()
			: harness.service.actions.importAsIs();
		await waitForEvent(harness.events, `finalize:${provenance}`);
		const settling = harness.service.settled();
		const disposal = harness.service.dispose();
		assert.equal(await remainsPending(settling), true);
		assert.equal(await remainsPending(disposal), true);
		finalized.resolve();
		await Promise.all([finalizing, settling, disposal]);
		assert.equal(harness.service.snapshot.phase, 'inactive');
		assert.equal(harness.events.includes(`finalize:settled:${provenance}`), true);
	});
}

test('concurrent disposal joins initialization before resolving once', async () => {
	const probed = deferred<void>();
	const harness = serviceHarness({ probeGate: probed.promise });
	const initialization = harness.service.initialize();
	await waitForEvent(harness.events, 'probe');
	const first = harness.service.dispose();
	const second = harness.service.dispose();
	assert.equal(second, first);
	assert.equal(await remainsPending(first), true);
	probed.resolve();
	await Promise.all([initialization, first, second]);
	assert.deepEqual(harness.events.slice(0, 4), [
		'probe', 'runtime-prerequisites', 'recovery-inventory', 'change',
	]);
});

test('startup scans inactive projects and restores exactly one foreign-origin recovery', async () => {
	const harness = serviceHarness({
		currentProjectId: 'project-b',
		recoveryProjectIds: ['project-a', 'project-b'],
		recoveries: { 'project-a': recoverySession('project-a') },
	});
	await harness.service.initialize();

	assert.equal(harness.service.snapshot.phase, 'recovery');
	assert.ok(harness.events.indexOf('prepare-recovery:project-a') < harness.events.lastIndexOf('change'));
	assert.equal(harness.origin.snapshot('project-a').editBlocked, true);
	assert.equal(harness.origin.snapshot('project-b').editBlocked, false);
	assert.equal(harness.events.filter((event) => event === 'recovery-inventory').length, 2);
});

test('startup refuses more than one global capture recovery before binding either origin', async () => {
	const harness = serviceHarness({
		currentProjectId: 'project-b', recoveryProjectIds: ['project-a'],
		recoveries: {
			'project-a': recoverySession('project-a'),
			'project-b': recoverySession('project-b'),
		},
	});

	await assert.rejects(harness.service.initialize(), /more than one.*maintenance/iu);
	assert.equal(harness.origin.snapshot('project-a').active, false);
	assert.equal(harness.origin.snapshot('project-b').active, false);
});

function serviceHarness(options: Readonly<{
	availability?: Readonly<Record<string, unknown>>;
	recovery?: ReturnType<typeof recoverySession> | null;
	recoveries?: Readonly<Record<string, ReturnType<typeof recoverySession>>>;
	recoveryProjectIds?: readonly string[];
	currentProjectId?: string;
	displaySelection?: FramescaperCaptureDisplaySelectionPort;
	devices?: readonly Readonly<{ id: string; kind: 'camera' | 'microphone'; label: string }>[];
	appendDelayMs?: number;
	prepareGate?: Promise<void>;
	previewGate?: Promise<void>;
	sealGate?: Promise<void>;
	discardGate?: Promise<void>;
	probeGate?: Promise<void>;
	finalizeGates?: Readonly<Partial<Record<'live' | 'recovered' | 'import-as-is', Promise<void>>>>;
}> = {}) {
	const events: string[] = [];
	const origin = createFramescaperCaptureOriginGuard();
	const packets = new Map<CaptureSourceRole, (packet: Readonly<CapturePacket>) => Promise<void>>();
	const errors = new Map<CaptureSourceRole, (error: unknown) => void>();
	let time = 100;
	const durable: FramescaperCaptureDurablePort = {
		async prepare(request) {
			events.push('durable:prepare');
			await options.prepareGate;
			return { ...request, marker: 'durable-session' };
		},
		async append(session) { events.push('durable:append'); time += options.appendDelayMs ?? 0; return session; },
		async recordPauseSpan(session) { events.push('durable:pause'); return session; },
		async seal(session) { events.push('durable:seal'); await options.sealGate; return session; },
		async discard() { events.push('durable:discard'); await options.discardGate; },
		async findRecovery(projectId) {
			events.push('recovery-inventory');
			return options.recoveries?.[projectId] ?? options.recovery ?? null;
		},
	};
	const service = createFramescaperCaptureSessionService({
		enabled: true,
		embedded: false,
		sourcePort: {
			async probe() {
				events.push('probe');
				await options.probeGate;
				return (options.availability ?? {
					status: 'available', sourceRoles: ['camera', 'microphone', 'display', 'system-audio'],
				}) as never;
			},
			async enumerate() { return { devices: options.devices ?? [] }; },
			async openPreview(request) {
				events.push(`preview:${String(request.userActionGeneration)}`);
				await options.previewGate;
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
		displaySelection: options.displaySelection,
		recoveryProjectIds: options.recoveryProjectIds ? () => options.recoveryProjectIds! : undefined,
		prepareRecoveryOrigin: async (projectId) => { events.push(`prepare-recovery:${projectId}`); },
		async completeRuntimeProbe(availability) {
			events.push('runtime-prerequisites');
			return availability;
		},
		authorizeUserAction: (generation) => { events.push(`authorize:${String(generation)}`); },
		releaseUserAction: (generation) => { events.push(`release-user-action:${String(generation)}`); },
		captureOrigin: () => ({
			projectFence: { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const, projectId: options.currentProjectId ?? 'project-a', baseRevision: 4, baseSha256: SHA },
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
		async finalize({ provenance }) {
			events.push(`finalize:${provenance}`);
			await options.finalizeGates?.[provenance];
			events.push(`finalize:settled:${provenance}`);
		},
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
		recorderFailure: (role: CaptureSourceRole) => {
			const fail = errors.get(role);
			if (!fail) throw new Error(`Missing ${role} error sink.`);
			return fail;
		},
		settled: () => service.settled(),
	};
}

function recoverySession(projectId = 'project-a') {
	return {
		sessionId: 'recovery-session',
		sources: [{ streamId: 'display-stream', sourceId: 'display-source', role: 'display' as const }],
		destination: 'timeline' as const,
		projectFence: {
			schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
			projectId, baseRevision: 4, baseSha256: SHA,
		},
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
