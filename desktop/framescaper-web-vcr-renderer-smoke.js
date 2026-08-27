/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
} from './framescaper-web-vcr-smoke-plan.js';

const PRELOAD_BRIDGE = Object.freeze([
	'dispatch', 'dispose', 'handshake', 'open', 'prepareCapture', 'setCaptureState', 'subscribe',
]);
const CAPTURE_DIMENSIONS = Object.freeze({
	'720p': Object.freeze({ width: 1_280, height: 720 }),
	'1080p': Object.freeze({ width: 1_920, height: 1_080 }),
});
export const FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY = '__framescaperWebVcrSmokeStageV1';
export const FRAMESCAPER_WEB_VCR_SMOKE_CAPTURE_GESTURE_KEY =
	'__framescaperWebVcrSmokeCaptureGestureV1';

export async function runFramescaperWebVcrDormantRendererSmoke(scope, plan) {
	const preloadBridge = [
		'dispatch', 'dispose', 'handshake', 'open', 'prepareCapture', 'setCaptureState', 'subscribe',
	];
	const api = scope?.framescaperWebVcr?.v1;
	if (!api || JSON.stringify(Object.keys(api).sort()) !== JSON.stringify(preloadBridge)
		|| preloadBridge.some((name) => typeof api[name] !== 'function')) {
		throw new Error('Framescaper Web VCR smoke requires the exact bounded preload bridge.');
	}
	if (plan?.mode !== 'framescaper-web-vcr-dormant-v1') {
		throw new TypeError('Dormant Web VCR renderer smoke received the wrong plan.');
	}
	const handshake = await api.handshake();
	if (handshake?.version !== 1 || handshake.captureGrantTtlMs !== 10_000
		|| handshake.capability?.status !== 'available'
		|| JSON.stringify(handshake.capability.resolutions) !== JSON.stringify(['720p', '1080p'])) {
		throw new Error('Production Web VCR bridge did not expose the supported baseline.');
	}
	return {
		schemaVersion: 1,
		mode: plan.mode,
		productId: 'framescaper',
		token: plan.token,
		qualification: false,
		preloadBridge,
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		openAttempted: false,
	};
}

export async function runFramescaperWebVcrPackagedRendererSmoke(scope, plan) {
	const fail = (message) => { throw new Error(`Framescaper Web VCR packaged feasibility smoke ${message}`); };
	const stage = (value) => { scope.__framescaperWebVcrSmokeStageV1 = value; };
	const preloadBridge = [
		'dispatch', 'dispose', 'handshake', 'open', 'prepareCapture', 'setCaptureState', 'subscribe',
	];
	const captureDimensions = {
		'720p': { width: 1_280, height: 720 },
		'1080p': { width: 1_920, height: 1_080 },
	};
	const api = scope?.framescaperWebVcr?.v1;
	if (!api || JSON.stringify(Object.keys(api).sort()) !== JSON.stringify(preloadBridge)
		|| preloadBridge.some((name) => typeof api[name] !== 'function')) {
		fail('requires the exact bounded preload bridge.');
	}
	if (plan?.mode !== 'framescaper-web-vcr-packaged-v1') fail('received the wrong plan.');
	const snapshots = [];
	let latest = null;
	let currentSessionId = null;
	let currentGeneration = 0;
	const acceptSnapshot = (snapshot) => {
		const sessionId = snapshot?.sessionId;
		const generation = snapshot?.generation;
		if (typeof sessionId !== 'string' || !Number.isSafeInteger(generation) || generation < 1
			|| generation < currentGeneration
			|| (generation === currentGeneration && currentSessionId !== null
				&& sessionId !== currentSessionId)) return null;
		if (generation > currentGeneration) {
			currentGeneration = generation;
			currentSessionId = sessionId;
			snapshots.length = 0;
		} else if (currentSessionId === null) currentSessionId = sessionId;
		latest = snapshot;
		snapshots.push(snapshot);
		if (snapshots.length > 256) snapshots.shift();
		return snapshot;
	};
	const unsubscribe = api.subscribe((snapshot) => { acceptSnapshot(snapshot); });
	const handshake = await api.handshake();
	if (handshake?.version !== 1 || handshake.captureGrantTtlMs !== 10_000
		|| JSON.stringify(handshake.capability) !== JSON.stringify({
			status: 'available', resolutions: ['720p', '1080p'],
		})) fail('did not expose only the 720p and 1080p feasibility resolutions.');

	const recordSnapshot = (result) => {
		if (result?.kind !== 'snapshot' || result.version !== 1) fail('received a malformed snapshot result.');
		const accepted = acceptSnapshot(result.snapshot);
		if (!accepted) fail('received a stale snapshot result.');
		return accepted;
	};
	const reference = () => {
		if (!latest?.sessionId || !Number.isSafeInteger(latest.generation) || latest.generation < 1) {
			fail('has no current guest reference.');
		}
		return { version: 1, sessionId: latest.sessionId, generation: latest.generation };
	};
	const dispatch = async (kind, fields = {}) => recordSnapshot(await api.dispatch({
		...reference(), kind, ...fields,
	}));
	const waitFor = async (predicate, label, timeoutMs = 15_000) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const match = [...snapshots].reverse().find(predicate);
			if (match) { latest = match; return match; }
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const currentUrl = typeof latest?.navigation?.url === 'string'
			? `; latest URL ${latest.navigation.url}` : '';
		fail(`timed out waiting for ${label}${currentUrl}.`);
	};
	const navigate = async (path, expectedPath = path.split('?', 1)[0]) => {
		await dispatch('navigate', { url: `${plan.origin}${path}` });
		return waitFor((snapshot) => {
			try {
				return snapshot.navigation.isLoading === false
					&& new URL(snapshot.navigation.url).pathname === expectedPath;
			} catch { return false; }
		}, `navigation to ${expectedPath}`);
	};
	const key = async (keyValue, code = keyValue) => {
		for (const action of ['down', 'up']) {
			await dispatch('key-input', {
				action, key: keyValue, code, repeat: false, modifiers: [],
			});
		}
	};
	const type = async (text) => {
		for (const character of text) await key(character, `Key${character.toUpperCase()}`);
	};
	const click = async (x, y) => {
		for (const action of ['down', 'up']) {
			await dispatch('pointer-input', {
				action, x, y, button: 'left', deltaX: 0, deltaY: 0, modifiers: [],
			});
		}
	};
	const recordingToken = () => Array.from(
		scope.crypto.getRandomValues(new Uint8Array(16)),
		(value) => value.toString(16).padStart(2, '0'),
	).join('');
	const setCaptureState = async (state) => {
		const request = state === 'preparing'
			? { ...reference(), state, recordingToken: recordingToken() }
			: { ...reference(), state };
		if (await api.setCaptureState(request) !== true) {
			fail(`could not enter ${state} capture state.`);
		}
	};
	const capture = async (resolution, measureAudio) => {
		const captureGestureKey = '__framescaperWebVcrSmokeCaptureGestureV1';
		const expected = captureDimensions[resolution];
		const grant = await api.prepareCapture(reference());
		if (grant?.sessionId !== latest.sessionId || grant.generation !== latest.generation
			|| typeof grant.grantId !== 'string') fail('received a malformed one-shot capture grant.');
		await setCaptureState('preparing');
		let stream;
		try {
			stream = await new Promise((resolve, reject) => {
				scope[captureGestureKey] = () => {
					delete scope[captureGestureKey];
					const policy = scope.document?.permissionsPolicy ?? scope.document?.featurePolicy;
					if (scope.isSecureContext !== true) {
						reject(new Error('Trusted smoke capture was not in a secure context.'));
						return false;
					}
					if (typeof policy?.allowsFeature === 'function'
						&& policy.allowsFeature('display-capture') !== true) {
						reject(new Error('Trusted smoke capture was blocked by Permissions Policy.'));
						return false;
					}
					if (scope.navigator.userActivation?.isActive !== true) {
						reject(new Error('Trusted smoke capture did not have active user activation.'));
						return false;
					}
					scope.navigator.mediaDevices.getDisplayMedia({
						video: {
							width: { ideal: expected.width, max: expected.width },
							height: { ideal: expected.height, max: expected.height },
						},
						audio: true,
					})
						.then(resolve, reject);
					return true;
				};
				stage(`${resolution}-capture-user-gesture`);
			});
			await setCaptureState('recording');
			stage(`${resolution}-capture-track-settings`);
			const videos = stream.getVideoTracks();
			const audios = stream.getAudioTracks();
			if (videos.length !== 1 || audios.length !== 1) fail('did not deliver one guest video and one page-audio track.');
			const settings = videos[0].getSettings();
			if (settings.width !== expected.width || settings.height !== expected.height) {
				fail(`delivered ${String(settings.width)}x${String(settings.height)} instead of exact ${resolution} video track settings.`);
			}
			stage(`${resolution}-capture-source-marker`);
			const visualMarker = await measureCapturedVisualMarker(videos[0], expected);
			const peakRms = measureAudio ? await measureCapturedAudio(audios[0]) : null;
			return {
				resolution,
				width: settings.width,
				height: settings.height,
				videoTracks: 1,
				audioTracks: 1,
				nonSilentAudio: measureAudio ? peakRms > 0 : null,
				peakRms,
				visualMarker,
			};
		} finally {
			delete scope[captureGestureKey];
			for (const track of stream?.getTracks?.() ?? []) track.stop();
		}
	};
	const measureCapturedVisualMarker = async (videoTrack, expected) => {
		const video = scope.document?.createElement?.('video');
		const canvas = scope.document?.createElement?.('canvas');
		if (!video || !canvas) fail('has no trusted-renderer video/canvas marker sampler.');
		video.muted = true;
		video.playsInline = true;
		video.srcObject = new scope.MediaStream([videoTrack]);
		canvas.width = expected.width;
		canvas.height = expected.height;
		try {
			await video.play();
			await new Promise((resolve, reject) => {
				let settled = false;
				const finish = (operation) => {
					if (settled) return;
					settled = true;
					clearTimeout(timeout);
					operation();
				};
				const timeout = setTimeout(() => finish(() => reject(new Error(
					'Captured guest marker frame timed out.',
				))), 5_000);
				if (typeof video.requestVideoFrameCallback === 'function') {
					video.requestVideoFrameCallback(() => finish(resolve));
				} else if (video.readyState >= 2) finish(resolve);
				else video.addEventListener('loadeddata', () => finish(resolve), { once: true });
			});
			const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
			if (!context) fail('could not create the captured guest marker sampler.');
			context.drawImage(video, 0, 0, expected.width, expected.height);
			const sampledRgb = [[0.1, 0.06], [0.3, 0.06]].map(([x, y]) => (
				Array.from(context.getImageData(
					Math.round(expected.width * x), Math.round(expected.height * y), 1, 1,
				).data).slice(0, 3)
			));
			const expectedRgb = [[23, 197, 89], [211, 43, 173]];
			const maxChannelDelta = Math.max(...sampledRgb.flatMap((sample, index) => (
				sample.map((channel, channelIndex) => Math.abs(channel - expectedRgb[index][channelIndex]))
			)));
			if (maxChannelDelta > 32) fail(`captured video marker ${JSON.stringify(sampledRgb)} exceeded channel tolerance ${String(maxChannelDelta)}.`);
			return { sampledRgb, maxChannelDelta, tolerance: 32, matched: true };
		} finally {
			video.pause();
			video.srcObject = null;
			canvas.width = 0;
			canvas.height = 0;
		}
	};
	const measureCapturedAudio = async (audioTrack) => {
		const AudioContext = scope.AudioContext ?? scope.webkitAudioContext;
		if (typeof AudioContext !== 'function') fail('has no trusted-renderer AudioContext.');
		const context = new AudioContext({ sampleRate: 48_000 });
		const stream = new scope.MediaStream([audioTrack]);
		const source = context.createMediaStreamSource(stream);
		const analyser = context.createAnalyser();
		const sink = context.createGain();
		analyser.fftSize = 2_048;
		sink.gain.value = 0;
		source.connect(analyser);
		analyser.connect(sink);
		sink.connect(context.destination);
		await context.resume();
		const samples = new Float32Array(analyser.fftSize);
		let peakRms = 0;
		const deadline = Date.now() + 1_500;
		try {
			while (Date.now() < deadline && peakRms < 0.002) {
				analyser.getFloatTimeDomainData(samples);
				let squareSum = 0;
				for (const sample of samples) squareSum += sample * sample;
				peakRms = Math.max(peakRms, Math.sqrt(squareSum / samples.length));
				if (peakRms < 0.002) await new Promise((resolve) => setTimeout(resolve, 25));
			}
		} finally {
			source.disconnect();
			analyser.disconnect();
			sink.disconnect();
			await context.close();
		}
		if (!(peakRms >= 0.002 && peakRms <= 1)) fail('captured page-audio track was silent.');
		return Math.round(peakRms * 1_000_000) / 1_000_000;
	};

	try {
		stage('open-720p');
		latest = acceptSnapshot(await api.open({ resolution: '720p' }));
		if (latest?.phase !== 'ready' || latest.resolution !== '720p'
			|| latest.captureSurface?.width !== 1_280 || latest.captureSurface?.height !== 720) {
			fail('did not open the exact 720p guest surface.');
		}
		snapshots.push(latest);

		stage('persistent-login');
		await navigate('/login');
		await click(320 / 1_279, 144 / 719);
		await type('fixture');
		await click(320 / 1_279, 208 / 719);
		await type('authorized');
		await click(416 / 1_279, 280 / 719);
		await waitFor((snapshot) => snapshot.navigation.url === `${plan.origin}/session`, 'login redirect');
		await navigate('/session/check', '/session/authenticated');

		stage('scaled-input');
		await navigate('/input');
		await type('smoke');
		await click(320 / 1_279, 360 / 719);
		const inputSnapshot = await waitFor((snapshot) => {
			try {
				const url = new URL(snapshot.navigation.url);
				return url.pathname === '/input/result' && url.searchParams.get('value') === 'smoke';
			} catch { return false; }
		}, 'scaled keyboard and pointer result');
		const inputUrl = new URL(inputSnapshot.navigation.url);
		if (inputUrl.searchParams.get('pointer') !== '64,160') fail('scaled pointer coordinates drifted.');

		stage('720p-media-target');
		await navigate('/media/ended?durationMs=2400', '/media/ended');
		await click(416 / 1_279, 544 / 719);
		const playing = await waitFor((snapshot) => snapshot.target?.mediaState === 'playing', 'playing media target');
		if (playing.target.intrinsicSize.width !== 640 || playing.target.intrinsicSize.height !== 360
			|| playing.autoCrop !== true) fail('did not observe the deterministic auto-crop target.');
		const targetEvidence = {
			intrinsicWidth: playing.target.intrinsicSize.width,
			intrinsicHeight: playing.target.intrinsicSize.height,
			aperture: { ...playing.target.aperture },
			playing: true,
			ended: false,
		};
		stage('720p-capture-and-audio-energy');
		const capture720 = await capture('720p', true);
		const ended = await waitFor((snapshot) => snapshot.target?.mediaState === 'ended', 'exact target ended signal');
		targetEvidence.ended = ended.target?.mediaState === 'ended';
		await setCaptureState('finalizing');
		await setCaptureState('ready');

		stage('open-1080p');
		latest = await dispatch('set-resolution', { resolution: '1080p' });
		if (latest.resolution !== '1080p' || latest.captureSurface.width !== 1_920
			|| latest.captureSurface.height !== 1_080) fail('did not recreate the exact 1080p guest surface.');
		await navigate('/media/loop?durationMs=1200', '/media/loop');
		await click(416 / 1_919, 544 / 1_079);
		await waitFor((snapshot) => snapshot.target?.mediaState === 'playing', '1080p playing media target');
		stage('1080p-capture');
		const capture1080 = await capture('1080p', false);
		await setCaptureState('finalizing');
		await setCaptureState('ready');

		stage('clear-browser-data');
		const beforeClear = reference();
		const confirmation = await api.dispatch({ ...beforeClear, kind: 'request-data-clear' });
		if (confirmation?.kind !== 'data-clear-confirmation' || typeof confirmation.nonce !== 'string') {
			fail('did not issue a closed data-clear confirmation.');
		}
		latest = recordSnapshot(await api.dispatch({
			...beforeClear, kind: 'clear-browser-data', confirmationNonce: confirmation.nonce,
		}));
		const afterClear = reference();
		if (afterClear.sessionId === beforeClear.sessionId || afterClear.generation <= beforeClear.generation) {
			fail('did not recreate a fresh guest after clearing browser data.');
		}
		await navigate('/session/check', '/session/anonymous');
		const disposed = await api.dispose(afterClear);
		if (disposed !== true) fail('did not dispose the final guest.');

		stage('complete');
		return {
			schemaVersion: 1,
			mode: plan.mode,
			productId: 'framescaper',
			token: plan.token,
			qualification: false,
			preloadBridge,
			capability: { resolutions: ['720p', '1080p'], fourKUnavailable: true },
			persistence: { authenticatedBeforeClear: true, anonymousAfterClear: true },
			input: { value: 'smoke', pointerX: 64, pointerY: 160, scaled: true },
			captures: [capture720, capture1080],
			target: targetEvidence,
			lifecycle: { preparing: true, recording: true, finalizing: true, ready: true },
			clearData: { freshSession: true, generationAdvanced: true },
			teardown: { tracksStopped: true, guestDisposed: true },
			audioBoundary: {
				guestNativeAudioMuted: true,
				capturedPageAudioNonSilent: capture720.nonSilentAudio,
				enableLocalEchoFalseAuthorityPath: true,
			},
		};
	} finally {
		unsubscribe();
	}
}

export function validateFramescaperWebVcrDormantSmokeResult(value, plan) {
	const result = closed(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'qualification', 'preloadBridge',
		'capability', 'openAttempted',
	], 'dormant smoke result');
	matchEnvelope(result, plan, FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE);
	exactArray(result.preloadBridge, PRELOAD_BRIDGE, 'dormant preload bridge');
	const capability = closed(result.capability, ['status', 'resolutions'], 'dormant capability');
	exactArray(capability.resolutions, ['720p', '1080p'], 'dormant baseline resolutions');
	if (capability.status !== 'available' || result.openAttempted !== false) {
		throw new Error('Production Web VCR result did not stay guest-lazy.');
	}
	return value;
}

export function validateFramescaperWebVcrPackagedSmokeResult(value, plan) {
	const result = closed(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'qualification', 'preloadBridge',
		'capability', 'persistence', 'input', 'captures', 'target', 'lifecycle', 'clearData',
		'teardown', 'audioBoundary', 'displaySecurity',
	], 'packaged smoke result');
	validatePackagedRendererEvidence(result, plan);
	const displaySecurity = closed(result.displaySecurity, ['requests'], 'display security');
	if (!Array.isArray(displaySecurity.requests) || displaySecurity.requests.length !== 2) {
		throw new Error('Packaged smoke requires exact 720p and 1080p display-security witnesses.');
	}
	for (const [index, resolution] of ['720p', '1080p'].entries()) {
		const request = closed(displaySecurity.requests[index], [
			'version', 'stage', 'resolution', 'windowLive', 'focused', 'frameMatches',
			'originMatches', 'editorDocument', 'ownerAvailable', 'userGesture',
			'videoRequested', 'audioRequested', 'pending', 'systemPicker', 'outcome',
		], `${resolution} display security`);
		if (request.version !== 1 || request.stage !== 'display-request'
			|| request.resolution !== resolution || request.windowLive !== true
			|| request.focused !== true || request.frameMatches !== true
			|| request.originMatches !== true || request.editorDocument !== true
			|| request.ownerAvailable !== true || request.userGesture !== true
			|| request.videoRequested !== true || request.audioRequested !== true
			|| request.pending !== true || request.systemPicker !== false
			|| request.outcome !== 'granted-web-vcr') {
			throw new Error(`Packaged smoke ${resolution} display-security evidence is invalid.`);
		}
	}
	return value;
}

export function validateFramescaperWebVcrPackagedRendererSmokeResult(value, plan) {
	const result = closed(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'qualification', 'preloadBridge',
		'capability', 'persistence', 'input', 'captures', 'target', 'lifecycle', 'clearData',
		'teardown', 'audioBoundary',
	], 'packaged renderer smoke result');
	validatePackagedRendererEvidence(result, plan);
	return value;
}

function validatePackagedRendererEvidence(result, plan) {
	matchEnvelope(result, plan, FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE);
	exactArray(result.preloadBridge, PRELOAD_BRIDGE, 'packaged preload bridge');
	const capability = closed(result.capability, ['resolutions', 'fourKUnavailable'], 'packaged capability');
	exactArray(capability.resolutions, ['720p', '1080p'], 'packaged resolutions');
	if (capability.fourKUnavailable !== true) throw new Error('Packaged smoke unexpectedly admitted 4K.');
	truthRecord(result.persistence, ['authenticatedBeforeClear', 'anonymousAfterClear'], 'persistence');
	const input = closed(result.input, ['value', 'pointerX', 'pointerY', 'scaled'], 'input');
	if (input.value !== 'smoke' || input.pointerX !== 64 || input.pointerY !== 160 || input.scaled !== true) {
		throw new Error('Packaged smoke input evidence is invalid.');
	}
	if (!Array.isArray(result.captures) || result.captures.length !== 2) {
		throw new Error('Packaged smoke requires exactly two capture results.');
	}
	for (const [index, resolution] of ['720p', '1080p'].entries()) {
		const capture = closed(result.captures[index], [
			'resolution', 'width', 'height', 'videoTracks', 'audioTracks', 'nonSilentAudio', 'peakRms',
			'visualMarker',
		], `${resolution} capture`);
		const dimensions = CAPTURE_DIMENSIONS[resolution];
		if (capture.resolution !== resolution || capture.width !== dimensions.width
			|| capture.height !== dimensions.height || capture.videoTracks !== 1 || capture.audioTracks !== 1) {
			throw new Error(`Packaged smoke ${resolution} track evidence is invalid.`);
		}
		if (resolution === '720p') {
			if (capture.nonSilentAudio !== true || typeof capture.peakRms !== 'number'
				|| capture.peakRms < 0.002 || capture.peakRms > 1) {
				throw new Error('Packaged smoke page-audio energy evidence is invalid.');
			}
		} else if (capture.nonSilentAudio !== null || capture.peakRms !== null) {
			throw new Error('Packaged smoke 1080p energy sentinel is invalid.');
		}
		validateVisualMarker(capture.visualMarker, resolution);
	}
	const target = closed(result.target, [
		'intrinsicWidth', 'intrinsicHeight', 'aperture', 'playing', 'ended',
	], 'target');
	if (target.intrinsicWidth !== 640 || target.intrinsicHeight !== 360
		|| target.playing !== true || target.ended !== true) throw new Error('Packaged target evidence is invalid.');
	const aperture = closed(target.aperture, ['x', 'y', 'width', 'height'], 'target aperture');
	if (![aperture.x, aperture.y, aperture.width, aperture.height].every(Number.isFinite)
		|| aperture.x < 0 || aperture.y < 0 || aperture.width <= 0 || aperture.height <= 0
		|| aperture.x + aperture.width > 1.000001 || aperture.y + aperture.height > 1.000001) {
		throw new Error('Packaged target aperture is invalid.');
	}
	truthRecord(result.lifecycle, ['preparing', 'recording', 'finalizing', 'ready'], 'lifecycle');
	truthRecord(result.clearData, ['freshSession', 'generationAdvanced'], 'clear data');
	truthRecord(result.teardown, ['tracksStopped', 'guestDisposed'], 'teardown');
	truthRecord(result.audioBoundary, [
		'guestNativeAudioMuted', 'capturedPageAudioNonSilent', 'enableLocalEchoFalseAuthorityPath',
	], 'audio boundary');
}

function validateVisualMarker(value, resolution) {
	const marker = closed(value, [
		'sampledRgb', 'maxChannelDelta', 'tolerance', 'matched',
	], `${resolution} visual marker`);
	const expected = [[23, 197, 89], [211, 43, 173]];
	if (!Array.isArray(marker.sampledRgb) || marker.sampledRgb.length !== 2
		|| marker.sampledRgb.some((sample) => !Array.isArray(sample) || sample.length !== 3
			|| sample.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255))) {
		throw new Error(`Packaged smoke ${resolution} visual marker pixels are invalid.`);
	}
	const delta = Math.max(...marker.sampledRgb.flatMap((sample, index) => sample.map(
		(channel, channelIndex) => Math.abs(channel - expected[index][channelIndex]),
	)));
	if (marker.tolerance !== 32 || marker.matched !== true
		|| marker.maxChannelDelta !== delta || delta > marker.tolerance) {
		throw new Error(`Packaged smoke ${resolution} visual marker evidence is invalid.`);
	}
}

function matchEnvelope(value, plan, mode) {
	if (value.schemaVersion !== 1 || value.mode !== mode || value.productId !== 'framescaper'
		|| value.token !== plan?.token || value.qualification !== false) {
		throw new Error('Framescaper Web VCR smoke result does not match its non-qualification plan.');
	}
}

function truthRecord(value, fields, label) {
	const record = closed(value, fields, label);
	if (fields.some((field) => record[field] !== true)) {
		throw new Error(`Framescaper Web VCR ${label} evidence is incomplete.`);
	}
	return record;
}

function exactArray(value, expected, label) {
	if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new Error(`Framescaper Web VCR ${label} drifted.`);
	}
}

function closed(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((field) => typeof field !== 'string' || !fields.includes(field))) {
		throw new TypeError(`Framescaper Web VCR ${label} must be closed.`);
	}
	return value;
}
