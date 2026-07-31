/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_SCAPE_OPEN_SMOKE_MODE,
	DESKTOP_SCAPE_OPEN_SMOKE_PREFIX,
	decodeScapeOpenSmokePlan,
	encodeScapeOpenSmokePlan,
	runScapeOpenRendererSmoke,
	validateScapeOpenProjectDescriptor,
	validateScapeOpenRendererResult,
	validateScapeOpenSmokePlan,
	validateScapeOpenSmokeResult,
} from '../desktop/scape-open-smoke.js';
import {
	createDesktopSmokeProbe,
	parseDesktopSmokeConfiguration,
} from '../desktop/desktop-smoke.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const CAPABILITY_ID = 'a'.repeat(64);
const MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const PLAN = Object.freeze({
	schemaVersion: 1,
	mode: 'scape-range-open-v1',
	productId: 'soundscaper',
	token: TOKEN,
	archive: Object.freeze({
		name: 'packaged-current-schema.scape',
		byteLength: 12_345,
	}),
	project: Object.freeze({
		id: 'packaged-scape-open-project',
		title: 'Packaged Scape Open',
		revision: 7,
		sourceId: 'packaged-source',
		trackId: 'packaged-track',
		clipId: 'packaged-clip',
	}),
});

test('Scape-open plans use one closed canonical Soundscaper base64url contract', () => {
	const encoded = encodeScapeOpenSmokePlan(PLAN);
	assert.deepEqual(decodeScapeOpenSmokePlan(encoded), PLAN);
	assert.deepEqual(validateScapeOpenSmokePlan(structuredClone(PLAN)), PLAN);
	assert.equal(Object.isFrozen(decodeScapeOpenSmokePlan(encoded)), true);
	assert.equal(Object.isFrozen(decodeScapeOpenSmokePlan(encoded).archive), true);
	assert.equal(Object.isFrozen(decodeScapeOpenSmokePlan(encoded).project), true);
	assert.equal(DESKTOP_SCAPE_OPEN_SMOKE_MODE, PLAN.mode);
	assert.equal(DESKTOP_SCAPE_OPEN_SMOKE_PREFIX, 'SOUNDSCAPER_DESKTOP_SCAPE_OPEN_SMOKE');
	assert.deepEqual(parseDesktopSmokeConfiguration(smokeArgv(encoded)), {
		mode: PLAN.mode,
		plan: PLAN,
	});

	for (const invalid of [
		null,
		{ ...PLAN, schemaVersion: 2 },
		{ ...PLAN, mode: 'artifact' },
		{ ...PLAN, productId: 'framescaper' },
		{ ...PLAN, token: TOKEN.toUpperCase() },
		{ ...PLAN, path: '/private/project.scape' },
		{ ...PLAN, archive: { ...PLAN.archive, name: '../project.scape' } },
		{ ...PLAN, archive: { ...PLAN.archive, name: 'project.zip' } },
		{ ...PLAN, archive: { ...PLAN.archive, byteLength: 0 } },
		{ ...PLAN, project: { ...PLAN.project, revision: -1 } },
		{ ...PLAN, project: { ...PLAN.project, sourceId: '' } },
		{ ...PLAN, project: { ...PLAN.project, unknown: true } },
	]) {
		assert.throws(
			() => validateScapeOpenSmokePlan(invalid),
			/plan|schema|mode|Soundscaper|token|field|archive|name|byte|revision|project/iu,
		);
	}
	assert.throws(() => decodeScapeOpenSmokePlan('not+base64'), /base64url/iu);
	assert.throws(() => decodeScapeOpenSmokePlan(`${encoded}=`), /base64url/iu);
	const nonCanonical = Buffer.from(JSON.stringify(PLAN), 'utf8').toString('base64url');
	assert.throws(() => decodeScapeOpenSmokePlan(nonCanonical), /canonical/iu);
});

test('standalone renderer poll proves exact active project, timeline identities, and clean success UI', async () => {
	const fixture = rendererDocumentFixture(PLAN);
	const serialized = Function(`"use strict"; return (${runScapeOpenRendererSmoke.toString()});`)();
	const result = await serialized(fixture.scope, PLAN);

	assert.deepEqual(result, rendererResult());
	assert.equal(fixture.polls, 1, 'the routine polls until the project-open UI becomes ready');
	assert.deepEqual(validateScapeOpenRendererResult(result, PLAN), result);
	for (const invalid of [
		{ ...result, projectId: 'other-project' },
		{ ...result, trackCount: 2 },
		{ ...result, activeTabTitle: 'Other title' },
		{ ...result, clipId: 'other-clip' },
		{ ...result, statusState: 'info' },
		{ ...result, alertCount: 1 },
		{ ...result, dialogCount: 1 },
		{ ...result, unexpected: true },
	]) {
		assert.throws(
			() => validateScapeOpenRendererResult(invalid, PLAN),
			/renderer|project|track|tab|clip|status|alert|dialog|field/iu,
		);
	}
});

test('renderer poll is bounded and refuses alerts or dialogs instead of accepting partial UI', async () => {
	let now = 0;
	const missingScope = {
		document: {
			querySelectorAll: () => [],
		},
		Date: { now: () => { now += 30_000; return now; } },
		setTimeout: (callback) => { callback(); },
	};
	await assert.rejects(
		() => runScapeOpenRendererSmoke(missingScope, PLAN),
		/timed out.*project-open UI/iu,
	);

	const fixture = rendererDocumentFixture(PLAN, { alertCount: 1, ready: true });
	await assert.rejects(
		() => runScapeOpenRendererSmoke(fixture.scope, PLAN),
		/alert|dialog|failed/iu,
	);
});

test('native range descriptor validation proves authority but returns only a pathless summary', () => {
	const descriptor = projectDescriptor();
	assert.deepEqual(validateScapeOpenProjectDescriptor(descriptor, PLAN), {
		readProfile: 'scape-range-v1',
		name: PLAN.archive.name,
		size: PLAN.archive.byteLength,
		mimeType: MIME_TYPE,
	});
	for (const invalid of [
		{ ...descriptor, id: 'b'.repeat(64) },
		{ ...descriptor, url: descriptor.url.replace(CAPABILITY_ID, 'b'.repeat(64)) },
		{ ...descriptor, url: `file:///private/${PLAN.archive.name}` },
		{ ...descriptor, name: 'other.scape' },
		{ ...descriptor, size: PLAN.archive.byteLength + 1 },
		{ ...descriptor, mimeType: 'application/zip' },
		{ ...descriptor, readProfile: 'materialized-v1' },
		{ ...descriptor, path: '/private/project.scape' },
	]) {
		assert.throws(
			() => validateScapeOpenProjectDescriptor(invalid, PLAN),
			/descriptor|capability|URL|name|size|MIME|profile|field/iu,
		);
	}
	assert.doesNotMatch(JSON.stringify(validateScapeOpenProjectDescriptor(descriptor, PLAN)), /aaaa|soundscaper-app|private/iu);
});

test('desktop Scape-open lifecycle proves live delivery, renderer activation, and exact retirement', async () => {
	const descriptor = projectDescriptor();
	let live = true;
	const evidenceCalls = [];
	const execution = Promise.withResolvers();
	const fixture = probeFixture({
		execution: execution.promise,
		wait: async () => { live = false; },
	});
	fixture.probe.attach(fixture.window);
	const running = fixture.probe.rendererReady();
	assert.equal(fixture.probe.observeProjectDescriptor(descriptor, (id) => {
		evidenceCalls.push(id);
		return live ? descriptor : null;
	}), true);
	execution.resolve(rendererResult());
	await running;

	assert.deepEqual(evidenceCalls, [CAPABILITY_ID, CAPABILITY_ID, CAPABILITY_ID]);
	assert.deepEqual(fixture.exits, [0]);
	assert.deepEqual(fixture.scheduledDelays, [90_000]);
	assert.equal(fixture.errors.length, 0);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], new RegExp(`^${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} `, 'u'));
	const payload = JSON.parse(fixture.logs[0].slice(DESKTOP_SCAPE_OPEN_SMOKE_PREFIX.length + 1));
	assert.deepEqual(payload, smokeResult());
	assert.deepEqual(validateScapeOpenSmokeResult(payload, PLAN), payload);
	assert.doesNotMatch(fixture.logs[0], new RegExp(CAPABILITY_ID, 'u'));
	assert.doesNotMatch(JSON.stringify(payload), /soundscaper-app|_desktop|private/iu);
});

test('Scape descriptor observation is smoke-only, synchronous, singular, and failure-closed', async () => {
	const nonSmoke = createDesktopSmokeProbe(probeOptions({ argv: ['/opt/Soundscaper'] }));
	let normalEvidenceCalls = 0;
	assert.equal(nonSmoke.observeProjectDescriptor(projectDescriptor(), () => {
		normalEvidenceCalls += 1;
		return projectDescriptor();
	}), false);
	assert.equal(normalEvidenceCalls, 0);

	const fixture = probeFixture({ execution: Promise.resolve(rendererResult()) });
	fixture.probe.attach(fixture.window);
	assert.throws(
		() => fixture.probe.observeProjectDescriptor(projectDescriptor(), async () => projectDescriptor()),
		/synchronous|Promise/iu,
	);
	assert.equal(fixture.logs.length, 0);

	const failing = probeFixture({ execution: Promise.resolve(rendererResult()) });
	failing.probe.attach(failing.window);
	const descriptor = projectDescriptor();
	failing.probe.observeProjectDescriptor(descriptor, () => descriptor);
	assert.throws(
		() => failing.probe.observeProjectDescriptor(descriptor, () => descriptor),
		/exactly one|already observed/iu,
	);
	await failing.probe.rendererReady();
	assert.deepEqual(failing.exits, [2]);
	assert.equal(failing.logs.length, 0);
	assert.match(failing.errors[0], new RegExp(`^${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} failed:`, 'u'));
});

function smokeArgv(encoded = encodeScapeOpenSmokePlan(PLAN)) {
	return [
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${PLAN.mode}`,
		`--soundscaper-smoke-plan=${encoded}`,
	];
}

function projectDescriptor() {
	return {
		id: CAPABILITY_ID,
		url: `soundscaper-app://bundle/_desktop/read/scape-range-v1/${CAPABILITY_ID}/${PLAN.archive.name}`,
		name: PLAN.archive.name,
		size: PLAN.archive.byteLength,
		mimeType: MIME_TYPE,
		readProfile: 'scape-range-v1',
		lastModified: 1_786_000_000_000,
	};
}

function rendererResult() {
	return {
		projectId: PLAN.project.id,
		trackCount: 1,
		clipCount: 1,
		activeTabTitle: PLAN.project.title,
		trackId: PLAN.project.trackId,
		clipId: PLAN.project.clipId,
		statusState: 'success',
		alertCount: 0,
		dialogCount: 0,
	};
}

function smokeResult() {
	return {
		...PLAN,
		descriptor: {
			readProfile: 'scape-range-v1',
			name: PLAN.archive.name,
			size: PLAN.archive.byteLength,
			mimeType: MIME_TYPE,
			liveBeforeDelivery: true,
			retiredAfterOpen: true,
		},
		renderer: rendererResult(),
	};
}

function rendererDocumentFixture(plan, { alertCount = 0, dialogCount = 0, ready = false } = {}) {
	let currentReady = ready;
	let polls = 0;
	const attribute = (values, textContent = '') => ({
		textContent,
		getAttribute: (name) => values[name] ?? null,
	});
	const clip = attribute({ 'data-clip-id': plan.project.clipId, role: 'button' });
	const track = {
		...attribute({ 'data-track-id': plan.project.trackId, 'data-track-row': '' }),
		querySelectorAll(selector) {
			return selector === `[data-clip-id="${plan.project.clipId}"]` ? [clip] : [];
		},
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
			if (selector === `[data-track-row][data-track-id="${plan.project.trackId}"]`) return [track];
			if (selector === '[data-editor-status][data-state="success"]') return [status];
			return [];
		},
	};
	let now = 0;
	const scope = {
		CSS: { escape: (value) => value },
		Date: { now: () => { now += 25; return now; } },
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
		setTimeout(callback) {
			polls += 1;
			currentReady = true;
			callback();
		},
	};
	return {
		scope,
		get polls() { return polls; },
	};
}

function probeFixture({ execution, wait = async () => {} }) {
	const logs = [];
	const errors = [];
	const exits = [];
	const scheduledDelays = [];
	const window = fakeWindow(execution);
	const probe = createDesktopSmokeProbe(probeOptions({
		argv: smokeArgv(),
		exit: async (code) => { exits.push(code); },
		log: (value) => { logs.push(value); },
		reportError: (value) => { errors.push(value); },
		setTimeout: (_callback, delay) => {
			scheduledDelays.push(delay);
			return 1;
		},
		clearTimeout: () => undefined,
		wait,
		now: (() => {
			let value = 0;
			return () => { value += 25; return value; };
		})(),
	}));
	return { errors, exits, logs, probe, scheduledDelays, window };
}

function probeOptions(overrides = {}) {
	return {
		argv: smokeArgv(),
		appName: 'Soundscaper',
		appOrigin: 'soundscaper-app://bundle',
		productId: 'soundscaper',
		exit: async () => {},
		log: () => {},
		reportError: () => {},
		...overrides,
	};
}

function fakeWindow(execution) {
	const listeners = new Map();
	return {
		webContents: {
			executions: [],
			once(name, listener) { listeners.set(name, listener); },
			executeJavaScript(source) {
				this.executions.push(source);
				return execution;
			},
		},
	};
}
