/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseDesktopSmokeConfiguration as parseConfiguration } from './desktop-smoke-configuration.js';
import {
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
	DESKTOP_DIRECT_WAV_SMOKE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY,
	DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS,
	createDirectWavSmokeTargetHarness,
	validateDirectWavRendererResult,
	validateDirectWavSmokeResult,
} from './direct-wav-smoke.js';
import {
	DESKTOP_SCAPE_OPEN_SMOKE_MODE,
	DESKTOP_SCAPE_OPEN_SMOKE_PREFIX,
	validateScapeOpenProjectDescriptor,
	validateScapeOpenRendererResult,
	validateScapeOpenSmokeResult,
} from './scape-open-smoke.js';
import {
	DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
	DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX,
	validateScapeReopenRendererResult,
	validateScapeReopenSmokeResult,
} from './scape-reopen-smoke.js';
import {
	FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY,
	joinFramescaperBaselineArtifactEvidence,
} from './framescaper-baseline-artifact-smoke.js';
import {
	validateFramescaperCaptureArtifactEvidence,
} from './framescaper-capture-artifact-smoke.js';
import {
	createDesktopProjectLibraryLeaseSmokeSession,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX,
} from './project-library-lease-smoke.js';
import {
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
	DESKTOP_VIDEO_TIMING_PROBE_PREFIX,
	DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS,
	createDesktopVideoTimingProbeFileHarness,
	createDesktopVideoTimingProbeStorageProfile,
	validateDesktopVideoTimingProbeResult,
} from './video-timing-probe-smoke.js';
import {
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX,
} from './framescaper-web-vcr-smoke-plan.js';
import { createFramescaperWebVcrSmokeSession } from './framescaper-web-vcr-smoke-session.js';
import { FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY } from './framescaper-web-vcr-renderer-smoke.js';
import {
	executeDesktopRendererSmoke,
	readDesktopRendererSmokeStallWitness,
} from './renderer-smoke-execution.js';
import { runSoundscaperProfessionalNativeUtilitySmoke } from './soundscaper-professional-native-utility-smoke.mjs';



export function parseDesktopSmokeConfiguration(argv) {
	return parseConfiguration(argv);
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
	if ((configuration.mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE
		|| (configuration.mode === 'artifact' && productId === 'framescaper'))
		&& typeof projectLibraryEvidence !== 'function') {
		throw new TypeError('Project-library smoke requires a main-process evidence callback');
	}
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
	const webVcrSmokeSession = [FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
		FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE].includes(configuration.mode)
		? createFramescaperWebVcrSmokeSession(configuration) : null;

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
			void (async () => {
				const stageKey = configuration.mode === DESKTOP_DIRECT_WAV_SMOKE_MODE
					? DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY
					: webVcrSmokeSession ? FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY : null;
				const stage = stageKey
					? await stalledStage(window, { schedule, cancel }, 5_000, stageKey, productId) : null;
				await fail(`${prefixFor(configuration.mode)} timed out${stage ? ` waiting for ${stage}` : ''}`);
			})();
		}, timeoutFor(configuration.mode));
		window.webContents.once('did-fail-load', (_event, code, description) => {
			void fail(`${prefixFor(configuration.mode)} load failed: ${String(code)} ${String(description)}`);
		});
		if (configuration.mode === 'artifact' && productId === 'soundscaper') {
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
			const execution = await executeDesktopRendererSmoke(window.webContents, {
				productId,
				operation: productId === 'framescaper' ? 'artifact-baseline' : 'artifact-soundscaper',
				arguments: productId === 'framescaper' ? [{
						appName,
						appOrigin,
						library: FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY,
					}] : [],
			});
			const desktopChrome = await executeDesktopRendererSmoke(window.webContents, {
				productId, operation: 'artifact-chrome', userGesture: true,
			});
			const captureExecution = productId === 'framescaper'
				? await executeDesktopRendererSmoke(window.webContents, {
					productId, operation: 'artifact-capture', userGesture: true,
				})
				: undefined;
			const result = productId === 'framescaper'
				? {
					...execution,
					desktopChrome,
					framescaperCapture: validateFramescaperCaptureArtifactEvidence(captureExecution),
					framescaperBaseline: joinFramescaperBaselineArtifactEvidence(
						execution?.framescaperBaseline,
						await projectLibraryEvidence(execution?.framescaperBaseline?.project?.projectId),
					),
				}
				: { ...execution, desktopChrome };
			const valid = result?.url === `${appOrigin}/`
				&& result?.title === appName
				&& result?.hasEditor === true
				&& result?.nodeExposed === false
				&& result?.saveOwnerReady === true
				&& result?.desktopChrome?.fullBleed === true
				&& result?.desktopChrome?.controlsVisible === true
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
		if (configuration.mode === 'artifact') {
			if (productId !== 'framescaper' || finished || started) return;
			if (!attachedWindow) {
				await fail('SOUNDSCAPER_DESKTOP_SMOKE failed: Desktop smoke renderer became ready before window attachment');
				return;
			}
			await runArtifact(attachedWindow);
			return;
		}
		if (![DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
			DESKTOP_DIRECT_WAV_SMOKE_MODE, DESKTOP_SCAPE_OPEN_SMOKE_MODE,
			DESKTOP_SCAPE_REOPEN_SMOKE_MODE, DESKTOP_VIDEO_TIMING_PROBE_MODE,
			FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
			FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE].includes(configuration.mode)
			|| finished || (started && !leaseSession)) return;
		started = true;
		try {
			if (!attachedWindow) throw new Error('Desktop smoke renderer became ready before window attachment');
			const plan = configuration.plan;
			if (!plan || plan.productId !== productId) throw new Error('Packaged smoke plan targets a different product');
			if (webVcrSmokeSession) {
				const payload = await webVcrSmokeSession.run(attachedWindow.webContents);
				log(`${webVcrSmokeSession.prefix}${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (leaseSession) {
				const payload = await leaseSession.rendererReady(attachedWindow.webContents);
				if (payload === null) return;
				log(`${DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX}${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (configuration.mode === DESKTOP_DIRECT_WAV_SMOKE_MODE) {
				const renderer = validateDirectWavRendererResult(
					await executeDesktopRendererSmoke(attachedWindow.webContents, {
						productId, operation: 'direct-wav', arguments: [plan], userGesture: true,
					}),
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
					await executeDesktopRendererSmoke(attachedWindow.webContents, {
						productId, operation: 'scape-open', arguments: [plan],
					}),
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
					await executeDesktopRendererSmoke(attachedWindow.webContents, {
						productId, operation: 'scape-reopen', arguments: [plan], userGesture: true,
					}),
					plan,
				);
				const payload = validateScapeReopenSmokeResult({ ...plan, ...execution }, plan);
				log(`${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			if (configuration.mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) {
				const payload = validateDesktopVideoTimingProbeResult(
					await executeDesktopRendererSmoke(attachedWindow.webContents, {
						productId,
						operation: 'video-timing',
						arguments: [plan, videoTimingStorageProfile],
						userGesture: true,
					}),
					plan,
				);
				log(`${DESKTOP_VIDEO_TIMING_PROBE_PREFIX} ${JSON.stringify(payload)}`);
				await finish(0);
				return;
			}
			throw new Error('Desktop smoke mode has no renderer workflow');
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
		observeWebVcrDisplaySecurityWitness: (value) => (
			webVcrSmokeSession?.observeDisplaySecurityWitness(value) ?? false
		),
		observeProjectDescriptor,
		professionalNativeUtilitySmoke: runSoundscaperProfessionalNativeUtilitySmoke,
		projectLibraryLeaseTestControl: () => leaseSession?.leaseTestControl ?? null,
		rendererReady,
		resolveSavePath,
		resolveOpenPaths,
	});
}

function requiredFunction(value, label) {
	if (typeof value !== 'function') throw new TypeError(`Desktop smoke ${label} callback is required`);
	return value;
}

function requiredText(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) {
		throw new TypeError(`Desktop smoke ${label} is invalid`);
	}
	return value;
}

function requiredProduct(value) {
	if (value !== 'soundscaper' && value !== 'framescaper') {
		throw new TypeError('Desktop smoke product is invalid');
	}
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
	if (mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE) return 90_000;
	if (mode === DESKTOP_SCAPE_OPEN_SMOKE_MODE || mode === DESKTOP_SCAPE_REOPEN_SMOKE_MODE) return 90_000;
	if (mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) return DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS;
	if (mode === FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE
		|| mode === FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE) return 120_000;
	return 15_000;
}

/**
 * Reads the stage marker the renderer smoke maintains, so a watchdog timeout
 * names the stage that stalled. Never throws and never outlives its own bound:
 * the renderer is already unresponsive by assumption, so an unavailable marker
 * degrades to an unqualified timeout rather than delaying the failure.
 */
async function stalledStage(
	window,
	{ schedule, cancel },
	budgetMs = 5_000,
	stageKey = DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY,
	productId = 'soundscaper',
) {
	const contents = window?.webContents;
	if (!contents || typeof contents.executeJavaScript !== 'function' || contents.isDestroyed?.()) return null;
	let timer = null;
	try {
		// The stage names what stalled; the editor's status line and the export
		// progress say whether a render was starved or a step never fired.
		const stage = await Promise.race([
			readDesktopRendererSmokeStallWitness(contents, {
				productId,
				stageKey,
				userGesture: true,
			}),
			new Promise((resolve) => { timer = schedule(() => resolve(null), budgetMs); }),
		]);
		return typeof stage === 'string' && stage ? stage.slice(0, 400) : null;
	} catch {
		return null;
	} finally {
		if (timer !== null) cancel(timer);
	}
}

function prefixFor(mode) {
	if (mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE) return DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX.trimEnd();
	if (mode === DESKTOP_DIRECT_WAV_SMOKE_MODE) return DESKTOP_DIRECT_WAV_SMOKE_PREFIX;
	if (mode === DESKTOP_SCAPE_OPEN_SMOKE_MODE) return DESKTOP_SCAPE_OPEN_SMOKE_PREFIX;
	if (mode === DESKTOP_SCAPE_REOPEN_SMOKE_MODE) return DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX;
	if (mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) return DESKTOP_VIDEO_TIMING_PROBE_PREFIX;
	if (mode === FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE) return FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX.trimEnd();
	if (mode === FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE) return FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX.trimEnd();
	return 'SOUNDSCAPER_DESKTOP_SMOKE';
}

function cleanError(error) {
	if (error instanceof Error) return error.message;
	let message = null;
	try { message = error?.message; } catch { /* Fall back to string coercion. */ }
	return typeof message === 'string' ? message : String(error);
}
