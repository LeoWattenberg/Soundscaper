/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createDesktopSmokeProbe, parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';
import {
	DESKTOP_VIDEO_TIMING_PROBE_EVIDENCE_MAX_BYTES,
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
	DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS,
	createDesktopVideoTimingProbeEvidence,
	createDesktopVideoTimingProbeStorageProfile,
	createDesktopVideoTimingProbePlan,
	decodeDesktopVideoTimingProbePlan,
	encodeDesktopVideoTimingProbePlan,
	formatDesktopVideoTimingProbeEvidence,
	runDesktopVideoTimingProbeRendererSmoke,
	validateDesktopVideoTimingProbeResult,
} from '../desktop/video-timing-probe-smoke.js';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';
import {
	FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE,
} from '../src/framescaper/editor-project-storage-profile-v20.ts';
import {
	SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE,
} from '../src/soundscaper/editor-project-storage-profile-v29.ts';
import {
	editorProjectStorageProfileNames,
} from '../src/common/editor/storage/project-storage-profile.ts';

const PRODUCT_ID = 'soundscaper';
const TOKEN = '0123456789abcdef0123456789abcdef';

test('packaged timing probe keeps startup margin outside its renderer deadlines', () => {
	assert.equal(DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS, 120_000);
});

// The probe reads persisted timing straight out of the product's IndexedDB
// database by name. Naming a revision the product has moved off does not fail as
// a wrong name — indexedDB.open() without a version silently creates an empty
// database — so the probe would wait out its full deadline on a store that is
// never written. Deriving the expectation from the profile each product mounts
// makes the next revision flip fail here, in seconds, instead of in the nightly
// packaged run.
test('packaged timing-probe storage profiles are the ones each product mounts', () => {
	const soundscaper = editorProjectStorageProfileNames(SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE);
	const framescaper = editorProjectStorageProfileNames(FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE);
	assert.deepEqual(createDesktopVideoTimingProbeStorageProfile('soundscaper'), {
		productId: 'soundscaper',
		databaseName: soundscaper.databaseName,
		opfsDirectoryName: soundscaper.opfsDirectoryName,
	});
	assert.deepEqual(createDesktopVideoTimingProbeStorageProfile('framescaper'), {
		productId: 'framescaper',
		databaseName: framescaper.databaseName,
		opfsDirectoryName: framescaper.opfsDirectoryName,
	});
	assert.throws(
		() => createDesktopVideoTimingProbeStorageProfile('Framescaper'),
		/product.*invalid/iu,
	);
});

test('packaged timing-probe storage profiles preserve product-local isolation', () => {
	const soundscaper = createDesktopVideoTimingProbeStorageProfile('soundscaper');
	const framescaper = createDesktopVideoTimingProbeStorageProfile('framescaper');
	assert.notEqual(soundscaper.databaseName, framescaper.databaseName);
	assert.notEqual(soundscaper.opfsDirectoryName, framescaper.opfsDirectoryName);
});

test('packaged timing-probe plan is canonical, closed, and pins the browser fixtures', () => {
	const plan = timingPlan();
	assert.deepEqual(decodeDesktopVideoTimingProbePlan(encodeDesktopVideoTimingProbePlan(plan)), plan);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.fixtures[0]), true);
	assert.deepEqual(plan.fixtures.map(({ id, sourceSha256, timingSha256 }) => ({ id, sourceSha256, timingSha256 })),
		videoTimingProbeMedia.map(({ id, sourceSha256, timingSha256 }) => ({ id, sourceSha256, timingSha256 })));
	assert.throws(
		() => decodeDesktopVideoTimingProbePlan(encode({ ...plan, unexpected: true })),
		/closed|unsupported field/iu,
	);
	assert.throws(
		() => decodeDesktopVideoTimingProbePlan(`${encodeDesktopVideoTimingProbePlan(plan)}=`),
		/canonical.*base64url/iu,
	);
	assert.throws(
		() => createDesktopVideoTimingProbePlan({ ...plan, fixtures: [plan.fixtures[0]] }),
		/exactly.*CFR.*VFR|two.*fixtures/iu,
	);
});

test('packaged timing-probe result validates exact source and timing body SHA, ticks, and duration', () => {
	const plan = timingPlan();
	const result = timingResult(plan);
	assert.deepEqual(validateDesktopVideoTimingProbeResult(result, plan), result);

	const bodyDrift = structuredClone(result);
	bodyDrift.fixtures[1].timingBytes[bodyDrift.fixtures[1].timingBytes.length - 1] ^= 1;
	assert.throws(() => validateDesktopVideoTimingProbeResult(bodyDrift, plan), /SHA-256|digest/iu);

	const tickDrift = structuredClone(result);
	const view = new DataView(Uint8Array.from(tickDrift.fixtures[1].timingBytes).buffer);
	view.setBigInt64(32 + 8, 31n, true);
	tickDrift.fixtures[1].timingBytes = [...new Uint8Array(view.buffer)];
	tickDrift.fixtures[1].timingAsset.sha256 = createHash('sha256')
		.update(Uint8Array.from(tickDrift.fixtures[1].timingBytes)).digest('hex');
	assert.throws(() => validateDesktopVideoTimingProbeResult(tickDrift, plan), /timing reference|presentation ticks/iu);

	assert.throws(
		() => validateDesktopVideoTimingProbeResult({ ...result, unexpected: true }, plan),
		/closed|unsupported field/iu,
	);
});

test('packaged timing-probe emits bounded path-free evidence after exact validation', () => {
	const plan = timingPlan('framescaper');
	const result = timingResult(plan);
	const evidence = createDesktopVideoTimingProbeEvidence({
		arch: 'x64',
		platform: 'win32',
		result,
	}, plan);
	assert.deepEqual(evidence, {
		schemaVersion: 1,
		evidenceType: 'desktop-video-timing-probe',
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		outcome: 'passed',
		productId: 'framescaper',
		target: 'windows-x64',
		storageProfile: {
			productId: 'framescaper',
			databaseName: 'kw-media-framescaper-editor-v20',
			opfsDirectoryName: 'framescaper-editor-v20-sources',
		},
		fixtures: plan.fixtures.map((fixture) => ({
			id: fixture.id,
			kind: fixture.kind,
			name: fixture.name,
			sourceSha256: fixture.sourceSha256,
			frameRate: fixture.nominalRate,
			sourceFrameCount: fixture.presentationTicks.length,
			timingDecision: { mode: 'exact', backend: 'ffmpeg', rate: fixture.nominalRate },
			timingAsset: timingResult(plan).fixtures.find(({ id }) => id === fixture.id).timingAsset,
			presentationTicks: fixture.presentationTicks,
		})),
	});
	const encoded = formatDesktopVideoTimingProbeEvidence(evidence);
	assert.deepEqual(JSON.parse(encoded), evidence);
	assert.ok(Buffer.byteLength(encoded, 'utf8') <= DESKTOP_VIDEO_TIMING_PROBE_EVIDENCE_MAX_BYTES);
	assert.equal(encoded.includes(plan.fixtures[0].path), false);
	assert.equal(encoded.includes(plan.token), false);
	assert.equal(encoded.includes('timingBytes'), false);
	assert.throws(
		() => formatDesktopVideoTimingProbeEvidence({
			...evidence,
			oversized: 'x'.repeat(DESKTOP_VIDEO_TIMING_PROBE_EVIDENCE_MAX_BYTES),
		}),
		/exceeds.*byte limit/iu,
	);
	const forged = structuredClone(result);
	forged.fixtures[0].timingAsset.sha256 = '0'.repeat(64);
	assert.throws(
		() => createDesktopVideoTimingProbeEvidence({
			arch: 'x64', platform: 'linux', result: forged,
		}, plan),
		/timing reference/iu,
	);
});

test('timing probe identifies a revision jump before the first import publication', async (context) => {
	let clockReads = 0;
	context.mock.method(Date, 'now', () => (++clockReads < 5 ? clockReads : 100_000));
	const status = {
		state: 'success',
		getAttribute(name) { return name === 'data-state' ? this.state : null; },
		get textContent() { return this.state === 'error'
			? 'The desktop V11 publication is stale against its private revision witness.'
			: 'Ready'; },
	};
	const importButton = {
		disabled: false,
		click() { status.state = 'error'; },
	};
	const catalog = Object.freeze({
		metadataRevision: 7,
		projects: Object.freeze([Object.freeze({ id: 'project-1', revision: 0 })]),
	});
	const database = {
		close() {},
		transaction() {
			return { objectStore: () => ({ getAll: () => successfulRequest([]) }) };
		},
	};
	const editor = {
		getAttribute: (name) => name === 'data-audio-editor-bound' ? 'true' : null,
		querySelector: (selector) => selector === '[data-status]' ? status : null,
	};
	const scope = {
		Blob,
		document: {
			querySelector(selector) {
				if (selector === '[data-audio-editor]') return editor;
				if (selector === '[data-project-bin-import] button') return importButton;
				if (selector === '[data-project-id]') return { getAttribute: () => 'project-1' };
				return null;
			},
			querySelectorAll: () => [],
		},
		indexedDB: { open: () => successfulRequest(database) },
		setTimeout: (resolve) => { resolve(); },
		soundscaperProjectLibraryDesktop: {
			v10: { listProjects: async () => { throw new Error('Historical V10 bridge was consulted'); } },
			v11: { listProjects: async () => catalog },
		},
	};

	await assert.rejects(
		runDesktopVideoTimingProbeRendererSmoke(
			scope,
			timingPlan(),
			createDesktopVideoTimingProbeStorageProfile('soundscaper'),
		),
		(error) => {
			assert.match(error.message, /publication diagnostic/iu);
			assert.match(error.message, /revision-jump-refused-before-first-import-publication/iu);
			assert.match(error.message, /"metadataRevision":7/iu);
			return true;
		},
	);
});

test('desktop smoke routing admits the ordinary media chooser once and emits only a validated result', async () => {
	const plan = timingPlan();
	const argv = [
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_VIDEO_TIMING_PROBE_MODE}`,
		`--soundscaper-smoke-plan=${encodeDesktopVideoTimingProbePlan(plan)}`,
	];
	assert.deepEqual(parseDesktopSmokeConfiguration(argv), { mode: DESKTOP_VIDEO_TIMING_PROBE_MODE, plan });
	const logs = [];
	const exits = [];
	const executions = [];
	const probe = createDesktopSmokeProbe({
		argv,
		appName: 'Soundscaper',
		appOrigin: 'soundscaper-app://bundle',
		productId: PRODUCT_ID,
		exit: async (code) => { exits.push(code); },
		log: (line) => { logs.push(line); },
		setTimeout: () => 1,
		clearTimeout: () => undefined,
	});
	const window = {
		webContents: {
			once: () => undefined,
			async executeJavaScript(source, userGesture) {
				executions.push({ source, userGesture });
				return { status: 'fulfilled', value: structuredClone(timingResult(plan)) };
			},
		},
	};
	probe.attach(window);
	assert.deepEqual(probe.resolveOpenPaths({ purpose: 'media', multiple: true }), plan.fixtures.map(({ path }) => path));
	assert.throws(() => probe.resolveOpenPaths({ purpose: 'media', multiple: true }), /already consumed/iu);
	await probe.rendererReady();
	assert.equal(executions.length, 1);
	assert.equal(executions[0].userGesture, true);
	assert.ok(executions[0].source.includes(
		`, ${JSON.stringify(createDesktopVideoTimingProbeStorageProfile(PRODUCT_ID))})`,
	));
	assert.match(logs[0], /^SOUNDSCAPER_DESKTOP_VIDEO_TIMING_PROBE /u);
	assert.deepEqual(exits, [0]);
});

test('Framescaper packaged timing probe executes against the selected V20 storage profile', async () => {
	const plan = timingPlan('framescaper');
	const executions = [];
	const probe = createDesktopSmokeProbe({
		argv: smokeArgv(plan),
		appName: 'Framescaper',
		appOrigin: 'framescaper-app://bundle',
		productId: 'framescaper',
		exit: async () => undefined,
		log: () => undefined,
		setTimeout: () => 1,
		clearTimeout: () => undefined,
	});
	probe.attach({
		webContents: {
			once: () => undefined,
			async executeJavaScript(source) {
				executions.push(source);
				return { status: 'fulfilled', value: structuredClone(timingResult(plan)) };
			},
		},
	});
	await probe.rendererReady();
	assert.equal(executions.length, 1);
	assert.ok(executions[0].includes(
		`, ${JSON.stringify(createDesktopVideoTimingProbeStorageProfile('framescaper'))})`,
	));
});

test('packaged timing probe preserves renderer failure detail across the Electron boundary', async () => {
	const plan = timingPlan();
	const errors = [];
	const exits = [];
	const probe = createDesktopSmokeProbe({
		argv: smokeArgv(plan),
		appName: 'Soundscaper',
		appOrigin: 'soundscaper-app://bundle',
		productId: PRODUCT_ID,
		exit: async (code) => { exits.push(code); },
		log: () => undefined,
		reportError: (message) => { errors.push(message); },
		setTimeout: () => 1,
		clearTimeout: () => undefined,
	});
	probe.attach({
		webContents: {
			once: () => undefined,
			async executeJavaScript(source) {
				assert.match(source, /error\?\.message/u);
				return { status: 'rejected', message: 'The renderer timing import failed exactly here.' };
			},
		},
	});

	await probe.rendererReady();

	assert.deepEqual(exits, [2]);
	assert.deepEqual(errors, [
		'SOUNDSCAPER_DESKTOP_VIDEO_TIMING_PROBE failed: The renderer timing import failed exactly here.',
	]);
});

function timingPlan(productId = PRODUCT_ID) {
	return createDesktopVideoTimingProbePlan({
		schemaVersion: 1,
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		productId,
		token: TOKEN,
		fixtures: videoTimingProbeMedia.map((fixture) => ({
			id: fixture.id,
			kind: fixture.kind,
			path: `/tmp/${fixture.file.name}`,
			name: fixture.file.name,
			sourceSha256: fixture.sourceSha256,
			nominalRate: fixture.nominalRate,
			timescale: fixture.timescale,
			presentationTicks: fixture.presentationTicks.map(String),
			finalFrameDurationTicks: String(fixture.finalFrameDurationTicks),
			timingSha256: fixture.timingSha256,
		})),
	});
}

function smokeArgv(plan) {
	return [
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_VIDEO_TIMING_PROBE_MODE}`,
		`--soundscaper-smoke-plan=${encodeDesktopVideoTimingProbePlan(plan)}`,
	];
}

function timingResult(plan) {
	return Object.freeze({
		schemaVersion: 1,
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		productId: plan.productId,
		token: plan.token,
		fixtures: plan.fixtures.map((fixture) => {
			const bytes = timingBytes(fixture);
			return {
				id: fixture.id,
				name: fixture.name,
				sourceSha256: fixture.sourceSha256,
				frameRate: fixture.nominalRate,
				sourceFrameCount: fixture.presentationTicks.length,
				timingDecision: { mode: 'exact', backend: 'ffmpeg', rate: fixture.nominalRate },
				timingAsset: {
					sha256: fixture.timingSha256,
					sourceSha256: fixture.sourceSha256,
					frameCount: fixture.presentationTicks.length,
					timescale: fixture.timescale,
					finalFrameDurationTicks: fixture.finalFrameDurationTicks,
					byteLength: bytes.byteLength,
				},
				timingBytes: [...bytes],
			};
		}),
	});
}

function timingBytes(fixture) {
	const bytes = new Uint8Array(32 + fixture.presentationTicks.length * 8);
	bytes.set([0x53, 0x43, 0x54, 0x49]);
	const view = new DataView(bytes.buffer);
	view.setUint16(4, 1, true);
	view.setUint16(6, 32, true);
	view.setUint32(8, fixture.timescale, true);
	view.setUint32(12, fixture.presentationTicks.length, true);
	view.setBigInt64(16, BigInt(fixture.finalFrameDurationTicks), true);
	for (const [index, tick] of fixture.presentationTicks.entries()) {
		view.setBigInt64(32 + index * 8, BigInt(tick), true);
	}
	assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.timingSha256);
	return bytes;
}

function successfulRequest(result) {
	return {
		result,
		set onsuccess(callback) { queueMicrotask(callback); },
		set onerror(_callback) {},
	};
}

function encode(value) {
	return Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}
