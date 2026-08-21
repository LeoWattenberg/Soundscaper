/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	referenceFor,
	runtime,
	target,
	targetIdentity,
} from './desktop-framescaper-web-vcr-runtime-fixture.ts';

const OWNER = Object.freeze(Object.create(null)) as object;
const RECORDING_TOKEN = 'e'.repeat(32);

test('runtime stays roadmap-gated unless qualification is injected and opens an exact isolated guest', async () => {
	const gated = runtime({ qualified: false });
	assert.deepEqual(gated.value.handshake(), {
		version: 1,
		capability: { status: 'unavailable', reason: 'roadmap-gate', detail: null },
		captureGrantTtlMs: 10_000,
	});
	await assert.rejects(() => gated.value.open(OWNER, { resolution: '1080p' }), /unavailable|gate/iu);
	assert.equal(gated.windows.length, 0);

	const harness = runtime();
	const snapshot = await harness.value.open(OWNER, { resolution: '1080p' });
	assert.equal(snapshot.phase, 'ready');
	assert.match(snapshot.sessionId ?? '', /^[a-f0-9]{32}$/u);
	assert.deepEqual(harness.windowOptions[0], {
		show: false,
		width: 1920,
		height: 1080,
		useContentSize: true,
		webPreferences: {
			partition: 'persist:framescaper-web-vcr-v1',
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			backgroundThrottling: false,
			offscreen: { deviceScaleFactor: 1 },
		},
	});
	assert.equal('preload' in (harness.windowOptions[0] as { webPreferences: object }).webPreferences, false);
	assert.deepEqual(harness.windows[0]?.loaded, ['about:blank']);
	assert.deepEqual(harness.windows[0]?.audioMuted, [true], 'the trusted captured-track clone is the sole monitor path');
	assert.equal(harness.observerStarts, 1);
	await assert.rejects(() => harness.value.open(OWNER, { resolution: '4k' }), /qualified|resolution/iu);
});

test('runtime maps canonical normalized input and locks browser mutation to host capture state', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	await harness.value.dispatch(OWNER, {
		version: 1, sessionId: reference.sessionId, generation: reference.generation,
		kind: 'navigate', url: 'https://example.com/watch',
	});
	await harness.value.dispatch(OWNER, {
		version: 1, sessionId: reference.sessionId, generation: reference.generation,
		kind: 'pointer-input', action: 'down', x: 0.5, y: 0.25, button: 'left',
		deltaX: 0, deltaY: 0, modifiers: ['shift'],
	});
	await harness.value.dispatch(OWNER, {
		version: 1, sessionId: reference.sessionId, generation: reference.generation,
		kind: 'key-input', action: 'down', key: 'Enter', code: 'Enter', repeat: false, modifiers: [],
	});
	assert.deepEqual(harness.windows[0]?.loaded, ['about:blank', 'https://example.com/watch']);
	assert.deepEqual(harness.windows[0]?.input, [
		{ type: 'mouseDown', x: 960, y: 270, button: 'left', clickCount: 1, modifiers: ['shift'] },
		{ type: 'keyDown', keyCode: 'Enter', isAutoRepeat: false, modifiers: [] },
	]);
	await harness.value.dispatch(OWNER, {
		...reference, kind: 'key-input', action: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [],
	});
	assert.deepEqual(harness.windows[0]?.input.slice(-2), [
		{ type: 'keyDown', keyCode: 'a', isAutoRepeat: false, modifiers: [] },
		{ type: 'char', keyCode: 'a' },
	]);
	await harness.value.dispatch(OWNER, {
		...reference, kind: 'key-input', action: 'down', key: 'c', code: 'KeyC',
		repeat: false, modifiers: ['control'],
	});
	assert.deepEqual(harness.windows[0]?.input.at(-1), {
		type: 'keyDown', keyCode: 'c', isAutoRepeat: false, modifiers: ['control'],
	}, 'control chords never inject a text char event');

	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recording' }), false);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), false);
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		...reference, kind: 'pointer-input', action: 'move', x: 0.5, y: 0.5,
		button: 'none', deltaX: 0, deltaY: 0, modifiers: [],
	}), /capture|locked/iu);
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		...reference, kind: 'set-auto-stop', enabled: true,
	}), /capture|locked/iu);
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		version: 1, sessionId: reference.sessionId, generation: reference.generation,
		kind: 'navigate', url: 'https://example.com/blocked-during-record',
	}), /capture|locked/iu);
	assert.equal(harness.windows[0]?.openWindow('https://login.example.com/').action, 'deny');
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recording' }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'ready' }), false);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'finalizing' }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'ready' }), true);
	assert.equal(harness.windows[0]?.openWindow('https://login.example.com/').action, 'allow');
});

test('active navigation attempts recover and target identity freezes until exact ended', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const navigationGeneration = opened.navigation.generation;
	const firstTarget = target('a', 'playing', { x: 0.1, y: 0.2, width: 0.8, height: 0.6 });
	harness.observe({
		navigationGeneration,
		selection: { kind: 'target', target: firstTarget, visibleArea: 100 },
		targets: [targetIdentity(firstTarget)],
		endedTarget: null,
	});
	assert.deepEqual(harness.snapshots.at(-1)?.crop, firstTarget.aperture,
		'auto-crop publishes the selected target aperture');
	const manual = await harness.value.dispatch(OWNER, { ...reference, kind: 'set-auto-crop', enabled: false });
	if (manual.kind !== 'snapshot') assert.fail('snapshot expected');
	assert.deepEqual(manual.snapshot.crop, { x: 0, y: 0, width: 1, height: 1 });
	const automatic = await harness.value.dispatch(OWNER, { ...reference, kind: 'set-auto-crop', enabled: true });
	if (automatic.kind !== 'snapshot') assert.fail('snapshot expected');
	assert.deepEqual(automatic.snapshot.crop, firstTarget.aperture);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	harness.observe({
		navigationGeneration,
		selection: { kind: 'manual', reason: 'no-playing-video' },
		targets: [targetIdentity(firstTarget, 'paused')],
		endedTarget: null,
	});
	assert.deepEqual(harness.snapshots.at(-1)?.target?.aperture, firstTarget.aperture,
		'geometry remains frozen for the same target identity');
	assert.deepEqual(harness.snapshots.at(-1)?.crop, firstTarget.aperture);
	harness.observe({
		navigationGeneration,
		selection: { kind: 'manual', reason: 'no-playing-video' },
		targets: [targetIdentity(firstTarget, 'ended')],
		endedTarget: {
			targetId: firstTarget.targetId,
			generation: firstTarget.generation,
			endedRecordingToken: RECORDING_TOKEN,
		},
	});
	assert.equal(harness.snapshots.at(-1)?.target?.mediaState, 'ended');
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recording' }), true);
	let prevented = false;
	harness.windows[0]?.emitContent('will-navigate', {
		preventDefault: () => { prevented = true; },
	}, 'https://example.com/replacement');
	assert.equal(prevented, true);
	assert.equal(harness.snapshots.at(-1)?.phase, 'recovery');
	assert.match(harness.snapshots.at(-1)?.failure ?? '', /navigation/iu);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'ready' }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), false);
});

test('a changed active target enters recovery and Electron positional navigation does not double bump', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const navigation = await harness.value.dispatch(OWNER, {
		...reference, kind: 'navigate', url: 'https://example.com/watch',
	});
	if (navigation.kind !== 'snapshot') assert.fail('snapshot expected');
	assert.equal(navigation.snapshot.navigation.generation, opened.navigation.generation + 1);
	const firstTarget = target('b', 'playing', { x: 0.2, y: 0.1, width: 0.6, height: 0.8 });
	harness.observe({
		navigationGeneration: navigation.snapshot.navigation.generation,
		selection: { kind: 'target', target: firstTarget, visibleArea: 100 },
		targets: [targetIdentity(firstTarget)],
		endedTarget: null,
	});
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	const replacement = target('c', 'playing', { x: 0, y: 0, width: 1, height: 1 });
	harness.observe({
		navigationGeneration: navigation.snapshot.navigation.generation,
		selection: {
			kind: 'target', target: replacement,
			visibleArea: 100,
		},
		targets: [targetIdentity(replacement)],
		endedTarget: null,
	});
	assert.equal(harness.snapshots.at(-1)?.phase, 'recovery');
	assert.match(harness.snapshots.at(-1)?.failure ?? '', /target/iu);
	assert.deepEqual(harness.snapshots.at(-1)?.crop, firstTarget.aperture,
		'target loss never falls back to a full-viewport recovery crop');
	harness.observe({
		navigationGeneration: navigation.snapshot.navigation.generation,
		selection: { kind: 'target', target: replacement, visibleArea: 100 },
		targets: [targetIdentity(replacement)], endedTarget: null,
	});
	assert.deepEqual(harness.snapshots.at(-1)?.crop, firstTarget.aperture,
		'recovery remains frozen through later observer publications');
});

test('subframe and same-document navigation cannot replace or recover the frozen top-level page', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const navigated = await harness.value.dispatch(OWNER, {
		...reference, kind: 'navigate', url: 'https://example.com/watch',
	});
	if (navigated.kind !== 'snapshot') assert.fail('snapshot expected');
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recording' }), true);
	const frozenNavigation = harness.snapshots.at(-1)?.navigation;
	let subframeRedirectPrevented = false;
	harness.windows[0]?.emitContent('will-redirect', {
		url: 'https://frame.example.com/redirect', isMainFrame: false, isSameDocument: false,
		preventDefault: () => { subframeRedirectPrevented = true; },
	});
	assert.equal(subframeRedirectPrevented, false);
	harness.windows[0]?.emitContent(
		'did-start-navigation', {}, 'https://frame.example.com/', false, false, 2, 2,
	);
	harness.windows[0]?.emitContent(
		'did-navigate-in-page', {}, 'https://frame.example.com/#next', false, 2, 2,
	);
	harness.windows[0]?.emitContent(
		'did-start-navigation', {}, 'https://example.com/watch#chapter', true, true, 1, 1,
	);
	harness.windows[0]?.emitContent(
		'did-navigate-in-page', {}, 'https://example.com/watch#chapter', true, 1, 1,
	);
	assert.equal(harness.snapshots.at(-1)?.phase, 'recording');
	assert.deepEqual(harness.snapshots.at(-1)?.navigation, frozenNavigation);
	harness.windows[0]?.emitContent('did-start-navigation', {}, {
		url: 'https://example.com/replacement', isMainFrame: true, isSameDocument: false,
	});
	assert.equal(harness.snapshots.at(-1)?.phase, 'recovery');
});

test('top-level loading clears the old target and cannot arm capture or survive a failed load', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const oldTarget = target('d', 'playing', { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
	harness.observe({
		navigationGeneration: opened.navigation.generation,
		selection: { kind: 'target', target: oldTarget, visibleArea: 100 },
		targets: [targetIdentity(oldTarget)], endedTarget: null,
	});
	harness.windows[0]?.emitContent('did-start-navigation', {
		url: 'https://example.com/next', isMainFrame: true, isSameDocument: false,
	});
	assert.equal(harness.snapshots.at(-1)?.navigation.isLoading, true);
	assert.equal(harness.snapshots.at(-1)?.target, null);
	assert.deepEqual(harness.snapshots.at(-1)?.crop, { x: 0, y: 0, width: 1, height: 1 });
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), false);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /settled|idle/iu);
	harness.windows[0]?.emitContent(
		'did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://example.com/next', true, 1, 1,
	);
	assert.equal(harness.snapshots.at(-1)?.phase, 'failed');
	assert.equal(harness.snapshots.at(-1)?.target, null);

	const rejected = runtime();
	const rejectedOpen = await rejected.value.open(OWNER, { resolution: '1080p' });
	rejected.windows[0]!.failNextLoad = true;
	await assert.rejects(() => rejected.value.dispatch(OWNER, {
		...referenceFor(rejectedOpen), kind: 'navigate', url: 'https://example.com/rejected',
	}), /guest load failed/iu);
	assert.equal(rejected.snapshots.at(-1)?.phase, 'failed');
	assert.equal(rejected.snapshots.at(-1)?.target, null);
});

test('the committed final HTTPS redirect remains authoritative after loadURL resolves', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	harness.windows[0]!.redirectNextTo = 'https://example.com/session/authenticated';
	const result = await harness.value.dispatch(OWNER, {
		...referenceFor(opened), kind: 'navigate', url: 'https://example.com/session/check',
	});
	if (result.kind !== 'snapshot') assert.fail('snapshot expected');
	assert.equal(result.snapshot.navigation.url, 'https://example.com/session/authenticated');
	assert.equal(harness.snapshots.at(-1)?.navigation.url, 'https://example.com/session/authenticated');
});

test('runtime prepares reusable preview grants and the sole display handler receives the guest frame', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '720p' });
	const reference = referenceFor(opened);
	await harness.value.dispatch(OWNER, { ...reference, kind: 'set-monitor-muted', muted: true });
	await harness.value.dispatch(OWNER, { ...reference, kind: 'set-monitor-muted', muted: false });
	assert.deepEqual(harness.windows[0]?.audioMuted, [true], 'monitor state never unmutes native guest audio');
	const first = harness.value.prepareCapture(OWNER, reference);
	assert.equal(first.expiresAtMs, 11_000);
	assert.deepEqual(harness.value.captureAuthority.consumeCurrent(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: true,
	}), {
		video: harness.windows[0]?.webContents.mainFrame,
		audio: harness.windows[0]?.webContents.mainFrame,
		enableLocalEcho: false,
	});
	const second = harness.value.prepareCapture(OWNER, reference);
	assert.notEqual(second.grantId, first.grantId);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /idle|visible/iu);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recording' }), true);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /idle|visible/iu);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'finalizing' }), true);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /idle|visible/iu);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'ready' }), true);
	harness.value.prepareCapture(OWNER, reference);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recovery' }), true);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /idle|visible/iu);
	assert.equal(harness.value.captureAuthority.hasPending(OWNER), false);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'ready' }), true);
});

test('runtime bounds popups and destroys all contents before confirmed browser data clearing', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const primary = harness.windows[0]!;
	for (let index = 0; index < 4; index += 1) {
		const decision = primary.openWindow(`https://login${String(index)}.example.com/`);
		assert.equal(decision.action, 'allow');
		if (index === 0) assert.deepEqual(decision.overrideBrowserWindowOptions, {
			show: true, width: 520, height: 640, useContentSize: true,
			webPreferences: {
				partition: 'persist:framescaper-web-vcr-v1', sandbox: true, contextIsolation: true,
				nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true,
				allowRunningInsecureContent: false,
			},
		});
		primary.createPopup(harness.createWindow({}), `https://login${String(index)}.example.com/`);
	}
	assert.equal(primary.openWindow('https://overflow.example.com/').action, 'deny');
	const request = await harness.value.dispatch(OWNER, {
		...reference, kind: 'request-data-clear',
	});
	assert.equal(request.kind, 'data-clear-confirmation');
	if (request.kind !== 'data-clear-confirmation') assert.fail('confirmation expected');
	const cleared = await harness.value.dispatch(OWNER, {
		...reference, kind: 'clear-browser-data', confirmationNonce: request.nonce,
	});
	assert.equal(cleared.kind, 'snapshot');
	if (cleared.kind !== 'snapshot') assert.fail('snapshot expected');
	assert.equal(cleared.snapshot.phase, 'ready');
	assert.equal(cleared.snapshot.generation, reference.generation + 1);
	assert.notEqual(cleared.snapshot.sessionId, reference.sessionId);
	assert.deepEqual(harness.windows.at(-1)?.loaded, ['about:blank']);
	assert.deepEqual(harness.events.slice(-8), [
		'destroy:window-2', 'destroy:window-3', 'destroy:window-4', 'destroy:window-5',
		'destroy:window-1', 'clear-auth', 'clear-cache', 'clear-storage',
	]);
});

test('an invalid clear nonce leaves the live session and observer usable', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	await harness.value.dispatch(OWNER, { ...reference, kind: 'request-data-clear' });
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		...reference, kind: 'clear-browser-data', confirmationNonce: 'f'.repeat(32),
	}), /confirmation/iu);
	assert.equal(harness.windows[0]?.destroyed, false);
	const expiring = await harness.value.dispatch(OWNER, { ...reference, kind: 'request-data-clear' });
	if (expiring.kind !== 'data-clear-confirmation') assert.fail('confirmation expected');
	harness.advance(30_000);
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		...reference, kind: 'clear-browser-data', confirmationNonce: expiring.nonce,
	}), /expired/iu);
	const reloaded = await harness.value.dispatch(OWNER, { ...reference, kind: 'reload' });
	assert.equal(reloaded.kind, 'snapshot');
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), false);
	assert.equal(harness.observerDisposals, 0);
});

test('a browser-data clear failure leaves the destroyed session closed and explicitly reopenable', async () => {
	const harness = runtime({ clearFailure: true });
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	const confirmation = await harness.value.dispatch(OWNER, { ...reference, kind: 'request-data-clear' });
	if (confirmation.kind !== 'data-clear-confirmation') assert.fail('confirmation expected');
	await assert.rejects(() => harness.value.dispatch(OWNER, {
		...reference, kind: 'clear-browser-data', confirmationNonce: confirmation.nonce,
	}), /clear storage failed/iu);
	assert.equal(harness.windows[0]?.destroyed, true);
	assert.equal(harness.value.captureAuthority.hasPending(OWNER), false);
	assert.equal(harness.snapshots.at(-1)?.phase, 'closed');
	assert.equal(harness.snapshots.at(-1)?.generation, opened.generation);
	await assert.rejects(() => harness.value.dispatch(OWNER, { ...reference, kind: 'reload' }), /stale|session/iu);
	const reopened = await harness.value.open(OWNER, { resolution: '1080p' });
	assert.equal(reopened.phase, 'ready');
	assert.equal(reopened.generation, opened.generation + 1);
});

test('closing a hidden active guest defers destruction until finalization reaches ready', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'preparing', recordingToken: RECORDING_TOKEN }), true);
	await harness.value.dispatch(OWNER, { ...reference, kind: 'set-visibility', visible: false });
	assert.equal(harness.windows[0]?.destroyed, false);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /idle|visible/iu);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'recording' }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'finalizing' }), true);
	assert.equal(await harness.value.setCaptureState(OWNER, { ...reference, state: 'ready' }), true);
	assert.equal(harness.windows[0]?.destroyed, true);
	assert.equal(harness.snapshots.at(-1)?.phase, 'closed');
	assert.equal(harness.snapshots.at(-1)?.generation, opened.generation);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /stale|session/iu);
});

test('a failed guest cannot mint a raw capture grant', async () => {
	const harness = runtime();
	const opened = await harness.value.open(OWNER, { resolution: '1080p' });
	const reference = referenceFor(opened);
	harness.windows[0]?.emitContent('render-process-gone');
	assert.equal(harness.snapshots.at(-1)?.phase, 'failed');
	assert.equal(harness.windows[0]?.destroyed, true);
	assert.throws(() => harness.value.prepareCapture(OWNER, reference), /idle|visible/iu);
});

test('an initial guest load failure is terminalized and a later open creates a fresh session', async () => {
	const harness = runtime({ openFailure: true });
	await assert.rejects(
		() => harness.value.open(OWNER, { resolution: '1080p' }),
		/guest load failed/iu,
	);
	assert.equal(harness.windows[0]?.destroyed, true);
	assert.equal(harness.snapshots.at(-1)?.phase, 'closed');
	assert.equal(harness.snapshots.at(-1)?.generation, 1);
	assert.equal(harness.value.captureAuthority.hasPending(OWNER), false);
	const reopened = await harness.value.open(OWNER, { resolution: '1080p' });
	assert.equal(reopened.phase, 'ready');
	assert.equal(reopened.generation, 2);
	assert.equal(harness.windows[1]?.destroyed, false);
});
