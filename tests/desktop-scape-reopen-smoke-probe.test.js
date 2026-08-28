/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
	DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX,
	SOUNDSCAPER_SCAPE_REOPEN_PROJECT_SCHEMA_VERSION,
	decodeScapeReopenSmokePlan,
	encodeScapeReopenSmokePlan,
	runScapeReopenRendererSmoke,
	validateScapeReopenRendererResult,
	validateScapeReopenSmokePlan,
	validateScapeReopenSmokeResult,
} from '../desktop/scape-reopen-smoke.js';
import {
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
} from '../desktop/soundscaper-project-library-contract.ts';
import {
	createDesktopSmokeProbe,
	parseDesktopSmokeConfiguration,
} from '../desktop/desktop-smoke.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const PLAN = Object.freeze({
	schemaVersion: 1,
	mode: 'scape-persistent-reopen-v1',
	productId: 'soundscaper',
	token: TOKEN,
	project: Object.freeze({
		id: 'packaged-scape-open-project',
		title: 'Packaged Scape Open',
		revision: 7,
		sourceId: 'packaged-source',
		trackId: 'packaged-track',
		clipId: 'packaged-clip',
	}),
});

test('persisted-reopen plans use one closed canonical descriptor-free contract', () => {
	const encoded = encodeScapeReopenSmokePlan(PLAN);
	assert.deepEqual(decodeScapeReopenSmokePlan(encoded), PLAN);
	assert.deepEqual(validateScapeReopenSmokePlan(structuredClone(PLAN)), PLAN);
	assert.equal(Object.isFrozen(decodeScapeReopenSmokePlan(encoded)), true);
	assert.equal(Object.isFrozen(decodeScapeReopenSmokePlan(encoded).project), true);
	assert.equal(DESKTOP_SCAPE_REOPEN_SMOKE_MODE, PLAN.mode);
	assert.equal(DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX, 'SOUNDSCAPER_DESKTOP_SCAPE_REOPEN_SMOKE');
	assert.equal(
		SOUNDSCAPER_SCAPE_REOPEN_PROJECT_SCHEMA_VERSION,
		SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	);
	assert.deepEqual(parseDesktopSmokeConfiguration(smokeArgv(encoded)), {
		mode: PLAN.mode,
		plan: PLAN,
	});
	assert.equal(smokeArgv(encoded).some((argument) => /\.scape$|_desktop\/read|capability/iu.test(argument)), false);

	for (const invalid of [
		null,
		{ ...PLAN, schemaVersion: 2 },
		{ ...PLAN, mode: 'scape-range-open-v1' },
		{ ...PLAN, productId: 'framescaper' },
		{ ...PLAN, token: TOKEN.toUpperCase() },
		{ ...PLAN, archive: { name: 'project.scape' } },
		{ ...PLAN, project: { ...PLAN.project, revision: -1 } },
		{ ...PLAN, project: { ...PLAN.project, sourceId: '' } },
		{ ...PLAN, project: { ...PLAN.project, unknown: true } },
	]) {
		assert.throws(
			() => validateScapeReopenSmokePlan(invalid),
			/plan|schema|mode|Soundscaper|token|field|revision|project/iu,
		);
	}
	assert.throws(() => decodeScapeReopenSmokePlan('not+base64'), /base64url/iu);
	assert.throws(() => decodeScapeReopenSmokePlan(`${encoded}=`), /base64url/iu);
	const nonCanonical = Buffer.from(JSON.stringify(PLAN), 'utf8').toString('base64url');
	assert.throws(() => decodeScapeReopenSmokePlan(nonCanonical), /canonical/iu);
});

test('renderer rereads the canonical source-bearing project and proves its exact PCM waveform UI', async () => {
	const fixture = rendererFixture(PLAN, { ready: true });
	const serialized = Function(`"use strict"; return (${runScapeReopenRendererSmoke.toString()});`)();
	const result = await serialized(fixture.scope, PLAN);

	assert.deepEqual(fixture.readIds, [PLAN.project.id]);
	assert.equal(fixture.connectCalls, 1);
	assert.deepEqual(result, rendererResult());
	assert.equal(fixture.zoomClicks, 0, 'already-ready PCM does not trigger unnecessary zoom');
	assert.equal(fixture.polls, 0);
	assert.equal(fixture.playClicks, 1);
	assert.equal(fixture.stopClicks, 1);
	assert.equal(fixture.animationFrames, 2);
	assert.deepEqual(validateScapeReopenRendererResult(result, PLAN), result);
	for (const invalid of [
		{ ...result, sharedProject: { ...result.sharedProject, schemaFamily: 'framescaper' } },
		{ ...result, sharedProject: { ...result.sharedProject, sourceCount: 2 } },
		{ ...result, renderer: { ...result.renderer, projectId: 'other-project' } },
		{ ...result, renderer: { ...result.renderer, waveformRenderer: 'canvas' } },
		{ ...result, renderer: { ...result.renderer, waveformSource: 'peaks' } },
		{ ...result, renderer: { ...result.renderer, waveformError: true } },
		{ ...result, playback: { ...result.playback, meterAboveFloor: false } },
		{ ...result, playback: { ...result.playback, deviceId: 1 } },
		{ ...result, unexpected: true },
	]) {
		assert.throws(
			() => validateScapeReopenRendererResult(invalid, PLAN),
			/renderer|shared project|project|source|waveform|playback|field/iu,
		);
	}
});

test('renderer uses the exact bounded Zoom In control if summary peaks precede PCM', async () => {
	const fixture = rendererFixture(PLAN, { initialWaveformSource: 'peaks' });
	const result = await runScapeReopenRendererSmoke(fixture.scope, PLAN);

	assert.deepEqual(result, rendererResult());
	assert.equal(fixture.zoomClicks, 8);
	assert.equal(fixture.polls, 8);
});

test('renderer rejects missing, noncanonical, drifted, and relationally invalid shared projects', async () => {
	const valid = sharedProjectDocument(PLAN);
	for (const [document, pattern] of [
		[null, /persisted shared project.*unavailable/iu],
		[` ${valid}`, /canonical/iu],
		[sharedProjectDocument(PLAN, { schemaFamily: 'framescaper' }), /identity|descriptor/iu],
		[sharedProjectDocument(PLAN, { title: 'Drifted title' }), /identity|descriptor/iu],
		[sharedProjectDocument(PLAN, { sources: [] }), /exactly one source/iu],
		[sharedProjectDocument(PLAN, { clips: [{ id: PLAN.project.clipId, sourceId: 'other-source', type: 'audio' }] }), /clip.*source/iu],
		[sharedProjectDocument(PLAN, { tracks: [{ id: PLAN.project.trackId, clipIds: [], type: 'audio' }] }), /track.*clip/iu],
	]) {
		const fixture = rendererFixture(PLAN, { sharedDocument: document });
		await assert.rejects(() => runScapeReopenRendererSmoke(fixture.scope, PLAN), pattern);
	}
});

test('renderer polling is bounded and refuses alert, dialog, and waveform-error states', async () => {
	let now = 0;
	const missing = rendererFixture(PLAN, {
		ready: false,
		now: () => { now += 30_000; return now; },
		becomeReady: false,
	});
	await assert.rejects(
		() => runScapeReopenRendererSmoke(missing.scope, PLAN),
		/timed out.*persisted project UI/iu,
	);
	for (const options of [
		{ alertCount: 1, ready: true },
		{ dialogCount: 1, ready: true },
		{ ready: true, waveformError: 'PCM read failed' },
	]) {
		await assert.rejects(
			() => runScapeReopenRendererSmoke(rendererFixture(PLAN, options).scope, PLAN),
			/alert|dialog|waveform error/iu,
		);
	}
});

test('renderer bounds exact Zoom In actions when summary peaks never advance to PCM', async () => {
	const fixture = rendererFixture(PLAN, {
		initialWaveformSource: 'peaks',
		ready: true,
		zoomClicksUntilPcm: Number.POSITIVE_INFINITY,
	});
	await assert.rejects(
		() => runScapeReopenRendererSmoke(fixture.scope, PLAN),
		/did not reach PCM rendering/iu,
	);
	assert.equal(fixture.zoomClicks, 12);
});

test('renderer playback proof fails closed for missing controls and incomplete active evidence', async () => {
	await assert.rejects(
		() => runScapeReopenRendererSmoke(rendererFixture(PLAN, {
			missingPlaybackControl: 'stop',
			ready: true,
		}).scope, PLAN),
		/playback controls or evidence.*incomplete/iu,
	);
	for (const option of ['meterStaysSilent', 'playheadStaysStill']) {
		const fixture = rendererFixture(PLAN, {
			[option]: true,
			naturalEndFrame: 2,
			ready: true,
		});
		await assert.rejects(
			() => runScapeReopenRendererSmoke(fixture.scope, PLAN),
			/playback ended before evidence completed/iu,
		);
		assert.equal(fixture.playClicks, 1);
		assert.equal(fixture.stopClicks, 0);
	}
	for (const options of [
		{ initialMeterValue: -12 },
		{ initialPlayheadFrame: 1_024 },
	]) {
		const fixture = rendererFixture(PLAN, { ...options, ready: true });
		await assert.rejects(
			() => runScapeReopenRendererSmoke(fixture.scope, PLAN),
			/playback evidence did not begin at its floor and origin/iu,
		);
		assert.equal(fixture.playClicks, 0);
	}
});

test('desktop descriptor-free reopen lifecycle emits only bounded persistence evidence', async () => {
	const fixture = probeFixture({ execution: Promise.resolve(rendererResult()) });
	fixture.probe.attach(fixture.window);
	assert.equal(fixture.probe.observeProjectDescriptor({ id: 'not-used' }, () => {
		throw new Error('descriptor evidence must not be consulted');
	}), false);
	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [0]);
	assert.deepEqual(fixture.scheduledDelays, [90_000]);
	assert.deepEqual(fixture.userGestures, [true]);
	assert.equal(fixture.errors.length, 0);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], new RegExp(`^${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} `, 'u'));
	const payload = JSON.parse(fixture.logs[0].slice(DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX.length + 1));
	assert.deepEqual(payload, smokeResult());
	assert.deepEqual(validateScapeReopenSmokeResult(payload, PLAN), payload);
	assert.doesNotMatch(JSON.stringify(payload), /archive|\.scape|capability|_desktop|soundscaper-app|private/iu);
});

test('desktop persisted-reopen lifecycle fails closed under its own bounded prefix', async () => {
	const fixture = probeFixture({ execution: Promise.resolve({ ...rendererResult(), privatePath: '/tmp/project.scape' }) });
	fixture.probe.attach(fixture.window);
	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [2]);
	assert.equal(fixture.logs.length, 0);
	assert.match(fixture.errors[0], new RegExp(`^${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} failed:`, 'u'));
});

function smokeArgv(encoded = encodeScapeReopenSmokePlan(PLAN)) {
	return [
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${PLAN.mode}`,
		`--soundscaper-smoke-plan=${encoded}`,
	];
}

function rendererResult() {
	return {
		sharedProject: {
			schemaFamily: 'soundscaper',
			schemaVersion: SOUNDSCAPER_SCAPE_REOPEN_PROJECT_SCHEMA_VERSION,
			revision: PLAN.project.revision,
			sourceCount: 1,
			trackCount: 1,
			clipCount: 1,
		},
		renderer: {
			projectId: PLAN.project.id,
			trackCount: 1,
			clipCount: 1,
			activeTabTitle: PLAN.project.title,
			trackId: PLAN.project.trackId,
			clipId: PLAN.project.clipId,
			waveformRenderer: 'audacity',
			waveformSource: 'pcm',
			waveformError: false,
			statusState: 'success',
			alertCount: 0,
			dialogCount: 0,
		},
		playback: {
			transportEntered: true,
			playheadAdvanced: true,
			meterAboveFloor: true,
			transportStopped: true,
		},
	};
}

function smokeResult() {
	return { ...PLAN, ...rendererResult() };
}

function sharedProjectDocument(plan, overrides = {}) {
	return JSON.stringify({
		schemaFamily: 'soundscaper',
		schemaVersion: SOUNDSCAPER_SCAPE_REOPEN_PROJECT_SCHEMA_VERSION,
		id: plan.project.id,
		title: plan.project.title,
		revision: plan.project.revision,
		sources: [{ id: plan.project.sourceId, kind: 'audio' }],
		tracks: [{ id: plan.project.trackId, type: 'audio', clipIds: [plan.project.clipId] }],
		clips: [{ id: plan.project.clipId, kind: 'audio', sourceId: plan.project.sourceId }],
		timelineAnnotations: [],
		...overrides,
	});
}

function rendererFixture(plan, {
	alertCount = 0,
	dialogCount = 0,
	ready = false,
	becomeReady = true,
	waveformError = null,
	sharedDocument = sharedProjectDocument(plan),
	now: suppliedNow = null,
	initialWaveformSource = 'pcm',
	zoomClicksUntilPcm = 8,
	missingPlaybackControl = null,
	meterStaysSilent = false,
	playheadStaysStill = false,
	naturalEndFrame = null,
	initialMeterValue = -60,
	initialPlayheadFrame = 0,
} = {}) {
	let currentReady = ready;
	let polls = 0;
	let zoomClicks = 0;
	let waveformSource = initialWaveformSource;
	let transportState = 'stopped';
	let playheadFrame = initialPlayheadFrame;
	let playheadX = 16;
	let meterValue = initialMeterValue;
	let playClicks = 0;
	let stopClicks = 0;
	let animationFrames = 0;
	let connectCalls = 0;
	const readIds = [];
	const attribute = (values, textContent = '') => ({
		textContent,
		getAttribute: (name) => values[name] ?? null,
	});
	const waveform = {
		getAttribute(name) {
			if (name === 'data-waveform-renderer') return 'audacity';
			if (name === 'data-waveform-source') return waveformSource;
			if (name === 'data-waveform-error') return waveformError;
			return null;
		},
	};
	const zoomIn = {
		click() {
			zoomClicks += 1;
			if (zoomClicks >= zoomClicksUntilPcm) waveformSource = 'pcm';
		},
	};
	const play = {
		disabled: false,
		click() { playClicks += 1; transportState = 'playing'; },
		getAttribute: (name) => name === 'aria-pressed' ? 'false' : name === 'aria-label' ? 'Play' : null,
	};
	const pause = {
		disabled: false,
		getAttribute: (name) => name === 'aria-pressed' ? 'true' : name === 'aria-label' ? 'Pause' : null,
	};
	const stop = {
		disabled: false,
		click() {
			stopClicks += 1;
			transportState = 'stopped';
			playheadFrame = 0;
		},
	};
	const playhead = {
		style: { getPropertyValue: (name) => name === '--playhead-x' ? `${playheadX}px` : '' },
		getAttribute: (name) => name === 'aria-valuenow' ? String(playheadFrame) : null,
	};
	const meter = {
		getAttribute(name) {
			if (name === 'aria-valuemin') return '-60';
			if (name === 'aria-valuenow') return String(meterValue);
			return null;
		},
	};
	const clip = {
		...attribute({ 'data-clip-id': plan.project.clipId }),
		querySelectorAll: (selector) => selector === 'canvas.clip-body__waveform' ? [waveform] : [],
	};
	const track = {
		...attribute({ 'data-track-id': plan.project.trackId, 'data-track-row': '' }),
		querySelectorAll: (selector) => selector === `[data-clip-id="${plan.project.clipId}"]` ? [clip] : [],
	};
	const tab = attribute({ role: 'tab', 'aria-selected': 'true' }, plan.project.title);
	const status = attribute({ 'data-editor-status': '', 'data-state': 'success' }, 'Ready');
	const root = {
		...attribute({
			'data-project-id': plan.project.id,
			'data-track-count': '1',
			'data-clip-count': '1',
		}),
		querySelectorAll(selector) {
			if (!currentReady) return [];
			if (selector === '.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]') return [tab];
			if (selector === '.kw-audio-editor__zoom-actions button[aria-label="Zoom in"]') return [zoomIn];
			if (selector === `[data-track-row][data-track-id="${plan.project.trackId}"]`) return [track];
			if (selector === '[data-editor-status][data-state="success"]') return [status];
			if (selector === '.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button[aria-label="Play"]') {
				return transportState === 'stopped' && missingPlaybackControl !== 'play' ? [play] : [];
			}
			if (selector === '.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button[aria-label="Pause"]') {
				return transportState === 'playing' ? [pause] : [];
			}
			if (selector === '.kw-audio-editor__transport button[aria-label="Stop"]') {
				return missingPlaybackControl === 'stop' ? [] : [stop];
			}
			if (selector === '[data-playhead][role="slider"]') return [playhead];
			if (selector === '[data-side-playback-meter] [data-playback-meter][data-meter-kind="playback"]'
				+ '[data-meter-type="db-log"][data-meter-db-range="60"] [role="meter"]') return [meter];
			return [];
		},
	};
	let time = 0;
	const scope = {
		CSS: { escape: (value) => value },
		Date: { now: suppliedNow ?? (() => { time += 25; return time; }) },
		document: {
			querySelectorAll(selector) {
				if (selector === '[data-audio-editor][data-audio-editor-bound="true"]') {
					return currentReady ? [root] : [];
				}
				if (selector === '[role="alert"], [role="alertdialog"]') return Array(alertCount).fill({});
				if (selector === '[role="dialog"], [role="alertdialog"]') return Array(dialogCount).fill({});
				return [];
			},
		},
		soundscaperProjectLibraryDesktop: {
			v1: {
				async connect() {
					connectCalls += 1;
				},
				async readProjectBundle(projectId) {
					readIds.push(projectId);
					return sharedDocument === null ? null : { document: sharedDocument };
				},
			},
		},
		setTimeout(callback) {
			polls += 1;
			if (becomeReady) currentReady = true;
			callback();
		},
		requestAnimationFrame(callback) {
			animationFrames += 1;
			if (transportState === 'playing') {
				if (!playheadStaysStill) {
					playheadFrame = 1_024;
					playheadX = 32;
				}
				if (!meterStaysSilent) meterValue = -12;
				if (naturalEndFrame !== null && animationFrames >= naturalEndFrame) {
					transportState = 'stopped';
					playheadFrame = 0;
				}
			}
			callback(animationFrames * 16);
		},
	};
	return {
		readIds,
		scope,
		get connectCalls() { return connectCalls; },
		get polls() { return polls; },
		get zoomClicks() { return zoomClicks; },
		get playClicks() { return playClicks; },
		get stopClicks() { return stopClicks; },
		get animationFrames() { return animationFrames; },
	};
}

function probeFixture({ execution }) {
	const logs = [];
	const errors = [];
	const exits = [];
	const scheduledDelays = [];
	const userGestures = [];
	const window = fakeWindow(execution, userGestures);
	const probe = createDesktopSmokeProbe({
		argv: smokeArgv(),
		appName: 'Soundscaper',
		appOrigin: 'soundscaper-app://bundle',
		productId: 'soundscaper',
		exit: async (code) => { exits.push(code); },
		log: (value) => { logs.push(value); },
		reportError: (value) => { errors.push(value); },
		setTimeout: (_callback, delay) => {
			scheduledDelays.push(delay);
			return 1;
		},
		clearTimeout: () => undefined,
	});
	return { errors, exits, logs, probe, scheduledDelays, userGestures, window };
}

function fakeWindow(execution, userGestures) {
	return {
		webContents: {
			once() {},
			executeJavaScript(_script, userGesture) {
				userGestures.push(userGesture);
				return execution;
			},
		},
	};
}
