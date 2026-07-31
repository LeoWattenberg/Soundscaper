/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
	DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX,
	decodeScapeReopenSmokePlan,
	encodeScapeReopenSmokePlan,
	runScapeReopenRendererSmoke,
	validateScapeReopenRendererResult,
	validateScapeReopenSmokePlan,
	validateScapeReopenSmokeResult,
} from '../desktop/scape-reopen-smoke.js';
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
	assert.deepEqual(result, rendererResult());
	assert.equal(fixture.zoomClicks, 0, 'already-ready PCM does not trigger unnecessary zoom');
	assert.equal(fixture.polls, 0);
	assert.deepEqual(validateScapeReopenRendererResult(result, PLAN), result);
	for (const invalid of [
		{ ...result, sharedProject: { ...result.sharedProject, sourceCount: 2 } },
		{ ...result, renderer: { ...result.renderer, projectId: 'other-project' } },
		{ ...result, renderer: { ...result.renderer, waveformRenderer: 'canvas' } },
		{ ...result, renderer: { ...result.renderer, waveformSource: 'peaks' } },
		{ ...result, renderer: { ...result.renderer, waveformError: true } },
		{ ...result, unexpected: true },
	]) {
		assert.throws(
			() => validateScapeReopenRendererResult(invalid, PLAN),
			/renderer|shared project|project|source|waveform|field/iu,
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

test('desktop descriptor-free reopen lifecycle emits only bounded persistence evidence', async () => {
	const fixture = probeFixture({ execution: Promise.resolve(rendererResult()) });
	fixture.probe.attach(fixture.window);
	assert.equal(fixture.probe.observeProjectDescriptor({ id: 'not-used' }, () => {
		throw new Error('descriptor evidence must not be consulted');
	}), false);
	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [0]);
	assert.deepEqual(fixture.scheduledDelays, [90_000]);
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
			schemaVersion: 9,
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
	};
}

function smokeResult() {
	return { ...PLAN, ...rendererResult() };
}

function sharedProjectDocument(plan, overrides = {}) {
	return JSON.stringify({
		schemaVersion: 9,
		id: plan.project.id,
		title: plan.project.title,
		revision: plan.project.revision,
		sources: [{ id: plan.project.sourceId, kind: 'audio' }],
		tracks: [{ id: plan.project.trackId, type: 'audio', clipIds: [plan.project.clipId] }],
		clips: [{ id: plan.project.clipId, kind: 'audio', sourceId: plan.project.sourceId }],
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
} = {}) {
	let currentReady = ready;
	let polls = 0;
	let zoomClicks = 0;
	let waveformSource = initialWaveformSource;
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
		scapeDesktop: {
			v1: {
				async readSharedProject(projectId) {
					readIds.push(projectId);
					return sharedDocument;
				},
			},
		},
		setTimeout(callback) {
			polls += 1;
			if (becomeReady) currentReady = true;
			callback();
		},
	};
	return {
		readIds,
		scope,
		get polls() { return polls; },
		get zoomClicks() { return zoomClicks; },
	};
}

function probeFixture({ execution }) {
	const logs = [];
	const errors = [];
	const exits = [];
	const scheduledDelays = [];
	const window = fakeWindow(execution);
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
	return { errors, exits, logs, probe, scheduledDelays, window };
}

function fakeWindow(execution) {
	return {
		webContents: {
			once() {},
			executeJavaScript() { return execution; },
		},
	};
}
