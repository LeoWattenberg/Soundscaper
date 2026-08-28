/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Fixtures for the packaged desktop smoke probe.
 *
 * The probe's suite asserts on lifecycle and evidence. Its fake Electron
 * window and bounded plan encoder live here so those tests stay focused on the
 * behavior they check.
 */

import { createDesktopSmokeProbe } from '../../desktop/desktop-smoke.js';

export const DIRECT_WAV_MODE = 'direct-wav-export-v1';
export const DIRECT_WAV_TOKEN = '0123456789abcdef0123456789abcdef';

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
			return null;
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
