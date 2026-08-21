/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Fixtures for the packaged desktop smoke probe.
 *
 * The probe's suite asserts on lifecycle and evidence; building a valid handoff
 * plan, a canonical project document and a fake Electron window is scaffolding
 * for those assertions rather than part of them. It lives here so the suite
 * reads as the behaviour it checks, and so a second suite can drive the same
 * probe without copying a plan builder that has to stay digest-consistent.
 */

import { createHash } from 'node:crypto';

import { DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION } from '../../desktop/project-library-smoke-project.js';
import { createDesktopSmokeProbe } from '../../desktop/desktop-smoke.js';

export const HANDOFF_MODE = '--soundscaper-smoke-mode=project-library-handoff-v1';
export const PROJECT_ID = 'packaged-handoff-project';
export const MODE = 'project-library-handoff-v1';
export const DIRECT_WAV_MODE = 'direct-wav-export-v1';
export const DIRECT_WAV_TOKEN = '0123456789abcdef0123456789abcdef';

export function handoffPlan({
	stage = 'publish',
	productId = 'soundscaper',
	previousDocument = null,
	targetDocument,
	revision = 1,
	title = 'Soundscaper revision',
} = {}) {
	const document = targetDocument ?? projectDocument(revision, title);
	return {
		schemaVersion: 1,
		mode: MODE,
		stage,
		productId,
		previous: previousDocument === null ? null : descriptor(previousDocument),
		target: { document, ...descriptor(document) },
	};
}

export function projectDocument(revision, title, overrides = {}) {
	return canonicalJson({
		schemaVersion: DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION,
		id: PROJECT_ID,
		title,
		revision,
		sources: [],
		clips: [],
		projectBin: { clips: [] },
		timelineAnnotations: [],
		takeGroups: [],
		...overrides,
	});
}

export function descriptor(document) {
	const project = JSON.parse(document);
	return {
		id: project.id,
		title: project.title,
		revision: project.revision,
		sha256: createHash('sha256').update(document, 'utf8').digest('hex'),
	};
}

export function encodePlan(plan) {
	return Buffer.from(canonicalJson(plan), 'utf8').toString('base64url');
}

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${canonicalJson(value[key])}`
		)).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function planArgument(plan) {
	return `--soundscaper-smoke-plan=${encodePlan(plan)}`;
}

export function lifecycleArgv(plan) {
	return lifecycleArgvEncoded(encodePlan(plan));
}

export function lifecycleArgvEncoded(encoded) {
	return [
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		HANDOFF_MODE,
		`--soundscaper-smoke-plan=${encoded}`,
	];
}

export function rendererScope(api) {
	return {
		crypto: globalThis.crypto,
		TextEncoder,
		scapeDesktop: { v1: api },
	};
}

export function probeFixture({
	argv,
	executionResult = {
		url: 'soundscaper-app://bundle/',
		title: 'Soundscaper',
		bridge: ['beginWrite', 'chooseFiles', 'getEnvironment', 'respondToClose'],
		environment: { platform: 'linux', arch: 'x64' },
		hasEditor: true,
		nodeExposed: false,
		saveOwnerReady: true,
	},
	productId = 'soundscaper',
	appName = 'Soundscaper',
	appOrigin = 'soundscaper-app://bundle',
	plan = null,
	directWavTargetHarness = undefined,
	executionError = undefined,
}) {
	const logs = [];
	const errors = [];
	const exits = [];
	const evidenceCalls = [];
	const scheduledDelays = [];
	const scheduledCallbacks = [];
	const window = fakeWindow(executionResult, executionError);
	const target = plan?.target ?? handoffPlan().target;
	const probe = createDesktopSmokeProbe({
		argv,
		appName,
		appOrigin,
		productId,
		exit: async (code) => { exits.push(code); },
		log: (value) => { logs.push(value); },
		reportError: (value) => { errors.push(value); },
		projectLibraryEvidence: (projectId) => {
			evidenceCalls.push(projectId);
			return {
				host: {
					closed: false,
					owner: { product: productId, processId: 42, instanceId: 'private-instance' },
					activeWriter: null,
					lastWriter: {
						fencingToken: 2,
						tookOverStaleLease: false,
						recovery: { outcome: 'clean' },
						reclamation: { complete: true },
						managedMediaReclamation: { complete: true },
					},
				},
				catalogRevision: 7,
				target: {
					projectId: target.id,
					name: target.title,
					projectRevision: target.revision,
					preferredProduct: productId,
					sha256: target.sha256,
				},
			};
		},
		directWavTargetHarness,
		setTimeout: (callback, delay) => {
			scheduledDelays.push(delay);
			scheduledCallbacks.push(callback);
			return 1;
		},
		clearTimeout: () => undefined,
	});
	return { errors, evidenceCalls, exits, logs, probe, scheduledCallbacks, scheduledDelays, window };
}

export async function flushAsync() {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => { setImmediate(resolve); });
}

export function directWavArgv() {
	return [
		'/opt/Soundscaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
		`--soundscaper-smoke-plan=${encodePlan({
			schemaVersion: 1,
			mode: DIRECT_WAV_MODE,
			productId: 'soundscaper',
			token: DIRECT_WAV_TOKEN,
		})}`,
		'--soundscaper-smoke-app-data=/private/smoke-root',
	];
}

function fakeWindow(executionResult, executionError) {
	const listeners = new Map();
	const webContents = {
		executions: [],
		userGestures: [],
		once(name, listener) {
			listeners.set(name, listener);
		},
		async executeJavaScript(source, userGesture = false) {
			this.executions.push(source);
			this.userGestures.push(userGesture === true);
			if (executionError !== undefined) throw executionError;
			if (source.includes('collectDesktopChromeArtifactWitness')) {
				return structuredClone(validDesktopChrome(executionResult?.environment?.platform));
			}
			return structuredClone(executionResult);
		},
		async emit(name, ...args) {
			const listener = listeners.get(name);
			listeners.delete(name);
			return listener?.(...args);
		},
	};
	return { webContents };
}

function validDesktopChrome(platform) {
	return {
		documentDesktop: true,
		shellDesktop: true,
		fullBleed: true,
		customHeader: true,
		titlebarDraggable: true,
		controlsNoDrag: true,
		controlsVisible: true,
		maximizeEnabled: true,
		controlOrder: ['fullscreen', 'minimize', 'maximize', 'quit'],
		fileAccessKey: platform === 'darwin' ? null : 'Alt+F',
	};
}

export function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
