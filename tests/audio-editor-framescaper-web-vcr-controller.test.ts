/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperWebVcrController,
	type FramescaperWebVcrBridgeV1,
} from '../src/common/editor/controller/framescaper-web-vcr-controller.ts';
import type { WebVcrCommandV1, WebVcrSnapshot } from '../src/common/editor/web-vcr-domain.ts';

test('Web VCR stays fail-closed behind the roadmap capability gate', async () => {
	const fixture = harness({ enabled: false });
	await fixture.controller.initialize();
	assert.equal(fixture.calls.includes('handshake'), false);
	assert.deepEqual(fixture.controller.snapshot.capability, {
		status: 'unavailable', reason: 'roadmap-gate',
	});
	assert.equal(fixture.controller.snapshot.autoStop, false);
	await assert.rejects(() => fixture.controller.actions.activate(), /unavailable/iu);
});

test('activation releases device preview and opens one owned display plus page-audio preview', async () => {
	const fixture = harness();
	fixture.capture.state.phase = 'previewing';
	fixture.capture.state.sources = [{ sourceId: 'device-source', role: 'microphone' }];
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	assert.deepEqual(fixture.calls, [
		'handshake', 'subscribe', 'release', 'select:web-vcr', 'show-panel', 'open:1080p',
		'preview:display,system-audio',
	]);
	assert.equal(fixture.controller.snapshot.modeActive, true);
	assert.equal(fixture.controller.snapshot.phase, 'ready');
	assert.deepEqual(fixture.controller.snapshot.availableResolutions, ['720p', '1080p']);
	assert.equal(fixture.controller.snapshot.navigation.loading, false);
	assert.equal(fixture.controller.snapshot.previewStream, fixture.previewStream);
});

test('record freezes crop and shared destination, and record/stop are single-flight', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const first = fixture.controller.actions.record();
	const second = fixture.controller.actions.record();
	assert.equal(first, second);
	await first;
	assert.deepEqual(fixture.frozenCrops, [{ x: 0.1, y: 0.2, width: 0.6, height: 0.5 }]);
	assert.deepEqual(fixture.arms, [{ destination: 'project', countdownMs: 5_000 }]);
	assert.equal(fixture.calls.filter((entry) => entry === 'start').length, 1);
	assert.ok(fixture.calls.indexOf('host:preparing') < fixture.calls.indexOf('start'));
	assert.ok(fixture.calls.indexOf('start') < fixture.calls.indexOf('host:recording'));
	const stopA = fixture.controller.actions.stopAndImport();
	const stopB = fixture.controller.actions.stopAndImport();
	assert.equal(stopA, stopB);
	await stopA;
	assert.equal(fixture.calls.filter((entry) => entry === 'stop').length, 1);
	assert.ok(fixture.calls.indexOf('host:finalizing') < fixture.calls.indexOf('stop'));
	assert.ok(fixture.calls.indexOf('stop') < fixture.calls.lastIndexOf('host:ready'));
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	fixture.capture.state.phase = 'recording';
	await fixture.controller.actions.close();
	assert.equal(fixture.calls.includes('dispatch:set-visibility'), true);
	assert.equal(fixture.calls.includes('dispose'), false);
});

test('navigation or target loss seals active work into recovery while exact ended auto-stops', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	fixture.capture.state.phase = 'recording';
	fixture.publish(hostSnapshot({ navigation: { generation: 2 } }));
	await tick();
	assert.equal(fixture.calls.includes('seal'), true);

	const ended = harness();
	await ended.controller.initialize();
	await ended.controller.actions.activate();
	await ended.controller.actions.record();
	ended.capture.state.phase = 'recording';
	ended.publish(hostSnapshot({ phase: 'recording', autoStop: true,
		target: { mediaState: 'ended' }, targetEndedRecordingToken: 'c'.repeat(32) }));
	await tick();
	assert.equal(ended.calls.includes('stop'), false);
	ended.publish(hostSnapshot({ phase: 'recording', autoStop: true,
		target: { mediaState: 'ended' }, targetEndedRecordingToken: ended.recordingTokens[0] }));
	await tick();
	assert.equal(ended.calls.includes('stop'), true);

	const recovered = harness();
	await recovered.controller.initialize();
	await recovered.controller.actions.activate();
	await recovered.controller.actions.record();
	recovered.capture.state.phase = 'recording';
	recovered.publish(hostSnapshot({ phase: 'recovery' }));
	await tick();
	assert.equal(recovered.calls.includes('seal'), true);
});

test('Web VCR recovery ownership restores the opt-in mode without opening a guest', async () => {
	const fixture = harness();
	fixture.capture.state.phase = 'recovery';
	fixture.capture.state.sources = [
		{ sourceId: 'web-vcr:opaque-source', role: 'display' },
		{ sourceId: 'web-vcr:page-audio', role: 'system-audio' },
	];
	await fixture.controller.initialize();
	assert.equal(fixture.controller.snapshot.modeActive, true);
	assert.equal(fixture.controller.snapshot.phase, 'recovery');
	assert.equal(fixture.calls.includes('open:1080p'), false);
	fixture.capture.state.phase = 'inactive';
	fixture.capture.state.sources = [];
	fixture.controller.synchronizeCapture();
	await tick();
	assert.equal(fixture.controller.snapshot.modeActive, false);
	assert.equal(fixture.calls.includes('select:devices'), true);
});

test('manual crop records without a selected page target', async () => {
	const fixture = harness({ host: hostSnapshot({ autoCrop: false, target: null }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	assert.equal(fixture.calls.includes('start'), true);
});

test('Record rejects an exact target that already ended', async () => {
	const fixture = harness({ host: hostSnapshot({ target: { mediaState: 'ended' } }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /already ended/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
});

test('manual aspect selection constrains the encoded physical crop immediately', async () => {
	const fixture = harness({ host: hostSnapshot({ autoCrop: false, crop: { x: 0, y: 0, width: 1, height: 1 } }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.setAspect('9:16');
	const command = fixture.commands.find((value) => value.kind === 'set-crop');
	assert.deepEqual(command && 'crop' in command ? command.crop : null, {
		x: 0.341796875, y: 0, width: 0.31640625, height: 1,
	});
	await fixture.controller.actions.record();
	fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 }, outputSize: { width: 608, height: 1_080 },
	});
});

test('automatic crop rejects manual aspect and crop mutations', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.setAspect('1:1'), /automatic crop/iu);
	await assert.rejects(() => fixture.controller.actions.setCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }), /automatic crop/iu);
	assert.equal(fixture.commands.some((value) => value.kind === 'set-crop'), false);
});

test('manual crop cannot record while top-level navigation is unsettled', async () => {
	const fixture = harness({ host: hostSnapshot({ autoCrop: false, navigation: { isLoading: true } }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /not ready/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
});

test('a rejected preparing transition clears frozen frame authority', async () => {
	const fixture = harness({ rejectHostState: 'preparing' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /preparing rejected/iu);
	assert.equal(fixture.calls.includes('start'), false);
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	}), /frozen capture surface/iu);
});

test('the local take fence locks browser controls while desktop acknowledges preparing', async () => {
	const preparingGate = deferred<void>();
	const fixture = harness({ preparingGate: preparingGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	await tick();
	assert.equal(fixture.controller.snapshot.phase, 'preparing');
	assert.throws(() => fixture.controller.actions.setAutoStop(true), /locked/iu);
	preparingGate.resolve();
	await recording;
});

test('record reserves the app origin and shared destination before asynchronous desktop preparation', async () => {
	const admissionGate = deferred<void>();
	const fixture = harness({ admissionGate: admissionGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	fixture.capture.state.setupDefaults = { destination: 'media-bin', countdownMs: 0 };
	await tick();
	assert.deepEqual(fixture.calls.slice(-2), ['admission:begin', 'admission:prepare']);
	assert.equal(fixture.calls.includes('host:preparing'), false);
	admissionGate.resolve();
	await recording;
	assert.deepEqual(fixture.arms, [{ destination: 'project', countdownMs: 5_000 }]);
	assert.ok(fixture.calls.indexOf('admission:prepare') < fixture.calls.indexOf('host:preparing'));
	assert.ok(fixture.calls.indexOf('start') < fixture.calls.indexOf('admission:release'));
});

test('app start-admission failure releases the origin without mutating desktop capture state', async () => {
	const fixture = harness({ admissionFailure: new Error('project flush failed') });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /project flush failed/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
	assert.equal(fixture.calls.includes('host:recovery'), false);
	assert.equal(fixture.calls.filter((entry) => entry === 'admission:release').length, 1);
});

test('a target aperture change during app admission aborts before desktop or shared capture starts', async () => {
	const admissionGate = deferred<void>();
	const fixture = harness({ admissionGate: admissionGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	fixture.publish(hostSnapshot({
		crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
		target: { aperture: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } },
	}));
	admissionGate.resolve();
	await assert.rejects(recording, /authority changed during start admission/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
	assert.equal(fixture.calls.includes('arm'), false);
	assert.equal(fixture.calls.includes('start'), false);
	assert.equal(fixture.calls.filter((entry) => entry === 'admission:release').length, 1);
});

test('a rejected host recording transition seals the already-started shared take', async () => {
	const fixture = harness({ rejectHostState: 'recording' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /recording rejected/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'seal').length, 1);
	assert.equal(fixture.capture.state.phase, 'recovery');
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	}), /frozen capture surface/iu);
});

test('a rejected host recovery does not poison a later real recovery transition', async () => {
	const fixture = harness({ rejectHostState: 'preparing', rejectHostStateOnce: 'recovery' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record());
	fixture.capture.state.phase = 'recording';
	fixture.capture.state.sources = [
		{ sourceId: 'web-vcr:display', role: 'display' },
		{ sourceId: 'web-vcr:page-audio', role: 'system-audio' },
	];
	await fixture.controller.sealForShutdown();
	assert.equal(fixture.calls.filter((entry) => entry === 'host:recovery').length, 2);
});

test('a panel hidden during capture drops the destroyed guest and reopens a fresh session', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	fixture.capture.state.phase = 'recording';
	await fixture.controller.actions.close();
	await fixture.controller.actions.stopAndImport();
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 1);
	assert.equal(fixture.controller.snapshot.modeActive, false);
	await fixture.controller.actions.activate();
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'open:1080p').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'dispatch:set-visibility').length, 1);
});

test('delayed desktop snapshots cannot replace or close a newer guest generation', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	fixture.publish(hostSnapshot({ sessionId: 'f'.repeat(32), generation: 2, resolution: '720p', captureSurface: { width: 1280, height: 720 } }));
	fixture.publish(hostSnapshot());
	fixture.publish(hostSnapshot({ sessionId: null, generation: 1, phase: 'closed', visible: false, target: null }));
	assert.deepEqual(fixture.controller.captureAuthority.captureSurface(), { width: 1280, height: 720 });
	assert.equal(fixture.controller.snapshot.modeActive, true);
	fixture.publish(hostSnapshot({ sessionId: null, generation: 2, phase: 'closed', visible: false, target: null }));
	assert.equal(fixture.controller.snapshot.modeActive, false);
});

test('stop during the shared countdown never publishes a late recording transition', async () => {
	const startGate = deferred<void>();
	const fixture = harness({ startGate: startGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	await tick();
	assert.equal(fixture.capture.state.phase, 'countdown');
	const stopping = fixture.controller.actions.stopAndImport();
	startGate.resolve();
	await Promise.all([recording, stopping]);
	assert.equal(fixture.calls.includes('host:recording'), false);
	assert.deepEqual(fixture.calls.filter((entry) => entry.startsWith('host:')), [
		'host:preparing', 'host:finalizing', 'host:ready',
	]);
});

test('a rejected host finalizing transition cannot strand the shared capture', async () => {
	const fixture = harness({ rejectHostState: 'finalizing' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	fixture.capture.state.phase = 'recording';
	await assert.rejects(() => fixture.controller.actions.stopAndImport(), /finalizing rejected/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'stop').length, 1);
	assert.equal(fixture.capture.state.phase, 'previewing');
	assert.equal(fixture.calls.includes('host:recovery'), true);
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	}), /frozen capture surface/iu);
});

test('first encoded frame must match the frozen host surface and even crop', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_280, height: 720 },
		outputSize: { width: 768, height: 360 },
	}), /frozen capture surface/iu);
	fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	});
});

test('resolution changes and destructive data clear reacquire a fresh owned preview', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.setResolution('720p');
	assert.equal(fixture.controller.snapshot.resolution, '720p');
	assert.deepEqual(fixture.controller.snapshot.surface, { width: 1_280, height: 720 });
	assert.equal(fixture.calls.filter((entry) => entry === 'release').length, 1);
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	await fixture.controller.actions.clearBrowserData();
	assert.equal(fixture.controller.snapshot.navigation.url, 'about:blank');
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 3);
});

test('browser-data confirmation failure restores preview and preserves the primary error', async () => {
	const fixture = harness({ dispatchFailure: 'request-data-clear' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.clearBrowserData(), /request-data-clear failed/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'open:1080p').length, 1);
});

test('destructive browser-data failure reopens before preview and preserves the primary error', async () => {
	const fixture = harness({ dispatchFailure: 'clear-browser-data' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.clearBrowserData(), /clear-browser-data failed/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'open:1080p').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	assert.equal(fixture.controller.snapshot.modeActive, true);
});

test('failed browser-data recovery never masks the primary destructive error', async () => {
	const fixture = harness({ dispatchFailure: 'clear-browser-data', rejectReopen: true });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.clearBrowserData(), /clear-browser-data failed/iu);
	assert.equal(fixture.warnings.some((value) => value.includes('reopen failed')), true);
});

function harness(options: Readonly<{
	enabled?: boolean;
	host?: Readonly<WebVcrSnapshot>;
	startGate?: Promise<void>;
	rejectHostState?: string;
	rejectHostStateOnce?: string;
		preparingGate?: Promise<void>;
		admissionGate?: Promise<void>;
		admissionFailure?: unknown;
	dispatchFailure?: string;
	rejectReopen?: boolean;
}> = {}) {
	const calls: string[] = [];
	const warnings: string[] = [];
	const commands: WebVcrCommandV1[] = [];
	const arms: unknown[] = [];
	const frozenCrops: unknown[] = [];
	const recordingTokens: string[] = [];
	const previewStream = Object.freeze({ kind: 'preview' });
	let listener: ((snapshot: Readonly<WebVcrSnapshot>) => void) | null = null;
	let currentHost = options.host ?? hostSnapshot();
	let rejectedHostStateOnce = false;
	const bridge: FramescaperWebVcrBridgeV1 = {
		async handshake() {
			calls.push('handshake');
			return { version: 1, capability: { status: 'available', resolutions: ['720p', '1080p', '4k'] }, captureGrantTtlMs: 10_000 };
		},
		async open({ resolution }) {
			const reopening = calls.includes(`open:${resolution}`);
			calls.push(`open:${resolution}`);
			if (reopening && options.rejectReopen) throw new Error('reopen failed');
			if (currentHost.sessionId === null) currentHost = hostSnapshot({ sessionId: 'f'.repeat(32), generation: 2 });
			return currentHost;
		},
		async dispatch(command) {
			calls.push(`dispatch:${command.kind}`);
			commands.push(command);
			if (command.kind === options.dispatchFailure) {
				if (command.kind === 'clear-browser-data') {
					currentHost = hostSnapshot({ sessionId: null, generation: currentHost.generation, phase: 'closed', visible: false, target: null });
					listener?.(currentHost);
				}
				throw new Error(`${command.kind} failed`);
			}
			if (command.kind === 'set-visibility') currentHost = hostSnapshot({ visible: command.visible });
			if (command.kind === 'set-resolution') currentHost = hostSnapshot({
				resolution: command.resolution,
				captureSurface: command.resolution === '720p'
					? { width: 1_280, height: 720 }
					: { width: 1_920, height: 1_080 },
				outputSize: command.resolution === '720p'
					? { width: 768, height: 360 }
					: { width: 1_152, height: 540 },
			});
			if (command.kind === 'set-crop') currentHost = hostSnapshot({
				autoCrop: false, crop: command.crop, aspect: command.aspect,
			});
			if (command.kind === 'request-data-clear') return {
				version: 1, kind: 'data-clear-confirmation', sessionId: ID, generation: 1,
				nonce: 'c'.repeat(32), expiresAtMs: 20_000,
			};
			if (command.kind === 'clear-browser-data') currentHost = hostSnapshot({
				sessionId: 'e'.repeat(32), generation: 2,
				navigation: { generation: 1, url: 'about:blank' },
			});
			return { version: 1, kind: 'snapshot', snapshot: currentHost };
		},
		async prepareCapture() { calls.push('grant'); return {
			version: 1, grantId: 'b'.repeat(32), sessionId: ID, generation: 1, expiresAtMs: 11_000,
		}; },
		async setCaptureState(request) {
			const captureState = request.state;
			calls.push(`host:${captureState}`);
			if (captureState === 'preparing') recordingTokens.push(request.recordingToken);
			if (captureState === 'preparing') await options.preparingGate;
			if (captureState === options.rejectHostState) throw new Error(`${captureState} rejected`);
			if (captureState === options.rejectHostStateOnce && !rejectedHostStateOnce) {
				rejectedHostStateOnce = true;
				throw new Error(`${captureState} rejected once`);
			}
			if (captureState === 'ready' && currentHost.visible === false) {
				currentHost = hostSnapshot({
					sessionId: null, generation: currentHost.generation, phase: 'closed', visible: false,
					target: null, navigation: { generation: 0, url: 'about:blank' },
				});
				listener?.(currentHost);
			}
			return true;
		},
		subscribe(value) { calls.push('subscribe'); listener = value; return () => { listener = null; }; },
		async dispose() { calls.push('dispose'); return true; },
	};
	const state: {
		phase: string;
		sources: { sourceId: string; role: string }[];
		setupDefaults: { destination: string; countdownMs: number };
	} = {
		phase: 'inactive', sources: [], setupDefaults: { destination: 'project', countdownMs: 5_000 },
	};
	const capture = {
		state,
		get snapshot() { return { ...state, sources: state.sources.map((source) => ({
			...source,
			...(source.role === 'display' ? { previewStream } : {}),
		})) }; },
		actions: {
			async release() { calls.push('release'); state.phase = 'inactive'; state.sources = []; },
			async requestPreview(roles: readonly string[]) {
				calls.push(`preview:${roles.join(',')}`);
				state.phase = 'previewing';
				state.sources = [
					{ sourceId: 'guest-display', role: 'display' },
					{ sourceId: 'page-audio', role: 'system-audio' },
				];
			},
			arm(value: unknown) { calls.push('arm'); arms.push(value); state.phase = 'armed'; },
			async start() {
				calls.push('start');
				state.phase = 'countdown';
				await options.startGate;
				if (state.phase === 'countdown') state.phase = 'recording';
			},
			async stop() { calls.push('stop'); state.phase = 'inactive'; state.sources = []; },
			async sealForShutdown() { calls.push('seal'); state.phase = 'recovery'; },
			resetFailure() { calls.push('reset-failure'); state.phase = 'inactive'; },
		},
	};
	const controller = createFramescaperWebVcrController({
		enabled: options.enabled ?? true,
		bridge,
		getCapture: () => capture as never,
		adapter: {
			select(id) { calls.push(`select:${id}`); },
			freezeCrop(value) { frozenCrops.push(value); },
		},
		cropRuntimeAvailable: true,
		showPanel: () => { calls.push('show-panel'); },
		hidePanel: () => { calls.push('hide-panel'); },
		onWarning: (error) => { warnings.push(error instanceof Error ? error.message : String(error)); },
		startAdmission: {
			begin() {
				return {
					captured: {
						projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: 'ab'.repeat(32) },
						origin: { sequenceId: 'sequence-a', playheadMicroseconds: 500_000, destination: 'both' as const },
					},
					async prepare() {},
					release: () => true,
				};
			},
		},
		...((options.admissionGate || options.admissionFailure) ? {
			startAdmission: {
				begin() {
					calls.push('admission:begin');
					return {
						captured: {
							projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: 'ab'.repeat(32) },
							origin: { sequenceId: 'sequence-a', playheadMicroseconds: 500_000, destination: 'both' as const },
						},
						async prepare() {
							calls.push('admission:prepare');
							await options.admissionGate;
							if (options.admissionFailure) throw options.admissionFailure;
						},
						release() { calls.push('admission:release'); return true; },
					};
				},
			},
		} : {}),
	});
	return {
		controller, calls, capture, arms, frozenCrops, recordingTokens, previewStream, warnings, commands,
		publish(value: Readonly<WebVcrSnapshot>) { currentHost = value; listener?.(value); },
	};
}

const ID = 'a'.repeat(32);

function hostSnapshot(overrides: Readonly<Record<string, unknown>> = {}): Readonly<WebVcrSnapshot> {
	const navigationOverride = overrides.navigation as Readonly<Record<string, unknown>> | undefined;
	const targetOverride = overrides.target as Readonly<Record<string, unknown>> | null | undefined;
	return {
		version: 1,
		sessionId: ID,
		generation: 1,
		phase: 'ready',
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		resolution: '1080p',
		aspect: 'free',
		crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
		autoCrop: true,
		monitorMuted: false,
		autoStop: false,
		visible: true,
		targetEndedRecordingToken: null,
		captureSurface: { width: 1920, height: 1080 },
		outputSize: { width: 1152, height: 540 },
		metrics: null,
		failure: null,
		...overrides,
		navigation: {
			generation: 1, url: 'https://example.test/', canGoBack: false, canGoForward: false,
			isLoading: false, ...navigationOverride,
		},
		target: targetOverride === null ? null : {
			targetId: 'd'.repeat(32), generation: 1, mediaState: 'playing', aperture: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
			intrinsicSize: { width: 1920, height: 1080 }, ...targetOverride,
		},
	} as Readonly<WebVcrSnapshot>;
}

async function tick(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 0)); }

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve }; }
