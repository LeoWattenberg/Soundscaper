/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
	runFramescaperWebVcrDormantRendererSmoke,
	runFramescaperWebVcrPackagedRendererSmoke,
	validateFramescaperWebVcrDormantSmokeResult,
	validateFramescaperWebVcrPackagedRendererSmokeResult,
	validateFramescaperWebVcrPackagedSmokeResult,
} from '../desktop/framescaper-web-vcr-renderer-smoke.js';
import { parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';
import { createFramescaperWebVcrSmokeSession } from '../desktop/framescaper-web-vcr-smoke-session.js';

import {
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
	decodeFramescaperWebVcrSmokePlan,
	encodeFramescaperWebVcrSmokePlan,
	framescaperWebVcrSmokeTrust,
	parseFramescaperWebVcrSmokeConfiguration,
} from '../desktop/framescaper-web-vcr-smoke-plan.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://127.0.0.1:43210';

test('Web VCR packaged smoke plan is closed, canonical, pinned, and packaged-only', () => {
	const plan = smokePlan();
	const encoded = encodeFramescaperWebVcrSmokePlan(plan);
	assert.deepEqual(decodeFramescaperWebVcrSmokePlan(encoded), plan);
	const argv = smokeArgv(plan);
	assert.deepEqual(parseFramescaperWebVcrSmokeConfiguration(argv), {
		mode: FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
		plan,
	});
	assert.deepEqual(framescaperWebVcrSmokeTrust(argv, {
		packaged: true,
		productId: 'framescaper',
	}), {
		kind: 'packaged-smoke-v1',
		certificate: {
			enabled: true,
			origin: ORIGIN,
			fingerprint: '33:8B:8E:45:5F:A6:80:FB:B2:81:82:3D:0D:33:4E:58:E6:32:F6:8E:CF:69:C6:28:B2:A5:58:36:64:40:2F:61',
		},
	});
	assert.throws(
		() => framescaperWebVcrSmokeTrust(argv, { packaged: false, productId: 'framescaper' }),
		/packaged Framescaper/u,
	);
	assert.throws(
		() => framescaperWebVcrSmokeTrust(argv, { packaged: true, productId: 'soundscaper' }),
		/packaged Framescaper/u,
	);
});

test('Web VCR dormant packaged witness never produces main-process smoke trust', () => {
	const plan = smokePlan({ mode: FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE });
	const argv = smokeArgv(plan);
	assert.deepEqual(parseFramescaperWebVcrSmokeConfiguration(argv), { mode: plan.mode, plan });
	assert.equal(framescaperWebVcrSmokeTrust(argv, {
		packaged: true,
		productId: 'framescaper',
	}), null);
	assert.deepEqual(parseFramescaperWebVcrSmokeConfiguration(['/opt/Framescaper']), {
		mode: 'disabled', plan: null,
	});
});

test('desktop smoke configuration and session admit only the dedicated plan and trusted renderer gesture', async () => {
	const plan = smokePlan();
	assert.deepEqual(parseDesktopSmokeConfiguration(smokeArgv(plan)), { mode: plan.mode, plan });
	const session = createFramescaperWebVcrSmokeSession({ mode: plan.mode, plan });
	const calls = [];
	let focusCalls = 0;
	const evidence = validPackagedResult(plan);
	const rendererEvidence = validPackagedRendererResult(plan);
	assert.deepEqual(await session.run({
		focus() { focusCalls += 1; },
		async executeJavaScript(source, userGesture) {
			calls.push({ source, userGesture });
			session.observeDisplaySecurityWitness(displayWitness());
			session.observeDisplaySecurityWitness(displayWitness());
			return { status: 'fulfilled', value: rendererEvidence };
		},
	}), evidence);
	assert.ok(calls.length >= 1);
	assert.equal(calls[0].userGesture, true);
	assert.match(calls[0].source, /getDisplayMedia/u);
	assert.match(calls[0].source, /userActivation/u);
	assert.match(calls[0].source, new RegExp(plan.token, 'u'));
	assert.equal(calls.slice(1).every(({ userGesture }) => userGesture !== true), true);
	assert.equal(focusCalls, 0);
	await assert.rejects(() => session.run({ focus() {}, executeJavaScript: async () => evidence }), /already completed/u);
	const failed = createFramescaperWebVcrSmokeSession({ mode: plan.mode, plan });
	await assert.rejects(() => failed.run({
		focus() {},
		executeJavaScript: async () => {
			failed.observeDisplaySecurityWitness(permissionCheckWitness({ allowed: false }));
			return {
				status: 'rejected', message: 'capture unavailable', stage: '720p-capture-and-audio-energy',
			};
		},
	}), /capture unavailable.*display security.*permission-check.*"allowed":false/u);
});

test('packaged smoke session rearms a fresh trusted user gesture for each exact capture stage', async () => {
	const plan = smokePlan();
	const evidence = validPackagedResult(plan);
	const rendererEvidence = validPackagedRendererResult(plan);
	let stage = '720p-capture-user-gesture';
	let triggers = 0;
	let finishExecution;
	const execution = new Promise((resolve) => { finishExecution = resolve; });
	const calls = [];
	let focusCalls = 0;
	const session = createFramescaperWebVcrSmokeSession({ mode: plan.mode, plan });
	const result = await session.run({
		focus() { focusCalls += 1; },
		executeJavaScript(source, userGesture) {
			calls.push({ source, userGesture });
			if (calls.length === 1) return execution;
			if (source.includes('const invoke = globalThis')) {
				triggers += 1;
				session.observeDisplaySecurityWitness(displayWitness());
				if (triggers === 1) stage = '1080p-capture-user-gesture';
				else finishExecution({ status: 'fulfilled', value: rendererEvidence });
				return Promise.resolve(true);
			}
			return Promise.resolve(stage);
		},
	});
	assert.deepEqual(result, evidence);
	assert.equal(triggers, 2);
	assert.equal(focusCalls, 2);
	assert.equal(calls.filter(({ source }) => source.includes('const invoke = globalThis'))
		.every(({ userGesture }) => userGesture === true), true);
});

test('Web VCR smoke parser rejects partial, duplicate, drifted, and noncanonical plans', () => {
	const plan = smokePlan();
	const argv = smokeArgv(plan);
	assert.throws(
		() => parseFramescaperWebVcrSmokeConfiguration(argv.filter((argument) => argument !== '--soundscaper-smoke')),
		/exactly one matching smoke mode/u,
	);
	assert.throws(
		() => parseFramescaperWebVcrSmokeConfiguration([...argv, '--soundscaper-smoke']),
		/exactly one matching smoke mode/u,
	);
	assert.throws(
		() => parseFramescaperWebVcrSmokeConfiguration([
			...argv, `--soundscaper-smoke-mode=${FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE}`,
		]),
		/exactly one matching smoke mode/u,
	);
	assert.throws(
		() => parseFramescaperWebVcrSmokeConfiguration([...argv, argv.at(-1)]),
		/exactly one smoke plan/u,
	);
	assert.throws(
		() => parseFramescaperWebVcrSmokeConfiguration(smokeArgv({ ...plan, unexpected: true })),
		/closed plain record/u,
	);
	assert.throws(
		() => parseFramescaperWebVcrSmokeConfiguration(smokeArgv({
			...plan, certificateSha256: '00'.repeat(32),
		})),
		/exact fixture pin/u,
	);
	for (const origin of [
		'http://127.0.0.1:43210', 'https://localhost:43210', 'https://127.0.0.1',
		'https://127.0.0.1:43210/path', 'https://user@127.0.0.1:43210',
	]) {
		assert.throws(
			() => parseFramescaperWebVcrSmokeConfiguration(smokeArgv({ ...plan, origin })),
			/HTTPS loopback origin/u,
		);
	}
	const json = JSON.stringify(plan);
	assert.throws(
		() => decodeFramescaperWebVcrSmokePlan(Buffer.from(json).toString('base64url')),
		/canonical/u,
	);
	assert.throws(() => decodeFramescaperWebVcrSmokePlan(`${encodeFramescaperWebVcrSmokePlan(plan)}=`), /base64url/u);
});

test('production-lazy renderer uses only the bounded bridge and leaves the guest unopened', async () => {
	const plan = smokePlan({ mode: FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE });
	let openCalls = 0;
	const bridge = exactBridge({
		handshake: async () => ({
			version: 1,
			capability: { status: 'available', resolutions: ['720p', '1080p'] },
			captureGrantTtlMs: 10_000,
		}),
		open: async () => { openCalls += 1; throw new Error('must stay lazy'); },
	});
	const injected = vm.runInNewContext(`(${runFramescaperWebVcrDormantRendererSmoke.toString()})`);
	const result = structuredClone(await injected({ framescaperWebVcr: { v1: bridge } }, plan));
	assert.doesNotThrow(() => validateFramescaperWebVcrDormantSmokeResult(result, plan));
	assert.equal(result.diagnosticOnly, true);
	assert.equal(result.openAttempted, false);
	assert.equal(openCalls, 0);
});

test('packaged renderer exercises persistence, scaled input, exact surfaces, audio energy, and teardown', async () => {
	const plan = smokePlan();
	const fixture = activeRendererFixture(plan);
	const injected = vm.runInNewContext(`(${runFramescaperWebVcrPackagedRendererSmoke.toString()})`, {
		clearTimeout, Date, Error, Float32Array, JSON, Math, Number, Object, Promise, TypeError, URL, setTimeout,
	});
	const result = structuredClone(await injected(fixture.scope, plan));
	assert.doesNotThrow(() => validateFramescaperWebVcrPackagedRendererSmokeResult(result, plan));
	assert.deepEqual(result.captures.map(({ resolution, width, height }) => ({ resolution, width, height })), [
		{ resolution: '720p', width: 1_280, height: 720 },
		{ resolution: '1080p', width: 1_920, height: 1_080 },
	]);
	assert.deepEqual(fixture.captureRequests, [
		{ video: { width: { ideal: 1_280, max: 1_280 }, height: { ideal: 720, max: 720 } }, audio: true },
		{ video: { width: { ideal: 1_920, max: 1_920 }, height: { ideal: 1_080, max: 1_080 } }, audio: true },
	]);
	assert.deepEqual(result.captures.map(({ visualMarker }) => visualMarker), [
		{ sampledRgb: [[23, 197, 89], [211, 43, 173]], maxChannelDelta: 0, tolerance: 32, matched: true },
		{ sampledRgb: [[23, 197, 89], [211, 43, 173]], maxChannelDelta: 0, tolerance: 32, matched: true },
	]);
	assert.equal(result.captures[0].nonSilentAudio, true);
	assert.ok(result.captures[0].peakRms >= 0.002);
	assert.equal(result.target.ended, true);
	assert.equal(fixture.tracks.every((track) => track.stopped), true);
	assert.equal(fixture.disposed, true);
	assert.equal(fixture.unsubscribed, true);
});

test('packaged renderer validator rejects silence, 4K drift, and certification claims', () => {
	const plan = smokePlan();
	const fixture = validPackagedResult(plan);
	assert.doesNotThrow(() => validateFramescaperWebVcrPackagedSmokeResult(fixture, plan));
	assert.throws(() => validateFramescaperWebVcrPackagedSmokeResult({
		...fixture,
		captures: [{ ...fixture.captures[0], nonSilentAudio: false, peakRms: 0 }, fixture.captures[1]],
	}, plan), /audio energy|page-audio/iu);
	assert.throws(() => validateFramescaperWebVcrPackagedSmokeResult({
		...fixture,
		capability: { resolutions: ['720p', '1080p', '4k'], fourKUnavailable: false },
	}, plan), /resolutions|4K/iu);
	assert.throws(() => validateFramescaperWebVcrPackagedSmokeResult({
		...fixture, captures: [{ ...fixture.captures[0], visualMarker: { ...visualMarkerEvidence(), matched: false } }, fixture.captures[1]],
	}, plan), /visual marker/iu);
	assert.throws(() => validateFramescaperWebVcrPackagedSmokeResult({
		...fixture, diagnosticOnly: false,
	}, plan), /diagnostic-only plan/u);
});

function smokePlan(overrides = {}) {
	return {
		schemaVersion: 1,
		mode: FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
		productId: 'framescaper',
		token: TOKEN,
		origin: ORIGIN,
		certificateSha256: FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256,
		...overrides,
	};
}

function smokeArgv(plan) {
	return [
		'/opt/Framescaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${String(plan.mode)}`,
		`--soundscaper-smoke-plan=${encodeLoose(plan)}`,
	];
}

function encodeLoose(value) {
	const canonicalJson = (candidate) => candidate && typeof candidate === 'object'
		? `{${Object.keys(candidate).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`).join(',')}}`
		: JSON.stringify(candidate);
	return Buffer.from(canonicalJson(value)).toString('base64url');
}

function exactBridge(overrides = {}) {
	const unavailable = async () => { throw new Error('unused'); };
	return {
		dispatch: unavailable,
		dispose: unavailable,
		handshake: unavailable,
		open: unavailable,
		prepareCapture: unavailable,
		setCaptureState: unavailable,
		subscribe: () => () => undefined,
		...overrides,
	};
}

function activeRendererFixture(plan) {
	let session = 1;
	let generation = 1;
	let resolution = '720p';
	let url = 'about:blank';
	let loading = false;
	let target = null;
	let authenticated = false;
	let loginClicks = 0;
	let typed = '';
	let listener = null;
	const tracks = [];
	const fixture = { tracks, captureRequests: [], disposed: false, unsubscribed: false };
	const dimensions = () => resolution === '720p'
		? { width: 1_280, height: 720 } : { width: 1_920, height: 1_080 };
	const snapshot = (phase = 'ready') => ({
		version: 1,
		sessionId: String(session).padStart(32, '0'),
		generation,
		phase,
		resolution,
		captureSurface: dimensions(),
		navigation: { url, isLoading: loading },
		target,
		autoCrop: true,
	});
	const emit = (phase) => {
		const value = snapshot(phase);
		listener?.(value);
		return value;
	};
	const result = (phase) => ({ version: 1, kind: 'snapshot', snapshot: emit(phase) });
	const bridge = exactBridge({
		handshake: async () => ({
			version: 1,
			capability: { status: 'available', resolutions: ['720p', '1080p'] },
			captureGrantTtlMs: 10_000,
		}),
		open: async () => emit(),
		subscribe: (next) => {
			listener = next;
			return () => { fixture.unsubscribed = true; listener = null; };
		},
		dispatch: async (command) => {
			if (command.kind === 'request-data-clear') {
				return { ...reference(), kind: 'data-clear-confirmation', nonce: 'a'.repeat(32), expiresAtMs: 1 };
			}
			if (command.kind === 'clear-browser-data') {
				authenticated = false;
				session += 1;
				generation += 1;
				url = 'about:blank';
				target = null;
				return result();
			}
			if (command.kind === 'set-resolution') {
				resolution = command.resolution;
				session += 1;
				generation += 1;
				target = null;
				return result();
			}
			if (command.kind === 'navigate') {
				loading = true;
				const destination = new URL(command.url);
				if (destination.pathname === '/session/check') {
					destination.pathname = authenticated ? '/session/authenticated' : '/session/anonymous';
				}
				url = destination.href;
				typed = '';
				target = null;
				const pending = result();
				setTimeout(() => { loading = false; emit(); }, 0);
				return pending;
			}
			if (command.kind === 'key-input' && command.action === 'down') {
				if (command.key === 'Enter' && new URL(url).pathname === '/login') {
					authenticated = true;
					url = `${plan.origin}/session`;
				} else if (command.key.length === 1) typed += command.key;
				return result();
			}
			if (command.kind === 'pointer-input' && command.action === 'down') {
				if (loading) return result();
				const path = new URL(url).pathname;
				if (path === '/login') {
					loginClicks += 1;
					if (loginClicks === 3) {
						authenticated = true;
						url = `${plan.origin}/session`;
					}
				} else if (path === '/input') {
					url = `${plan.origin}/input/result?value=${typed}&pointer=64%2C160`;
				} else if (path === '/media/ended') {
					target = {
						mediaState: 'playing',
						intrinsicSize: { width: 640, height: 360 },
						aperture: { x: 0, y: 0, width: 1, height: 1 },
					};
				} else if (path === '/media/loop') {
					setTimeout(() => {
						target = {
							mediaState: 'playing',
							intrinsicSize: { width: 640, height: 360 },
							aperture: { x: 0, y: 0, width: 1, height: 1 },
						};
						emit();
					}, 0);
				}
				return result();
			}
			return result();
		},
		prepareCapture: async (request) => {
			const current = reference();
			assert.equal(request.version, current.version);
			assert.equal(request.sessionId, current.sessionId);
			assert.equal(request.generation, current.generation);
			return { ...reference(), grantId: 'b'.repeat(32), expiresAtMs: 10_000 };
		},
		setCaptureState: async (request) => {
			if (request.state === 'recording' && new URL(url).pathname === '/media/ended') {
				target = { ...target, mediaState: 'ended' };
			}
			emit(request.state);
			return true;
		},
		dispose: async () => { fixture.disposed = true; return true; },
	});
	const fakeTrack = (kind) => {
		const track = {
			kind,
			stopped: false,
			getSettings: () => kind === 'video' ? dimensions() : {},
			stop() { track.stopped = true; },
		};
		tracks.push(track);
		return track;
	};
	class FakeMediaStream {
		constructor(value) { this.value = value; }
		getTracks() { return this.value; }
		getVideoTracks() { return this.value.filter(({ kind }) => kind === 'video'); }
		getAudioTracks() { return this.value.filter(({ kind }) => kind === 'audio'); }
	}
	class FakeAudioContext {
		constructor() { this.destination = {}; }
		createMediaStreamSource() { return connection(); }
		createAnalyser() {
			return {
				...connection(),
				fftSize: 2_048,
				getFloatTimeDomainData: (samples) => samples.fill(0.01),
			};
		}
		createGain() { return { ...connection(), gain: { value: 1 } }; }
		async resume() {}
		async close() {}
	}
	fixture.scope = {
		framescaperWebVcr: { v1: bridge },
		crypto: { getRandomValues: (bytes) => { bytes.fill(session); return bytes; } },
		document: {
			permissionsPolicy: { allowsFeature: () => true },
			createElement(name) {
				if (name === 'video') return {
					readyState: 4, play: async () => undefined, pause: () => undefined,
					requestVideoFrameCallback: (callback) => callback(),
				};
				return { getContext: () => ({
					drawImage: () => undefined,
					getImageData: (x) => ({ data: x < 256 ? [23, 197, 89, 255] : [211, 43, 173, 255] }),
				}) };
			},
		},
		isSecureContext: true,
		navigator: {
			userActivation: { isActive: true },
			mediaDevices: { getDisplayMedia: async (request) => {
				fixture.captureRequests.push(structuredClone(request));
				return new FakeMediaStream([fakeTrack('video'), fakeTrack('audio')]);
			} },
		},
		MediaStream: FakeMediaStream,
		AudioContext: FakeAudioContext,
	};
	Object.defineProperty(fixture.scope, '__framescaperWebVcrSmokeStageV1', {
		configurable: true,
		set(value) {
			if (String(value).endsWith('-capture-user-gesture')) {
				void Promise.resolve().then(() => fixture.scope.__framescaperWebVcrSmokeCaptureGestureV1?.());
			}
		},
	});
	return fixture;

	function reference() {
		return { version: 1, sessionId: String(session).padStart(32, '0'), generation };
	}
}

function connection() {
	return { connect: () => undefined, disconnect: () => undefined };
}

function displayWitness(overrides = {}) {
	return {
		version: 1,
		stage: 'display-request',
		windowLive: true,
		focused: true,
		frameMatches: true,
		originMatches: true,
		editorDocument: true,
		ownerAvailable: true,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
		pending: true,
		systemPicker: false,
		outcome: 'granted-web-vcr',
		...overrides,
	};
}

function permissionCheckWitness(overrides = {}) {
	return {
		version: 1,
		stage: 'permission-check',
		windowLive: true,
		focused: true,
		senderMatches: true,
		originMatches: true,
		editorDocument: true,
		ownerAvailable: true,
		pending: true,
		systemPicker: false,
		allowed: true,
		...overrides,
	};
}

function validPackagedRendererResult(plan) {
	const { displaySecurity: _displaySecurity, ...renderer } = validPackagedResult(plan);
	return renderer;
}

function validPackagedResult(plan) {
	return {
		schemaVersion: 1,
		mode: plan.mode,
		productId: 'framescaper',
		token: plan.token,
		diagnosticOnly: true,
		preloadBridge: ['dispatch', 'dispose', 'handshake', 'open', 'prepareCapture', 'setCaptureState', 'subscribe'],
		capability: { resolutions: ['720p', '1080p'], fourKUnavailable: true },
		persistence: { authenticatedBeforeClear: true, anonymousAfterClear: true },
		input: { value: 'smoke', pointerX: 64, pointerY: 160, scaled: true },
		captures: [
			{ resolution: '720p', width: 1_280, height: 720, videoTracks: 1, audioTracks: 1, nonSilentAudio: true, peakRms: 0.01, visualMarker: visualMarkerEvidence() },
			{ resolution: '1080p', width: 1_920, height: 1_080, videoTracks: 1, audioTracks: 1, nonSilentAudio: null, peakRms: null, visualMarker: visualMarkerEvidence() },
		],
		target: {
			intrinsicWidth: 640,
			intrinsicHeight: 360,
			aperture: { x: 0, y: 0, width: 1, height: 1 },
			playing: true,
			ended: true,
		},
		lifecycle: { preparing: true, recording: true, finalizing: true, ready: true },
		clearData: { freshSession: true, generationAdvanced: true },
		teardown: { tracksStopped: true, guestDisposed: true },
		audioBoundary: {
			guestNativeAudioMuted: true,
			capturedPageAudioNonSilent: true,
			enableLocalEchoFalseAuthorityPath: true,
		},
		displaySecurity: {
			requests: ['720p', '1080p'].map((resolution) => ({
				...displayWitness(), resolution,
			})),
		},
	};
}

function visualMarkerEvidence() {
	return { sampledRgb: [[23, 197, 89], [211, 43, 173]], maxChannelDelta: 0, tolerance: 32, matched: true };
}
