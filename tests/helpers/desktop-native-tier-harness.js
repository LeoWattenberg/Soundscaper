/* SPDX-License-Identifier: AGPL-3.0-only */
// Boots the desktop native tier outside a packaged Electron and drives one
// registration. The hook install and the dynamic imports below must stay in
// this module: reading the electron-bound registration modules as source text
// is what let a call shape with missing arguments ship as if it were correct,
// so every consumer has to load them through the same resolved seam.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IPC } from '../../desktop/constants.js';
const ROOT = resolve(import.meta.dirname, '..', '..');
const RUNTIME_PREFIX = './project-library-runtime/desktop/';
const ELECTRON_STUB = 'stub-electron:main';
const ELECTRON_STUB_SOURCE = `
export const answers = { openDialog: { canceled: true, filePaths: [] } };
export const app = { getAppMetrics: () => [] };
export const dialog = { showOpenDialog: async () => answers.openDialog };
export class MessageChannelMain {
	constructor() { throw new Error('A stub MessageChannel is not opened unless a native stream passes its gate.'); }
}
export const utilityProcess = {
	fork: () => { throw new Error('A stub Electron surface never forks a helper.'); },
};
`;

// The registration modules are the electron-bound seam, and reading them as
// source text is what let a call shape with missing arguments ship as if it
// were correct. Both of the things that stop them running outside a packaged
// Electron are resolved here — `electron/main` to a stub, and the compiled
// runtime members to the TypeScript they are compiled from — so these tests
// execute the same registration path the application starts through.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'electron/main') return { url: ELECTRON_STUB, shortCircuit: true };
		if (specifier.startsWith(RUNTIME_PREFIX)) {
			return nextResolve(`./${specifier.slice(RUNTIME_PREFIX.length).replace(/\.js$/u, '.ts')}`, context);
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === ELECTRON_STUB) return { format: 'module', source: ELECTRON_STUB_SOURCE, shortCircuit: true };
		return nextLoad(url, context);
	},
});

const electron = await import('electron/main');
const { ReadCapabilityStore } = await import('../../desktop/file-capabilities.js');
const {
	createScannerQuarantinePort,
	observeScannedPlugins,
	recordScannedPlugins,
} = await import('../../desktop/plugin-registration.mjs');
const {
	disposeDesktopNativeTier,
	registerDesktopNativeTier,
	revokeDesktopNativeTierOwner,
} = await import('../../desktop/native-tier-registration.mjs');
const { registerDesktopHelperProbe } = await import('../../desktop/helper-registration.mjs');
const { DesktopNativeAudioSessionService } = await import('../../desktop/native-audio-session-service.ts');
const { DesktopPluginHostService } = await import('../../desktop/plugin-host-service.ts');
const { DesktopPluginQuarantine, PLUGIN_FAULT_KINDS } = await import('../../desktop/plugin-quarantine.ts');
const { DesktopPluginRegistry } = await import('../../desktop/plugin-registry.ts');

const NATIVE_CHANNELS = Object.freeze([
	IPC.helperProbeAvailability,
	IPC.helperProbeBegin,
	IPC.helperProbeAwait,
	IPC.helperProbeCancel,
	IPC.nativeAudioAvailability,
	IPC.nativeAudioInventory,
	IPC.nativeAudioSetEnabled,
	IPC.nativeAudioSessionOpen,
	IPC.nativeAudioSessionBind,
	IPC.nativeAudioSessionStatus,
	IPC.nativeAudioSessionCalibrate, IPC.nativeAudioSessionReport, IPC.nativeAudioSessionLoss,
	IPC.nativeAudioSessionClose,
	IPC.nativePluginAvailability,
	IPC.nativePluginConsent,
	IPC.nativePluginScan,
	IPC.nativePluginInventory,
	IPC.nativePluginClearQuarantine,
	IPC.nativePluginReviewInstallation,
	IPC.nativePluginInstantiate,
	IPC.nativePluginRunOffline,
	IPC.nativePluginSetBypassed,
	IPC.nativePluginPersistState,
	IPC.nativePluginRestoreState,
	IPC.nativePluginOpenVendorUi,
	IPC.nativePluginCloseVendorUi,
	IPC.nativePluginCloseInstance,
]);

function registrationOptions(userDataPath, overrides = {}) {
	const owner = {};
	const stateBodies = new Map();
	return {
		channels: IPC,
		handle: () => {},
		ownerFor: () => owner,
		readCapabilities: new ReadCapabilityStore(),
		settings: createSettings(),
		desktopRoot: join(ROOT, 'desktop'),
		packaged: false,
		resourcesPath: join(ROOT, 'resources'),
		userDataPath,
		parentWindow: () => null,
		productId: 'soundscaper',
		nativePluginStateAuthority: () => ({
			persist(bytes) {
				const copy = Uint8Array.from(bytes);
				const sha256 = createHash('sha256').update(copy).digest('hex');
				const bodyId = `native-plugin-state:${sha256}`;
				stateBodies.set(bodyId, copy);
				return Object.freeze({ kind: 'native-plugin-state', bodyId, byteLength: copy.byteLength, sha256 });
			},
			read(bodyId) {
				const bytes = stateBodies.get(bodyId);
				if (!bytes) return null;
				return Object.freeze({
					bytes: Uint8Array.from(bytes), byteLength: bytes.byteLength,
					sha256: bodyId.slice('native-plugin-state:'.length),
				});
			},
		}),
		...overrides,
	};
}

function createRegistration(userDataPath, settingsState = {}, overrides = {}) {
	const channels = [];
	const handlers = new Map();
	const settings = createSettings(settingsState);
	const activation = Object.hasOwn(overrides, 'isPluginHostFormatActivated')
		? {}
		: { isPluginHostFormatActivated: (format) => format === 'fixture' };
	const tier = registerDesktopNativeTier(registrationOptions(userDataPath, {
		handle: (channel, listener) => {
			channels.push(channel);
			handlers.set(channel, listener);
		},
		settings,
		...activation,
		...overrides,
	}));
	return {
		channels,
		settings,
		tier,
		invoke: async (channel, value) => {
			const listener = handlers.get(channel);
			assert.ok(listener, `no handler is registered for ${String(channel)}`);
			return listener({ sender: {}, processId: 1, frameId: 1 }, value);
		},
	};
}

function createSettings(overrides = {}) {
	const state = {
		nativeAudioHelperEnabled: true,
		nativePluginDiscoveryEnabled: true,
		nativeProbeHelperEnabled: true,
		...overrides,
	};
	return {
		snapshot: () => ({ ...state }),
		setNativeAudioHelperEnabled: (value) => (state.nativeAudioHelperEnabled = value),
		setNativePluginDiscoveryEnabled: (value) => (state.nativePluginDiscoveryEnabled = value),
		setNativeProbeHelperEnabled: (value) => { state.nativeProbeHelperEnabled = value; },
	};
}

async function temporaryUserData(context) {
	const path = await mkdtemp(join(tmpdir(), 'scape-native-tier-'));
	context.after(() => rm(path, { recursive: true, force: true }));
	return path;
}

async function writeQuarantine(userDataPath, digests) {
	await writeFile(join(userDataPath, 'native-plugin-quarantine-v1.json'), JSON.stringify({
		schemaVersion: 1,
		quarantined: digests.map((digest) => ({ digest, scope: 'scanner', kind: 'crash', quarantinedAt: 1 })),
		faults: [],
	}), 'utf8');
}

function scanDigestFor(format, path) {
	return createHash('sha256').update(`${format}\u0000${path}`).digest('hex');
}

async function admitCustomRoot(registration, rootPath, { granted = false } = {}) {
	if (!granted) await registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'grant' });
	electron.answers.openDialog = { canceled: false, filePaths: [rootPath] };
	const outcome = await registration.invoke(IPC.nativePluginConsent, {
		format: 'fixture',
		action: 'add-custom-root',
	});
	assert.equal(outcome.status, 'admitted', `the picked folder was refused: ${JSON.stringify(outcome)}`);
	return outcome.root.rootId;
}

async function consentFormat(registration, format) {
	const availability = await registration.invoke(IPC.nativePluginAvailability);
	return availability.consent.formats.find((entry) => entry.format === format);
}

async function isGranted(registration, format) {
	return (await consentFormat(registration, format)).granted;
}

async function admittedRootIds(registration, format) {
	return (await consentFormat(registration, format)).roots
		.filter((root) => root.admitted)
		.map((root) => root.rootId);
}

export {
	DesktopNativeAudioSessionService,
	DesktopPluginHostService,
	DesktopPluginQuarantine,
	DesktopPluginRegistry,
	NATIVE_CHANNELS,
	PLUGIN_FAULT_KINDS,
	ROOT,
	ReadCapabilityStore,
	admitCustomRoot,
	admittedRootIds,
	createRegistration,
	createScannerQuarantinePort,
	createSettings,
	disposeDesktopNativeTier,
	electron,
	isGranted,
	observeScannedPlugins,
	recordScannedPlugins,
	registerDesktopHelperProbe,
	registerDesktopNativeTier,
	registrationOptions,
	revokeDesktopNativeTierOwner,
	scanDigestFor,
	temporaryUserData,
	writeQuarantine,
};
