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
/**
 * The nominal rate each admitted backend reports for the pinned fixtures.
 *
 * The persisted timing body — timescale, presentation ticks and final frame
 * duration — is identical whichever backend read the file, because both read the
 * same integers out of the same container, and its digest is pinned above. A
 * nominal rate is not one of those integers for variable-rate media: FFmpeg
 * estimates one from its own timestamp histogram, while the container demuxer
 * reports the track average. Admit each backend against the rate it reports
 * rather than loosening the check to whatever arrives.
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
		databaseName: 'kw-media-soundscaper-editor-v30',
		opfsDirectoryName: 'soundscaper-editor-v30-sources',
	}),
	framescaper: Object.freeze({
		productId: 'framescaper',
		databaseName: 'kw-media-framescaper-editor-v31',
		opfsDirectoryName: 'framescaper-editor-v31-sources',
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

export async function runDesktopVideoTimingProbeRendererSmoke(scope, plan, storageProfileValue) {
	const storageProfile = validateStorageProfile(storageProfileValue, plan?.productId);
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
	const activeProjectId = scope.document.querySelector('[data-project-id]')?.getAttribute('data-project-id') ?? null;
	const publicationBefore = await publicationSnapshot(scope, plan.productId);
	importButton.click();
	const sourceNames = plan.fixtures.map(({ name }) => name);
	const deadline = Date.now() + 75_000;
	let fixtures = [];
	let terminalStatus = null;
	while (Date.now() < deadline) {
		fixtures = await persistedTimingEvidence(scope, sourceNames);
		if (fixtures.length === sourceNames.length) break;
		const status = editor.querySelector('[data-status]');
		if (status?.getAttribute('data-state') === 'error') {
			terminalStatus = status.textContent || 'unknown error';
			break;
		}
		await new Promise((resolve) => scope.setTimeout(resolve, 50));
	}
	if (fixtures.length !== sourceNames.length) {
		const status = terminalStatus || editor.querySelector('[data-status]')?.textContent || 'no status';
		const publicationAfter = await publicationSnapshot(scope, plan.productId);
		const diagnostic = publicationDiagnostic(
			activeProjectId, publicationBefore, publicationAfter, status,
		);
		const storage = await storageDiagnostic(scope, sourceNames);
		throw new Error(`Desktop video timing-probe import did not persist both timing bodies: ${status}; publication diagnostic ${JSON.stringify(diagnostic)}; storage diagnostic ${JSON.stringify(storage)}`);
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

	// A desktop save is admitted against the local store but published to the
	// project library, so on that path the document never lands in the renderer's
	// `projects` store. Read it back over the same bridge the editor published
	// through; the timing bodies themselves do stay in the local media stores.
	async function desktopLibraryProject(globalScope, names) {
		const library = desktopProjectLibraryBridge(globalScope, plan.productId);
		if (typeof library?.readProjectBundle !== 'function' || !activeProjectId) return null;
		try {
			const bundle = await library.readProjectBundle(activeProjectId);
			if (!bundle || typeof bundle.document !== 'string') return null;
			const document = JSON.parse(bundle.document);
			return names.every((name) => (
				document?.sources?.some((source) => source?.name === name)
			)) ? document : null;
		} catch {
			return null;
		}
	}

	// Bounded counts only: which stores the product actually wrote, so a probe
	// that finds nothing says whether the import missed the database, the
	// project, or just the timing bodies. No keys, paths or bytes cross this.
	async function storageDiagnostic(globalScope, names) {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		try {
			const database = await request(globalScope.indexedDB.open(storageProfile.databaseName));
			try {
				const stores = [...database.objectStoreNames];
				if (!['projects', 'mediaAssets', 'mediaAssetChunks'].every((name) => stores.includes(name))) {
					return { stores };
				}
				const transaction = database.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
				const [projects, mediaAssets, mediaChunks] = await Promise.all([
					request(transaction.objectStore('projects').getAll()),
					request(transaction.objectStore('mediaAssets').getAll()),
					request(transaction.objectStore('mediaAssetChunks').getAll()),
				]);
				const sources = projects.flatMap((project) => (
					Array.isArray(project?.sources) ? project.sources : []
				));
				return {
					stores,
					projects: projects.length,
					sources: sources.length,
					matchedSources: sources.filter((source) => names.includes(source?.name)).length,
					sourcesWithTimingAsset: sources.filter((source) => Boolean(source?.timingAsset)).length,
					mediaAssets: mediaAssets.length,
					mediaAssetChunks: mediaChunks.length,
				};
			} finally {
				database.close();
			}
		} catch (error) {
			const message = typeof error?.message === 'string' ? error.message : String(error);
			return { error: message.slice(0, 256) };
		}
	}

	async function persistedTimingEvidence(globalScope, names) {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(globalScope.indexedDB.open(storageProfile.databaseName));
		try {
			const transaction = database.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
			const [projects, mediaAssets, mediaChunks] = await Promise.all([
				request(transaction.objectStore('projects').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const project = projects.find((candidate) => names.every((name) => (
				candidate.sources?.some((source) => source.name === name)
			))) ?? await desktopLibraryProject(globalScope, names);
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
			const directory = await root.getDirectoryHandle(storageProfile.opfsDirectoryName);
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

	function desktopProjectLibraryBridge(globalScope, productId) {
		return productId === 'soundscaper'
			? globalScope.soundscaperProjectLibraryDesktop?.v11
			: globalScope.framescaperDesktop?.v1?.projectLibrary;
	}

	async function publicationSnapshot(globalScope, productId) {
		const bridge = desktopProjectLibraryBridge(globalScope, productId);
		if (typeof bridge?.listProjects !== 'function') return null;
		try {
			const snapshot = await bridge.listProjects();
			return {
				metadataRevision: Number.isSafeInteger(snapshot?.metadataRevision)
					? snapshot.metadataRevision : null,
				projects: Array.isArray(snapshot?.projects) ? snapshot.projects.slice(0, 32).map((project) => ({
					id: typeof project?.id === 'string' ? project.id.slice(0, 256) : null,
					revision: Number.isSafeInteger(project?.revision) ? project.revision : null,
				})) : [],
			};
		} catch (error) {
			const message = typeof error?.message === 'string' ? error.message : String(error);
			return { error: message.slice(0, 512) };
		}
	}

	function publicationDiagnostic(projectId, before, after, status) {
		const prior = before?.projects?.find((project) => project.id === projectId) ?? null;
		const current = after?.projects?.find((project) => project.id === projectId) ?? null;
		const desktopLibraryVersion = plan.productId === 'soundscaper' ? 'v11' : 'v19';
		const normalizedStatus = status.toLowerCase();
		const witnessFailure = normalizedStatus.includes(
			`authoritative desktop ${desktopLibraryVersion} load witness`,
		);
		const stalePublication = normalizedStatus.includes(
			`desktop ${desktopLibraryVersion} publication is stale`,
		);
		let classification = 'publication-state-unavailable';
		if (before && after && !before.error && !after.error) {
			if (!prior) classification = 'initial-save-missing';
			else if (after.metadataRevision === before.metadataRevision
				&& current?.revision === prior.revision) {
				classification = stalePublication
					? 'revision-jump-refused-before-first-import-publication'
					: witnessFailure
						? 'witness-missing-before-first-import-publication'
						: 'no-import-publication-committed';
			} else if (after.metadataRevision === before.metadataRevision + 1
				&& current?.revision === prior.revision + 1) {
				classification = witnessFailure
					? 'witness-missing-after-one-import-publication'
					: 'one-import-publication-committed';
			} else classification = 'publication-revision-jump';
		}
		return { activeProjectId: projectId, classification, before, after };
	}

	function validateStorageProfile(value, productId) {
		const fields = ['databaseName', 'opfsDirectoryName', 'productId'];
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| Object.getPrototypeOf(value) !== Object.prototype
			|| Reflect.ownKeys(value).length !== fields.length) {
			throw new TypeError('Desktop video timing-probe storage profile must be a closed object');
		}
		const profile = {};
		for (const field of fields) {
			const descriptor = Object.getOwnPropertyDescriptor(value, field);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`Desktop video timing-probe storage profile ${field} is invalid`);
			}
			profile[field] = descriptor.value;
		}
		const framescaper = productId === 'framescaper';
		if ((!framescaper && productId !== 'soundscaper') || profile.productId !== productId
			|| profile.databaseName !== (framescaper
				? 'kw-media-framescaper-editor-v31' : 'kw-media-soundscaper-editor-v30')
			|| profile.opfsDirectoryName !== (framescaper
				? 'framescaper-editor-v31-sources' : 'soundscaper-editor-v30-sources')) {
			throw new TypeError('Desktop video timing-probe storage profile does not match its product');
		}
		return Object.freeze(profile);
	}
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
