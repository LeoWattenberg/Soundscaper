/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { parseDesktopSmokeConfigurationWithProjectPlan } from './desktop-smoke-configuration.js';
import {
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
	DESKTOP_DIRECT_WAV_SMOKE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS,
	createDirectWavSmokeTargetHarness,
	runDirectWavRendererSmoke,
	validateDirectWavRendererResult,
	validateDirectWavSmokeResult,
} from './direct-wav-smoke.js';
import {
	DESKTOP_SCAPE_OPEN_SMOKE_MODE,
	DESKTOP_SCAPE_OPEN_SMOKE_PREFIX,
	runScapeOpenRendererSmoke,
	validateScapeOpenProjectDescriptor,
	validateScapeOpenRendererResult,
	validateScapeOpenSmokeResult,
} from './scape-open-smoke.js';
import {
	DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
	DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX,
	runScapeReopenRendererSmoke,
	validateScapeReopenRendererResult,
	validateScapeReopenSmokeResult,
} from './scape-reopen-smoke.js';
import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX,
} from './project-library-source-bearing-smoke.js';
import {
	createDesktopProjectLibrarySourceBearingSmokeSession,
} from './project-library-source-bearing-smoke-session.js';
import { runProjectLibraryRendererSmoke } from './project-library-renderer-smoke.js';
export { runProjectLibraryRendererSmoke } from './project-library-renderer-smoke.js';
import {
	createDesktopProjectLibraryLeaseSmokeSession,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX,
} from './project-library-lease-smoke.js';
import { DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION } from './project-library-smoke-project.js';
import {
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
	DESKTOP_VIDEO_TIMING_PROBE_PREFIX,
	DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS,
	createDesktopVideoTimingProbeFileHarness,
	createDesktopVideoTimingProbeStorageProfile,
	runDesktopVideoTimingProbeRendererSmoke,
	validateDesktopVideoTimingProbeResult,
} from './video-timing-probe-smoke.js';

const PROJECT_LIBRARY_MODE = 'project-library-handoff-v1';
const MAXIMUM_PLAN_BYTES = 64 * 1024;
const DIGEST = /^[a-f\d]{64}$/u;
const STAGE_PRODUCTS = Object.freeze({
	publish: 'soundscaper',
	advance: 'framescaper',
	return: 'soundscaper',
});

export const DESKTOP_PROJECT_LIBRARY_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_SMOKE';

const ARTIFACT_SMOKE_SCRIPT = `(async () => ({
	url: location.href,
	title: document.title,
	bridge: Object.keys(window.soundscaperDesktop?.v1 || {}).sort(),
	environment: await window.soundscaperDesktop?.v1?.getEnvironment?.(),
	hasEditor: Boolean(document.querySelector('main')),
	nodeExposed: typeof globalThis.process !== 'undefined' || typeof globalThis.require !== 'undefined',
	saveOwnerReady: await window.soundscaperDesktop?.v1?.beginWrite?.({
		targetId: '0'.repeat(48),
		size: 0,
	}).then(() => false, (error) => /Save target expired or was already used/u.test(String(error?.message || error))),
}))()`;

export function parseDesktopSmokeConfiguration(argv) {
	return parseDesktopSmokeConfigurationWithProjectPlan(argv, decodePlan);
}

export function createDesktopSmokeProbe(options) {
	const configuration = parseDesktopSmokeConfiguration(options?.argv);
	const exit = requiredFunction(options?.exit, 'exit');
	const log = options?.log ?? console.log;
	const reportError = options?.reportError ?? console.error;
	const schedule = options?.setTimeout ?? setTimeout;
	const cancel = options?.clearTimeout ?? clearTimeout;
	const wait = options?.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
	const now = options?.now ?? Date.now;
	requiredFunction(wait, 'wait');
	requiredFunction(now, 'clock');
	const appName = requiredText(options?.appName, 'application name');
	const appOrigin = requiredText(options?.appOrigin, 'application origin');
	const productId = requiredProduct(options?.productId);
	const projectLibraryEvidence = options?.projectLibraryEvidence;
	if ([PROJECT_LIBRARY_MODE, DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
		DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE].includes(configuration.mode)
		&& typeof projectLibraryEvidence !== 'function') {
		throw new TypeError('Project-library smoke requires a main-process evidence callback');
	}
	const sourceBearingSession = configuration.mode === DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE
		? createDesktopProjectLibrarySourceBearingSmokeSession({
			plan: configuration.plan,
			productId,
			projectLibraryEvidence,
		})
		: null;
	const leaseSession = configuration.mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE
		? createDesktopProjectLibraryLeaseSmokeSession({
			plan: configuration.plan,
			productId,
			projectLibraryEvidence,
			projectLibrarySnapshot: requiredFunction(options?.projectLibrarySnapshot, 'project-library snapshot'),
		})
		: null;
	const directWavTargetHarness = configuration.mode === DESKTOP_DIRECT_WAV_SMOKE_MODE
		? options?.directWavTargetHarness ?? createDirectWavSmokeTargetHarness({ argv: options?.argv })
		: null;
	if (directWavTargetHarness && (typeof directWavTargetHarness.resolveSavePath !== 'function'
		|| typeof directWavTargetHarness.evidence !== 'function')) {
		throw new TypeError('Direct-WAV smoke requires a target harness');
	}
	const videoTimingFileHarness = configuration.mode === DESKTOP_VIDEO_TIMING_PROBE_MODE
		? options?.videoTimingFileHarness ?? createDesktopVideoTimingProbeFileHarness(configuration.plan)
		: null;
	const videoTimingStorageProfile = configuration.mode === DESKTOP_VIDEO_TIMING_PROBE_MODE
		? createDesktopVideoTimingProbeStorageProfile(productId)
		: null;

	let attachedWindow = null;
	let timeout = null;
	let started = false;
	let finished = false;
	let scapeDescriptorObservation = null;

	const finish = async (code) => {
		if (finished) return;
		finished = true;
		if (timeout !== null) cancel(timeout);
		await exit(code);
	};
	const fail = async (message) => {
		reportError(message);
		await finish(2);
	};

	const attach = (window) => {
		if (configuration.mode === 'disabled') return;
		if (attachedWindow) throw new Error('Desktop smoke probe is already attached');
		if (!window?.webContents || typeof window.webContents.once !== 'function') {
			throw new TypeError('Desktop smoke requires a BrowserWindow');
		}
		attachedWindow = window;
		leaseSession?.attach(window);
		timeout = schedule(() => {
			void fail(`${prefixFor(configuration.mode)} timed out`);
		}, timeoutFor(configuration.mode));
		window.webContents.once('did-fail-load', (_event, code, description) => {
			void fail(`${prefixFor(configuration.mode)} load failed: ${String(code)} ${String(description)}`);
		});
		if (configuration.mode === 'artifact') {
			window.webContents.once('did-finish-load', () => { void runArtifact(window); });
		}
	};
	const observeProjectDescriptor = (descriptor, evidence) => {
		if (configuration.mode !== DESKTOP_SCAPE_OPEN_SMOKE_MODE) return false;
		if (scapeDescriptorObservation) throw new Error('Scape-open smoke descriptor was already observed');
		const readEvidence = requiredFunction(evidence, 'Scape-open descriptor evidence');
		const summary = validateScapeOpenProjectDescriptor(descriptor, configuration.plan);
		const live = readEvidence(descriptor.id);
		if (live && typeof live.then === 'function') {
			throw new TypeError('Scape-open descriptor evidence must be synchronous, not a Promise');
		}
		assertMatchingScapeDescriptor(live, descriptor, configuration.plan);
		scapeDescriptorObservation = Object.freeze({
			id: descriptor.id,
			descriptor,
			evidence: readEvidence,
			summary,
		});
		return true;
	};

	const runArtifact = async (window) => {
		if (started || finished) return;
		started = true;
		try {
			const result = await window.webContents.executeJavaScript(ARTIFACT_SMOKE_SCRIPT);
			const valid = result?.url === `${appOrigin}/`
				&& result?.title === appName
				&& result?.hasEditor === true
				&& result?.nodeExposed === false
				&& result?.saveOwnerReady === true
				&& result?.bridge?.includes('getEnvironment')
				&& result?.bridge?.includes('chooseFiles')
				&& result?.bridge?.includes('beginWrite')
				&& result?.bridge?.includes('respondToClose');
			log(`SOUNDSCAPER_DESKTOP_SMOKE ${JSON.stringify(result)}`);
			await finish(valid ? 0 : 2);
		} catch (error) {
			await fail(`SOUNDSCAPER_DESKTOP_SMOKE failed: ${cleanError(error)}`);
		}
	};

	const rendererReady = async () => {
		const sourceBearing = configuration.mode === DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE;
		if (![PROJECT_LIBRARY_MODE, DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
			DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
			DESKTOP_DIRECT_WAV_SMOKE_MODE, DESKTOP_SCAPE_OPEN_SMOKE_MODE,
			DESKTOP_SCAPE_REOPEN_SMOKE_MODE, DESKTOP_VIDEO_TIMING_PROBE_MODE].includes(configuration.mode)
			|| finished || (started && !sourceBearing && !leaseSession)) return;
		started = true;
		try {
			if (!attachedWindow) throw new Error('Desktop smoke renderer became ready before window attachment');
			const plan = configuration.plan;
			if (!plan || plan.productId !== productId) throw new Error('Packaged smoke plan targets a different product');
			if (leaseSession) {
				const payload = await leaseSession.rendererReady(attachedWindow.webContents);
				if (payload === null) return;
				log(`${DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX}${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (sourceBearing) {
				const payload = await sourceBearingSession.run(attachedWindow.webContents);
				if (payload === null) return;
				log(`${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX}${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (configuration.mode === DESKTOP_DIRECT_WAV_SMOKE_MODE) {
				const renderer = validateDirectWavRendererResult(
					await attachedWindow.webContents.executeJavaScript(
						`(${runDirectWavRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)})`,
						true,
					),
				);
				const native = await directWavTargetHarness.evidence();
				const payload = validateDirectWavSmokeResult({
					schemaVersion: 1,
					mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
					productId,
					token: plan.token,
					renderer,
					native,
				}, plan);
				log(`${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (configuration.mode === DESKTOP_SCAPE_OPEN_SMOKE_MODE) {
				const renderer = validateScapeOpenRendererResult(
					await attachedWindow.webContents.executeJavaScript(
						`(${runScapeOpenRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)})`,
					),
					plan,
				);
				if (!scapeDescriptorObservation) {
					throw new Error('Scape-open smoke did not observe its delivered project descriptor');
				}
				await waitForScapeDescriptorRetirement(scapeDescriptorObservation, { now, wait, plan });
				const payload = validateScapeOpenSmokeResult({
					...plan,
					descriptor: {
						...scapeDescriptorObservation.summary,
						liveBeforeDelivery: true,
						retiredAfterOpen: true,
					},
					renderer,
				}, plan);
				log(`${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (configuration.mode === DESKTOP_SCAPE_REOPEN_SMOKE_MODE) {
				const execution = validateScapeReopenRendererResult(
					await attachedWindow.webContents.executeJavaScript(
						`(${runScapeReopenRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)})`, true,
					),
					plan,
				);
				const payload = validateScapeReopenSmokeResult({ ...plan, ...execution }, plan);
				log(`${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (configuration.mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) {
				const payload = validateDesktopVideoTimingProbeResult(
					await attachedWindow.webContents.executeJavaScript(
						`(${runDesktopVideoTimingProbeRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)}, ${JSON.stringify(videoTimingStorageProfile)})`, true,
					),
					plan,
				);
				log(`${DESKTOP_VIDEO_TIMING_PROBE_PREFIX} ${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			const rendererResult = await attachedWindow.webContents.executeJavaScript(
				`(${runProjectLibraryRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)})`,
			);
			const summary = validateSummary(rendererResult?.summary, plan.target);
			const evidence = await projectLibraryEvidence(plan.target.id);
			const payload = projectLibraryPayload(plan, summary, evidence);
			log(`${DESKTOP_PROJECT_LIBRARY_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
			await finish(0);
		} catch (error) {
			await fail(`${prefixFor(configuration.mode)} failed: ${cleanError(error)}`);
		}
	};
	const resolveSavePath = async (choice) => configuration.mode === DESKTOP_DIRECT_WAV_SMOKE_MODE
		? directWavTargetHarness.resolveSavePath(choice)
		: null;
	const resolveOpenPaths = (choice) => videoTimingFileHarness?.resolveOpenPaths(choice) ?? null;

	return Object.freeze({
		attach,
		observeProjectDescriptor,
		projectLibraryHostOptions: () => leaseSession?.hostOptions ?? Object.freeze({}),
		rendererReady,
		resolveSavePath,
		resolveOpenPaths,
	});
}

function decodePlan(encoded) {
	if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
		throw new TypeError('Desktop smoke plan must use canonical base64url');
	}
	const bytes = Buffer.from(encoded, 'base64url');
	if (bytes.toString('base64url') !== encoded) throw new TypeError('Desktop smoke plan must use canonical base64url');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) throw new RangeError('Desktop smoke plan exceeds its 64 KiB byte limit');
	const text = bytes.toString('utf8');
	let value;
	try { value = JSON.parse(text); } catch (error) {
		throw new TypeError('Desktop smoke plan is not valid JSON', { cause: error });
	}
	if (canonicalJson(value) !== text) throw new TypeError('Desktop smoke plan must use canonical JSON');
	return validatePlan(value);
}

function validatePlan(value) {
	const plan = strictRecord(value, ['mode', 'previous', 'productId', 'schemaVersion', 'stage', 'target'], 'smoke plan');
	if (plan.schemaVersion !== 1 || plan.mode !== PROJECT_LIBRARY_MODE) {
		throw new TypeError('Desktop smoke plan has an unsupported schema or mode');
	}
	const productId = requiredProduct(plan.productId);
	const stage = String(plan.stage);
	if (!Object.hasOwn(STAGE_PRODUCTS, stage)) throw new TypeError('Unsupported smoke stage; expected publish, advance, or return');
	if (STAGE_PRODUCTS[stage] !== productId) throw new TypeError('Desktop smoke stage targets an unexpected product');
	const previous = plan.previous === null ? null : validateDescriptor(plan.previous, 'previous project');
	if (stage === 'publish' && previous !== null) throw new TypeError('Publish smoke previous descriptor must be null');
	if (stage !== 'publish' && previous === null) throw new TypeError(`${stage} smoke requires a previous project descriptor`);
	const targetRecord = strictRecord(
		plan.target,
		['document', 'id', 'revision', 'sha256', 'title'],
		'target project',
	);
	const target = {
		...validateDescriptor({
			id: targetRecord.id,
			title: targetRecord.title,
			revision: targetRecord.revision,
			sha256: targetRecord.sha256,
		}, 'target project'),
		document: requiredText(targetRecord.document, 'target document'),
	};
	if (previous && (previous.id !== target.id || previous.revision >= target.revision)) {
		throw new TypeError('Desktop smoke target must advance the previous project identity and revision');
	}
	validateMainDocument(target.document, target, 'Target project');
	return deepFreeze({
		schemaVersion: 1,
		mode: PROJECT_LIBRARY_MODE,
		stage,
		productId,
		previous,
		target,
	});
}

function validateDescriptor(value, label) {
	const descriptor = strictRecord(value, ['id', 'revision', 'sha256', 'title'], `${label} descriptor`);
	const id = requiredText(descriptor.id, `${label} id`);
	const title = requiredText(descriptor.title, `${label} title`);
	const revision = descriptor.revision;
	if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError(`${label} revision is invalid`);
	const sha256 = String(descriptor.sha256);
	if (!DIGEST.test(sha256)) throw new TypeError(`${label} SHA-256 is invalid`);
	return Object.freeze({ id, title, revision, sha256 });
}

function validateMainDocument(document, descriptor, label) {
	let project;
	try { project = JSON.parse(document); } catch (error) {
		throw new TypeError(`${label} is not a canonical document`, { cause: error });
	}
	if (JSON.stringify(project) !== document) throw new TypeError(`${label} is not a canonical document`);
	if (project?.schemaVersion !== DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION || project.id !== descriptor.id
		|| project.title !== descriptor.title || project.revision !== descriptor.revision
		|| !Array.isArray(project.timelineAnnotations)) {
		throw new TypeError(`${label} does not match its descriptor`);
	}
	if (!Array.isArray(project.sources) || project.sources.length
		|| !Array.isArray(project.clips) || project.clips.length
		|| (project.tracks !== undefined && (!Array.isArray(project.tracks) || project.tracks.length))
		|| !project.projectBin || !Array.isArray(project.projectBin.clips) || project.projectBin.clips.length) {
		throw new TypeError(`${label} must remain source-free`);
	}
	if (sha256(document) !== descriptor.sha256) throw new TypeError(`${label} SHA-256 does not match its descriptor`);
}

function projectLibraryPayload(plan, summary, evidence) {
	const host = evidence?.host;
	const target = evidence?.target;
	if (host?.owner?.product !== plan.productId) throw new Error('Project-library smoke host owner does not match the package');
	const writer = host?.lastWriter;
	if (!Number.isSafeInteger(writer?.fencingToken) || writer.fencingToken < 1) throw new Error('Project-library smoke fencing token is invalid');
	if (writer.tookOverStaleLease !== false) throw new Error('Project-library smoke unexpectedly took over a stale lease');
	if (writer.recovery?.outcome !== 'clean') throw new Error('Project-library smoke recovery was not clean');
	if (!Number.isSafeInteger(evidence?.catalogRevision) || evidence.catalogRevision < 1) {
		throw new Error('Project-library smoke catalog revision is invalid');
	}
	if (target?.projectId !== plan.target.id || target?.name !== plan.target.title
		|| target?.projectRevision !== plan.target.revision || target?.sha256 !== plan.target.sha256) {
		throw new Error('Project-library smoke catalog row does not match the target');
	}
	if (target.preferredProduct !== plan.productId) throw new Error('Project-library smoke preferred product is invalid');
	return {
		schemaVersion: 1,
		mode: PROJECT_LIBRARY_MODE,
		stage: plan.stage,
		productId: plan.productId,
		project: descriptorWithoutDocument(plan.target),
		summary,
		host: {
			owner: { product: host.owner.product },
			fencingToken: writer.fencingToken,
			tookOverStaleLease: false,
			recovery: { outcome: 'clean' },
		},
		preferredProduct: target.preferredProduct,
		catalogRevision: evidence.catalogRevision,
	};
}

function validateSummary(value, target) {
	const summary = strictRecord(value, ['id', 'revision', 'title'], 'renderer smoke summary');
	if (summary.id !== target.id || summary.title !== target.title || summary.revision !== target.revision) {
		throw new Error('Renderer smoke summary does not match the target');
	}
	return Object.freeze({ id: summary.id, title: summary.title, revision: summary.revision });
}

function descriptorWithoutDocument(value) {
	return { id: value.id, title: value.title, revision: value.revision, sha256: value.sha256 };
}

function strictRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`Desktop ${label} has unsupported fields or is not a closed object`);
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

function requiredFunction(value, label) {
	if (typeof value !== 'function') throw new TypeError(`Desktop smoke ${label} callback is required`);
	return value;
}

function requiredText(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`Desktop smoke ${label} is invalid`);
	return value;
}

function requiredProduct(value) {
	if (value !== 'soundscaper' && value !== 'framescaper') throw new TypeError('Desktop smoke product is invalid');
	return value;
}

async function waitForScapeDescriptorRetirement(observation, { now, wait, plan }) {
	const deadline = now() + 15_000;
	while (true) {
		const candidate = observation.evidence(observation.id);
		if (candidate && typeof candidate.then === 'function') {
			throw new TypeError('Scape-open descriptor evidence must remain synchronous, not a Promise');
		}
		if (candidate === null) return;
		assertMatchingScapeDescriptor(candidate, observation.descriptor, plan);
		if (now() >= deadline) throw new Error('Scape-open descriptor retirement evidence timed out');
		await wait(25);
	}
}

function assertMatchingScapeDescriptor(candidate, observed, plan) {
	validateScapeOpenProjectDescriptor(candidate, plan);
	for (const key of ['id', 'url', 'name', 'size', 'mimeType', 'readProfile', 'lastModified']) {
		if (candidate[key] !== observed[key]) {
			throw new Error('Scape-open descriptor evidence does not match its delivered capability');
		}
	}
}

function timeoutFor(mode) {
	if (mode === DESKTOP_DIRECT_WAV_SMOKE_MODE) return DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS;
	if (mode === DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE) return 90_000;
	if (mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE) return 90_000;
	if (mode === DESKTOP_SCAPE_OPEN_SMOKE_MODE || mode === DESKTOP_SCAPE_REOPEN_SMOKE_MODE) return 90_000;
	if (mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) return DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS;
	return 15_000;
}

function prefixFor(mode) {
	if (mode === PROJECT_LIBRARY_MODE) return DESKTOP_PROJECT_LIBRARY_SMOKE_PREFIX;
	if (mode === DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE) {
		return DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX.trimEnd();
	}
	if (mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE) return DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX.trimEnd();
	if (mode === DESKTOP_DIRECT_WAV_SMOKE_MODE) return DESKTOP_DIRECT_WAV_SMOKE_PREFIX;
	if (mode === DESKTOP_SCAPE_OPEN_SMOKE_MODE) return DESKTOP_SCAPE_OPEN_SMOKE_PREFIX;
	if (mode === DESKTOP_SCAPE_REOPEN_SMOKE_MODE) return DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX;
	if (mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) return DESKTOP_VIDEO_TIMING_PROBE_PREFIX;
	return 'SOUNDSCAPER_DESKTOP_SMOKE';
}

function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function cleanError(error) {
	return error instanceof Error ? error.message : String(error);
}
