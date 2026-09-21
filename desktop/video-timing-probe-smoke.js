/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const DESKTOP_VIDEO_TIMING_PROBE_MODE = 'video-timing-persistence-v1';
export const DESKTOP_VIDEO_TIMING_PROBE_PREFIX = 'SOUNDSCAPER_DESKTOP_VIDEO_TIMING_PROBE';
export const DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS = 120_000;
export const DESKTOP_VIDEO_TIMING_PROBE_EVIDENCE_MAX_BYTES = 16 * 1024;

const MAXIMUM_PLAN_BYTES = 64 * 1024;
const TOKEN = /^[a-f\d]{32}$/u;
const EXPECTED_FIXTURES = Object.freeze([
	Object.freeze({
		id: 'cfr-25fps-mp4-v1',
		kind: 'cfr',
		name: 'timing-probe-cfr-25fps.mp4',
		sourceSha256: '216d2748682d236b45fc6c0712be44acdd4d0b14aa3e714cc67153dcc82a79e2',
		nominalRate: Object.freeze({ num: 25, den: 1 }),
		timescale: 12_800,
		presentationTicks: Object.freeze(Array.from({ length: 22 }, (_value, index) => String(index * 512))),
		finalFrameDurationTicks: '512',
		timingSha256: '8fbec1dace6093dd5015b2f8e9b93fd521269984e4db432d98433c10e06e529d',
	}),
	Object.freeze({
		id: 'vfr-irregular-webm-v1',
		kind: 'vfr',
		name: 'timing-probe-vfr-irregular.webm',
		sourceSha256: '29042248295aa6bfbf7adc0e15a2cfecf716279452073f7410734251aed31ae4',
		nominalRate: Object.freeze({ num: 250, den: 29 }),
		timescale: 1_000,
		presentationTicks: Object.freeze(['0', '30', '200', '245', '542', '602', '830', '879']),
		finalFrameDurationTicks: '49',
		timingSha256: '40e6ddca512c4fba6fa08944709cf3852de3dd49416dfc817304eec8a352ecf7',
	}),
]);
/**
 * Backend-specific nominal rates for the pinned fixtures. The timing body is
 * identical across backends, which read the same container integers. For VFR,
 * FFmpeg estimates a rate from its timestamp histogram; the demuxer reports the
 * track average. Admit their exact rates while keeping the timing digest pinned.
 */
const BACKEND_NOMINAL_RATES = Object.freeze({
	'cfr-25fps-mp4-v1': Object.freeze({
		ffmpeg: Object.freeze({ num: 25, den: 1 }),
		container: Object.freeze({ num: 25, den: 1 }),
	}),
	'vfr-irregular-webm-v1': Object.freeze({
		ffmpeg: Object.freeze({ num: 35, den: 2 }),
		container: Object.freeze({ num: 250, den: 29 }),
	}),
});
const STORAGE_PROFILES = Object.freeze({
	soundscaper: Object.freeze({
		productId: 'soundscaper',
		databaseName: 'kw-media-soundscaper-editor-v1',
		opfsDirectoryName: 'soundscaper-editor-v1-sources',
	}),
	framescaper: Object.freeze({
		productId: 'framescaper',
		databaseName: 'kw-media-framescaper-editor-v1',
		opfsDirectoryName: 'framescaper-editor-v1-sources',
	}),
});

export function createDesktopVideoTimingProbeStorageProfile(productId) {
	return STORAGE_PROFILES[requiredProduct(productId)];
}

export function createDesktopVideoTimingProbePlan(value) {
	const plan = strictRecord(value, ['fixtures', 'mode', 'productId', 'schemaVersion', 'token'], 'plan');
	if (plan.schemaVersion !== 1 || plan.mode !== DESKTOP_VIDEO_TIMING_PROBE_MODE) {
		throw new TypeError('Desktop video timing-probe plan has an unsupported schema or mode');
	}
	const productId = requiredProduct(plan.productId);
	const token = String(plan.token);
	if (!TOKEN.test(token)) throw new TypeError('Desktop video timing-probe token is invalid');
	if (!Array.isArray(plan.fixtures) || plan.fixtures.length !== EXPECTED_FIXTURES.length) {
		throw new TypeError('Desktop video timing-probe plan requires exactly the pinned CFR and VFR fixtures');
	}
	const fixtures = plan.fixtures.map((fixture, index) => validatePlanFixture(fixture, EXPECTED_FIXTURES[index]));
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		productId,
		token,
		fixtures,
	});
}

export function encodeDesktopVideoTimingProbePlan(value) {
	return Buffer.from(canonicalJson(createDesktopVideoTimingProbePlan(value)), 'utf8').toString('base64url');
}

export function decodeDesktopVideoTimingProbePlan(encoded) {
	if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
		throw new TypeError('Desktop video timing-probe plan must use canonical base64url');
	}
	const bytes = Buffer.from(encoded, 'base64url');
	if (bytes.toString('base64url') !== encoded) {
		throw new TypeError('Desktop video timing-probe plan must use canonical base64url');
	}
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) {
		throw new RangeError('Desktop video timing-probe plan exceeds its 64 KiB byte limit');
	}
	const text = bytes.toString('utf8');
	let value;
	try { value = JSON.parse(text); } catch (error) {
		throw new TypeError('Desktop video timing-probe plan is not valid JSON', { cause: error });
	}
	if (canonicalJson(value) !== text) throw new TypeError('Desktop video timing-probe plan must use canonical JSON');
	return createDesktopVideoTimingProbePlan(value);
}

export function validateDesktopVideoTimingProbeResult(value, planValue) {
	const plan = createDesktopVideoTimingProbePlan(planValue);
	const result = strictRecord(value, ['fixtures', 'mode', 'productId', 'schemaVersion', 'token'], 'result');
	if (result.schemaVersion !== 1 || result.mode !== DESKTOP_VIDEO_TIMING_PROBE_MODE
		|| result.productId !== plan.productId || result.token !== plan.token) {
		throw new TypeError('Desktop video timing-probe result does not match its plan');
	}
	if (!Array.isArray(result.fixtures) || result.fixtures.length !== plan.fixtures.length) {
		throw new TypeError('Desktop video timing-probe result requires both fixture observations');
	}
	const fixtures = result.fixtures.map((fixture, index) => validateResultFixture(fixture, plan.fixtures[index]));
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		productId: plan.productId,
		token: plan.token,
		fixtures,
	});
}

export function createDesktopVideoTimingProbeEvidence({ arch, platform, result }, planValue) {
	const plan = createDesktopVideoTimingProbePlan(planValue);
	const validated = validateDesktopVideoTimingProbeResult(result, plan);
	const target = desktopVideoTimingProbeTarget(platform, arch);
	return deepFreeze({
		schemaVersion: 1,
		evidenceType: 'desktop-video-timing-probe',
		mode: validated.mode,
		outcome: 'passed',
		productId: validated.productId,
		target,
		storageProfile: createDesktopVideoTimingProbeStorageProfile(validated.productId),
		fixtures: validated.fixtures.map((fixture, index) => ({
			id: fixture.id,
			kind: plan.fixtures[index].kind,
			name: fixture.name,
			sourceSha256: fixture.sourceSha256,
			frameRate: fixture.frameRate,
			sourceFrameCount: fixture.sourceFrameCount,
			timingDecision: fixture.timingDecision,
			timingAsset: fixture.timingAsset,
			presentationTicks: plan.fixtures[index].presentationTicks,
		})),
	});
}

export function formatDesktopVideoTimingProbeEvidence(value) {
	const formatted = `${canonicalJson(value)}\n`;
	if (Buffer.byteLength(formatted, 'utf8') > DESKTOP_VIDEO_TIMING_PROBE_EVIDENCE_MAX_BYTES) {
		throw new RangeError('Desktop video timing-probe evidence exceeds its 16 KiB byte limit');
	}
	return formatted;
}

export function createDesktopVideoTimingProbeFileHarness(planValue) {
	const plan = createDesktopVideoTimingProbePlan(planValue);
	let consumed = false;
	return Object.freeze({
		resolveOpenPaths(choice) {
			if (consumed) throw new Error('Desktop video timing-probe fixture selection was already consumed');
			if (!choice || choice.purpose !== 'media' || choice.multiple !== true) {
				throw new TypeError('Desktop video timing-probe requires the ordinary multi-file media chooser');
			}
			consumed = true;
			return Object.freeze(plan.fixtures.map(({ path }) => path));
		},
	});
}



function desktopVideoTimingProbeTarget(platform, arch) {
	const platformId = {
		darwin: 'macos',
		linux: 'linux',
		win32: 'windows',
	}[platform];
	if (!platformId || (arch !== 'x64' && arch !== 'arm64')) {
		throw new TypeError('Desktop video timing-probe evidence target is invalid');
	}
	return `${platformId}-${arch}`;
}

function validatePlanFixture(value, expected) {
	const fixture = strictRecord(value, [
		'finalFrameDurationTicks', 'id', 'kind', 'name', 'nominalRate', 'path', 'presentationTicks',
		'sourceSha256', 'timescale', 'timingSha256',
	], 'plan fixture');
	const path = requiredText(fixture.path, 'fixture path');
	if (!isAbsolute(path)) throw new TypeError('Desktop video timing-probe fixture path must be absolute');
	const comparable = { ...fixture };
	delete comparable.path;
	if (canonicalJson(comparable) !== canonicalJson(expected)) {
		throw new TypeError(`Desktop video timing-probe plan fixture ${expected.id} does not match its pinned reference`);
	}
	return { ...expected, path };
}

function validateResultFixture(value, expected) {
	const fixture = strictRecord(value, [
		'frameRate', 'id', 'name', 'sourceFrameCount', 'sourceSha256', 'timingAsset', 'timingBytes',
		'timingDecision',
	], 'result fixture');
	if (fixture.id !== expected.id || fixture.name !== expected.name
		|| fixture.sourceSha256 !== expected.sourceSha256
		|| fixture.sourceFrameCount !== expected.presentationTicks.length) {
		throw new Error(`Desktop video timing-probe source metadata does not match ${expected.id}`);
	}
	const decision = strictRecord(fixture.timingDecision, ['backend', 'mode', 'rate'], 'timing decision');
	const nominalRate = BACKEND_NOMINAL_RATES[expected.id]?.[decision.backend];
	if (decision.mode !== 'exact' || nominalRate === undefined
		|| canonicalJson(decision.rate) !== canonicalJson(nominalRate)) {
		throw new Error(`Desktop video timing-probe decision does not match ${expected.id}`);
	}
	if (canonicalJson(fixture.frameRate) !== canonicalJson(nominalRate)) {
		throw new Error(`Desktop video timing-probe source metadata does not match ${expected.id}`);
	}
	const asset = strictRecord(fixture.timingAsset, [
		'byteLength', 'finalFrameDurationTicks', 'frameCount', 'sha256', 'sourceSha256', 'timescale',
	], 'timing asset');
	const expectedByteLength = 32 + expected.presentationTicks.length * 8;
	if (asset.sha256 !== expected.timingSha256 || asset.sourceSha256 !== expected.sourceSha256
		|| asset.frameCount !== expected.presentationTicks.length || asset.timescale !== expected.timescale
		|| asset.finalFrameDurationTicks !== expected.finalFrameDurationTicks
		|| asset.byteLength !== expectedByteLength) {
		throw new Error(`Desktop video timing-probe persisted timing reference does not match ${expected.id}`);
	}
	if (!Array.isArray(fixture.timingBytes) || fixture.timingBytes.length !== expectedByteLength
		|| fixture.timingBytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
		throw new TypeError(`Desktop video timing-probe persisted timing body is invalid for ${expected.id}`);
	}
	const bytes = Uint8Array.from(fixture.timingBytes);
	if (createHash('sha256').update(bytes).digest('hex') !== expected.timingSha256) {
		throw new Error(`Desktop video timing-probe persisted timing body SHA-256 does not match ${expected.id}`);
	}
	const decoded = decodeTimingBody(bytes);
	if (decoded.timescale !== expected.timescale
		|| decoded.finalFrameDurationTicks !== expected.finalFrameDurationTicks
		|| canonicalJson(decoded.presentationTicks) !== canonicalJson(expected.presentationTicks)) {
		throw new Error(`Desktop video timing-probe persisted presentation ticks or duration do not match ${expected.id}`);
	}
	return deepFreeze({
		id: expected.id,
		name: expected.name,
		sourceSha256: expected.sourceSha256,
		frameRate: nominalRate,
		sourceFrameCount: expected.presentationTicks.length,
		timingDecision: { mode: 'exact', backend: decision.backend, rate: nominalRate },
		timingAsset: { ...asset },
		timingBytes: [...bytes],
	});
}

function decodeTimingBody(bytes) {
	if (bytes[0] !== 0x53 || bytes[1] !== 0x43 || bytes[2] !== 0x54 || bytes[3] !== 0x49) {
		throw new TypeError('Desktop video timing-probe timing body magic is invalid');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 32 || view.getBigUint64(24, true) !== 0n) {
		throw new TypeError('Desktop video timing-probe timing body header is invalid');
	}
	const frameCount = view.getUint32(12, true);
	if (bytes.byteLength !== 32 + frameCount * 8) throw new RangeError('Desktop video timing-probe timing body length is invalid');
	return {
		timescale: view.getUint32(8, true),
		finalFrameDurationTicks: String(view.getBigInt64(16, true)),
		presentationTicks: Array.from({ length: frameCount }, (_value, index) => (
			String(view.getBigInt64(32 + index * 8, true))
		)),
	};
}

function strictRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
		throw new TypeError(`Desktop video timing-probe ${label} has unsupported fields or is not a closed object`);
	}
	return value;
}

function requiredProduct(value) {
	if (value !== 'soundscaper' && value !== 'framescaper') {
		throw new TypeError('Desktop video timing-probe product is invalid');
	}
	return value;
}

function requiredText(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) {
		throw new TypeError(`Desktop video timing-probe ${label} is invalid`);
	}
	return value;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}
