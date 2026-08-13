/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createDesktopSmokeProbe, parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';
import {
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
	createDesktopVideoTimingProbeStorageProfile,
	createDesktopVideoTimingProbePlan,
	decodeDesktopVideoTimingProbePlan,
	encodeDesktopVideoTimingProbePlan,
	validateDesktopVideoTimingProbeResult,
} from '../desktop/video-timing-probe-smoke.js';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

const PRODUCT_ID = 'soundscaper';
const TOKEN = '0123456789abcdef0123456789abcdef';

test('packaged timing-probe storage profiles preserve product-local isolation', () => {
	assert.deepEqual(createDesktopVideoTimingProbeStorageProfile('soundscaper'), {
		productId: 'soundscaper',
		databaseName: 'kw-media-audio-editor',
		opfsDirectoryName: 'audio-editor-sources',
	});
	assert.deepEqual(createDesktopVideoTimingProbeStorageProfile('framescaper'), {
		productId: 'framescaper',
		databaseName: 'kw-media-framescaper-editor-v18',
		opfsDirectoryName: 'framescaper-editor-v18-sources',
	});
	assert.throws(
		() => createDesktopVideoTimingProbeStorageProfile('Framescaper'),
		/product.*invalid/iu,
	);
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
				return structuredClone(timingResult(plan));
			},
		},
	};
	probe.attach(window);
	assert.deepEqual(probe.resolveOpenPaths({ purpose: 'media', multiple: true }), plan.fixtures.map(({ path }) => path));
	assert.throws(() => probe.resolveOpenPaths({ purpose: 'media', multiple: true }), /already consumed/iu);
	await probe.rendererReady();
	assert.equal(executions.length, 1);
	assert.equal(executions[0].userGesture, true);
	assert.ok(executions[0].source.endsWith(
		`, ${JSON.stringify(createDesktopVideoTimingProbeStorageProfile(PRODUCT_ID))})`,
	));
	assert.match(logs[0], /^SOUNDSCAPER_DESKTOP_VIDEO_TIMING_PROBE /u);
	assert.deepEqual(exits, [0]);
});

test('Framescaper packaged timing probe executes against the exact V18 storage profile', async () => {
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
				return structuredClone(timingResult(plan));
			},
		},
	});
	await probe.rendererReady();
	assert.equal(executions.length, 1);
	assert.ok(executions[0].endsWith(
		`, ${JSON.stringify(createDesktopVideoTimingProbeStorageProfile('framescaper'))})`,
	));
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
