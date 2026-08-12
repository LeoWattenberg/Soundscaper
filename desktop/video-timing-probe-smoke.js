/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const DESKTOP_VIDEO_TIMING_PROBE_MODE = 'video-timing-persistence-v1';
export const DESKTOP_VIDEO_TIMING_PROBE_PREFIX = 'SOUNDSCAPER_DESKTOP_VIDEO_TIMING_PROBE';
export const DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS = 90_000;

const MAXIMUM_PLAN_BYTES = 64 * 1024;
const TOKEN = /^[a-f\d]{32}$/u;
const EXPECTED_FIXTURES = Object.freeze([
	Object.freeze({
		id: 'cfr-25fps-mp4-v1',
		kind: 'cfr',
		name: 'timing-probe-cfr-25fps.mp4',
		sourceSha256: '28978274c947a886046d7f7bd42f836fb7de2556dc9bac239d950b273b283140',
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
		nominalRate: Object.freeze({ num: 35, den: 2 }),
		timescale: 1_000,
		presentationTicks: Object.freeze(['0', '30', '200', '245', '542', '602', '830', '879']),
		finalFrameDurationTicks: '49',
		timingSha256: '40e6ddca512c4fba6fa08944709cf3852de3dd49416dfc817304eec8a352ecf7',
	}),
]);

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

export async function runDesktopVideoTimingProbeRendererSmoke(scope, plan) {
	const editor = scope.document?.querySelector?.('[data-audio-editor]');
	if (!editor || editor.getAttribute('data-audio-editor-bound') !== 'true') {
		throw new Error('Desktop video timing-probe editor is not ready');
	}
	const decline = [...scope.document.querySelectorAll('button')]
		.find((button) => button.textContent?.trim() === 'Decline');
	decline?.click();
	const readyDeadline = Date.now() + 15_000;
	let importButton = null;
	while (Date.now() < readyDeadline) {
		importButton = scope.document.querySelector('[data-project-bin-import] button');
		if (importButton && !importButton.disabled
			&& editor.querySelector('[data-status]')?.getAttribute('data-state') === 'success') break;
		await new Promise((resolve) => scope.setTimeout(resolve, 50));
	}
	if (!importButton || importButton.disabled) {
		throw new Error('Desktop video timing-probe ordinary Import control is unavailable');
	}
	importButton.click();
	const sourceNames = plan.fixtures.map(({ name }) => name);
	const deadline = Date.now() + 75_000;
	let fixtures = [];
	while (Date.now() < deadline) {
		fixtures = await persistedTimingEvidence(scope, sourceNames);
		if (fixtures.length === sourceNames.length) break;
		await new Promise((resolve) => scope.setTimeout(resolve, 50));
	}
	if (fixtures.length !== sourceNames.length) {
		throw new Error(`Desktop video timing-probe import did not persist both timing bodies: ${editor.querySelector('[data-status]')?.textContent || 'no status'}`);
	}
	return {
		schemaVersion: 1,
		mode: plan.mode,
		productId: plan.productId,
		token: plan.token,
		fixtures: plan.fixtures.map(({ id, name }) => {
			const fixture = fixtures.find((candidate) => candidate.name === name);
			if (!fixture) throw new Error(`Desktop video timing-probe evidence is missing ${id}`);
			return { id, ...fixture };
		}),
	};

	async function persistedTimingEvidence(globalScope, names) {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(globalScope.indexedDB.open('kw-media-audio-editor'));
		try {
			const transaction = database.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
			const [projects, mediaAssets, mediaChunks] = await Promise.all([
				request(transaction.objectStore('projects').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const project = projects.find((candidate) => names.every((name) => (
				candidate.sources?.some((source) => source.name === name)
			)));
			if (!project) return [];
			const evidence = [];
			for (const source of project.sources.filter(({ name }) => names.includes(name))) {
				const record = mediaAssets.find(({ sourceId }) => sourceId === source.timingAsset?.storageKey);
				if (!record) continue;
				const timingBytes = await readMediaAssetBytes(globalScope, record, mediaChunks);
				evidence.push({
					name: source.name,
					sourceSha256: source.contentSha256,
					frameRate: source.frameRate,
					sourceFrameCount: source.sourceFrameCount,
					timingDecision: source.timingDecision,
					timingAsset: {
						sha256: source.timingAsset.sha256,
						sourceSha256: source.timingAsset.sourceSha256,
						frameCount: source.timingAsset.frameCount,
						timescale: source.timingAsset.timescale,
						finalFrameDurationTicks: source.timingAsset.finalFrameDurationTicks,
						byteLength: source.timingAsset.byteLength,
					},
					timingBytes: [...timingBytes],
				});
			}
			return evidence;
		} finally {
			database.close();
		}
	}

	async function readMediaAssetBytes(globalScope, record, mediaChunks) {
		if (record.storage === 'opfs') {
			const root = await globalScope.navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle('audio-editor-sources');
			const handle = await directory.getFileHandle(record.path);
			return new Uint8Array(await (await handle.getFile()).arrayBuffer());
		}
		if (record.blob instanceof globalScope.Blob) return new Uint8Array(await record.blob.arrayBuffer());
		const chunks = mediaChunks
			.filter(({ mediaChunkToken }) => mediaChunkToken === record.mediaChunkToken)
			.sort((left, right) => left.index - right.index);
		const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.payload.size, 0));
		let offset = 0;
		for (const chunk of chunks) {
			const payload = new Uint8Array(await chunk.payload.arrayBuffer());
			bytes.set(payload, offset);
			offset += payload.byteLength;
		}
		return bytes;
	}
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
		|| canonicalJson(fixture.frameRate) !== canonicalJson(expected.nominalRate)
		|| fixture.sourceFrameCount !== expected.presentationTicks.length) {
		throw new Error(`Desktop video timing-probe source metadata does not match ${expected.id}`);
	}
	const decision = strictRecord(fixture.timingDecision, ['backend', 'mode', 'rate'], 'timing decision');
	if (decision.mode !== 'exact' || decision.backend !== 'ffmpeg'
		|| canonicalJson(decision.rate) !== canonicalJson(expected.nominalRate)) {
		throw new Error(`Desktop video timing-probe decision does not match ${expected.id}`);
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
		frameRate: expected.nominalRate,
		sourceFrameCount: expected.presentationTicks.length,
		timingDecision: { mode: 'exact', backend: 'ffmpeg', rate: expected.nominalRate },
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
