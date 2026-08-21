/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { IPC } from '../desktop/constants.js';

const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_PREFIX = './project-library-runtime/desktop/';
const ELECTRON_STUB = 'stub-electron:main';
const ELECTRON_STUB_SOURCE = `
export const answers = { openDialog: { canceled: true, filePaths: [] } };
export const app = { getAppMetrics: () => [] };
export const dialog = { showOpenDialog: async () => answers.openDialog };
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
const { ReadCapabilityStore } = await import('../desktop/file-capabilities.js');
const {
	createScannerQuarantinePort,
	observeScannedPlugins,
	recordScannedPlugins,
} = await import('../desktop/plugin-registration.mjs');
const {
	disposeDesktopNativeTier,
	registerDesktopNativeTier,
} = await import('../desktop/native-tier-registration.mjs');
const { DesktopPluginQuarantine, PLUGIN_FAULT_KINDS } = await import('../desktop/plugin-quarantine.ts');
const { DesktopPluginRegistry } = await import('../desktop/plugin-registry.ts');

const NATIVE_CHANNELS = Object.freeze([
	IPC.helperProbeAvailability,
	IPC.helperProbeBegin,
	IPC.helperProbeAwait,
	IPC.helperProbeCancel,
	IPC.nativeAudioAvailability,
	IPC.nativeAudioInventory,
	IPC.nativeAudioSetEnabled,
	IPC.nativePluginAvailability,
	IPC.nativePluginConsent,
	IPC.nativePluginScan,
	IPC.nativePluginInventory,
	IPC.nativePluginClearQuarantine,
]);

test('the shared IPC map and the sandbox preload declare the very same channels', async () => {
	const preloadSource = await readFile(join(ROOT, 'desktop', 'preload.mjs'), 'utf8');
	const declaration = /const CHANNELS = Object\.freeze\((\{[\s\S]*?\n\}),?\n?\);/u.exec(preloadSource);
	assert.ok(declaration, 'the preload declares its channel table as one frozen literal');
	const declared = vm.runInNewContext(`(${declaration[1]})`, { Object });
	// The preload runs as a sandboxed plain script and cannot import the shared
	// map, so the two tables are compared instead: a channel main registers
	// under a name the bridge does not invoke is a surface nobody can reach.
	assert.deepEqual({ ...declared }, { ...IPC });
});

test('registering the native tier claims every declared channel exactly once', async (context) => {
	const registration = createRegistration(await temporaryUserData(context));
	for (const channel of registration.channels) {
		assert.equal(typeof channel, 'string', 'every registered channel is a defined string');
		assert.notEqual(channel, '');
	}
	assert.equal(new Set(registration.channels).size, registration.channels.length,
		'a channel registered twice makes Electron refuse the second handler and exit the application');
	assert.deepEqual([...registration.channels].sort(), [...NATIVE_CHANNELS].sort());
	disposeDesktopNativeTier(registration.tier);
});

test('the native tier refuses an options bag missing a seam it forwards', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const complete = registrationOptions(userDataPath);
	for (const missing of ['channels', 'handle', 'ownerFor', 'settings', 'desktopRoot', 'userDataPath', 'parentWindow']) {
		const options = { ...complete };
		delete options[missing];
		assert.throws(() => registerDesktopNativeTier(options), new RegExp(missing, 'u'),
			`a native tier registered without ${missing} must fail by name rather than deep inside a helper`);
	}
});

test('the renderer can change native-audio preference through the bounded main channel', async (context) => {
	let ownerReads = 0;
	const registration = createRegistration(await temporaryUserData(context), { nativeAudioHelperEnabled: false }, {
		ownerFor: () => { ownerReads += 1; return {}; },
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));

	assert.deepEqual(registration.tier.audio.controlSnapshot(), { enabled: false, quarantined: false });
	assert.equal((await registration.invoke(IPC.nativeAudioAvailability)).enabled, false);
	assert.equal(await registration.invoke(IPC.nativeAudioSetEnabled, true), true);
	assert.deepEqual(registration.tier.audio.controlSnapshot(), { enabled: true, quarantined: false });
	assert.equal((await registration.invoke(IPC.nativeAudioAvailability)).enabled, true);
	assert.equal(ownerReads, 1, 'the setter must validate the active renderer owner before changing authority');
	assert.equal(await registration.invoke(IPC.nativeAudioSetEnabled, 'true'), false,
		'the main boundary must not coerce renderer input');
	assert.equal(ownerReads, 2);
});

test('a renderer with no active owner cannot change native-audio authority', async (context) => {
	const registration = createRegistration(await temporaryUserData(context), { nativeAudioHelperEnabled: false }, {
		ownerFor: () => { throw new Error('The renderer is no longer the active owner.'); },
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));

	await assert.rejects(
		() => registration.invoke(IPC.nativeAudioSetEnabled, true),
		/active owner/u,
	);
	assert.equal((await registration.invoke(IPC.nativeAudioAvailability)).enabled, false);
});

test('the native tier ready seam restores the durable plug-in quarantine', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const digest = 'a'.repeat(64);
	await writeQuarantine(userDataPath, [digest]);
	const registration = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(registration.tier));
	assert.equal(registration.tier.plugins.quarantine.snapshot().loaded, false);
	await registration.tier.ready();
	const snapshot = registration.tier.plugins.quarantine.snapshot();
	assert.equal(snapshot.loaded, true, 'a quarantine nobody loaded refuses every scan it is consulted about');
	assert.deepEqual(snapshot.records.map((record) => record.digest), [digest]);
});

test('a scan request reaches the service as a well-formed scan root location', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const rootPath = join(userDataPath, 'fixture-plug-ins');
	await mkdir(rootPath);
	await writeQuarantine(userDataPath, [scanDigestFor('fixture', rootPath)]);
	const registration = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	const rootId = await admitCustomRoot(registration, rootPath);

	// The location carries the documented scan digest, so the durable quarantine
	// recognizes this root-and-format pair rather than throwing on a missing key.
	const quarantined = await registration.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.equal(quarantined.status, 'failed');
	assert.equal(quarantined.code, 'digest-quarantined');

	assert.deepEqual(
		await registration.invoke(IPC.nativePluginClearQuarantine, {
			digest: scanDigestFor('fixture', rootPath),
			clearance: 'rescan',
		}),
		{ cleared: true },
	);
	// A cleared digest scans again, and the location's identity is captured from
	// the directory itself, so a root that has gone is refused rather than
	// handed to a helper as an undefined identity.
	const cleared = await registration.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.equal(cleared.status, 'failed');
	assert.notEqual(cleared.code, 'digest-quarantined');
	assert.notEqual(cleared.code, 'unknown-root');
	await rm(rootPath, { recursive: true });
	const vanished = await registration.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.equal(vanished.status, 'failed');
	assert.equal(vanished.code, 'unknown-root');
});

test('an unrecognized consent action is refused rather than granted', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const registration = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	await assert.rejects(
		() => registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'not-an-action' }),
		/not an admitted plug-in consent action/u,
	);
	assert.equal(await isGranted(registration, 'fixture'), false,
		'an authorization surface must never fall open to an action it does not recognize');
	await registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'grant' });
	assert.equal(await isGranted(registration, 'fixture'), true);
	const rootPath = join(userDataPath, 'removable');
	await mkdir(rootPath);
	const rootId = await admitCustomRoot(registration, rootPath, { granted: true });
	await registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'remove-root', rootId });
	assert.deepEqual(await admittedRootIds(registration, 'fixture'), []);
});

test('plug-in consent and its picked folders survive a restart', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const rootPath = join(userDataPath, 'kept-plug-ins');
	await mkdir(rootPath);
	const first = createRegistration(userDataPath);
	await first.tier.ready();
	const rootId = await admitCustomRoot(first, rootPath);
	disposeDesktopNativeTier(first.tier);

	const second = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(second.tier));
	await second.tier.ready();
	assert.equal(await isGranted(second, 'fixture'), true, 'a consent decision the user made must outlive the process');
	assert.deepEqual(await admittedRootIds(second, 'fixture'), [rootId]);
	const outcome = await second.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.notEqual(outcome.code, 'unknown-root');
});

test('a scanner fault is quarantined in the shape the durable store requires', async () => {
	const written = [];
	const quarantine = new DesktopPluginQuarantine({
		filePath: '/quarantine.json',
		fileSystem: {
			readFile: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
			writeFile: (_path, contents) => { written.push(contents); return Promise.resolve(); },
		},
	});
	await quarantine.load();
	const port = createScannerQuarantinePort(quarantine);
	const digest = 'b'.repeat(64);
	port.quarantine(digest, 'scanner-crash');
	await port.settle();
	assert.deepEqual(quarantine.snapshot().records, [
		{ digest, scope: 'scanner', kind: 'crash', quarantinedAt: quarantine.describe(digest).quarantinedAt },
	]);
	assert.equal(written.length, 1, 'a scanner fault that is never written is a quarantine that never survives');
	assert.equal(port.isQuarantined(digest), true);

	port.quarantine('c'.repeat(64), 'not-a-reason');
	await assert.rejects(() => port.settle(), /not-a-reason/u,
		'an unmappable scanner fault must be loud rather than swallowed');
	for (const reason of [
		'scanner-crash', 'scanner-hang', 'malformed-answer', 'oversize-answer', 'malformed-plugin', 'oversize-plugin',
	]) {
		port.quarantine(createHash('sha256').update(reason).digest('hex'), reason);
	}
	await port.settle();
	for (const record of quarantine.snapshot().records) {
		assert.ok(PLUGIN_FAULT_KINDS.includes(record.kind), `${record.kind} is a fault kind the store admits`);
		assert.equal(record.scope, 'scanner');
	}
});

test('described scan entries reach the inventory the renderer lists', async () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const result = {
		format: 'fixture',
		status: 'scanned',
		detail: '',
		entries: [scanEntry()],
	};
	const admissions = recordScannedPlugins(registry, result, { identityFor: () => ({ dev: 7, ino: 11 }) });
	assert.deepEqual(admissions.map((admission) => admission.status), ['recorded']);
	const view = registry.describe();
	assert.equal(view.entries.length, 1, 'an inventory nothing is ever recorded into is permanently empty');
	assert.equal(view.entries[0].name, 'Fixture Reverb');
	assert.equal(view.entries[0].installations[0].signature, 'trusted');
	assert.equal(view.entries[0].installations[0].compatibility, 'compatible');
	assert.equal(view.entries[0].eligible, true);
	assert.deepEqual(
		recordScannedPlugins(registry, result, { identityFor: () => null })
			.map((admission) => admission.status),
		['rejected'],
		'a binary that has gone is refused by name rather than recorded without its identity',
	);
});

test('the scan job answer fills the inventory on its way past', async (context) => {
	const binaryPath = join(await temporaryUserData(context), 'reverb.fixture');
	await writeFile(binaryPath, 'fixture', 'utf8');
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const answer = { format: 'fixture', status: 'scanned', detail: '', entries: [scanEntry({ binaryPath })] };
	const device = { backends: [] };
	const requests = [];
	const supervisor = observeScannedPlugins({
		runJob: (request) => {
			requests.push(request);
			return Promise.resolve(request.kind === 'plugin-scan' ? answer : device);
		},
		snapshot: () => ({ state: 'idle', quarantined: false }),
		clearQuarantine: () => {},
		dispose: () => {},
	}, registry);

	assert.equal(await supervisor.runJob({ kind: 'audio-device' }), device);
	assert.equal(registry.describe().entries.length, 0, 'only a scan job answers with plug-ins');
	assert.equal(await supervisor.runJob({ kind: 'plugin-scan' }), answer, 'the answer is handed back untouched');
	assert.deepEqual(registry.describe().entries.map((entry) => entry.name), ['Fixture Reverb']);
	assert.deepEqual(requests.map((request) => request.kind), ['audio-device', 'plugin-scan']);
});

function registrationOptions(userDataPath, overrides = {}) {
	const owner = {};
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
		...overrides,
	};
}

function createRegistration(userDataPath, settingsState = {}, overrides = {}) {
	const channels = [];
	const handlers = new Map();
	const settings = createSettings(settingsState);
	const tier = registerDesktopNativeTier(registrationOptions(userDataPath, {
		handle: (channel, listener) => {
			channels.push(channel);
			handlers.set(channel, listener);
		},
		settings,
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
		setNativePluginDiscoveryEnabled: (value) => { state.nativePluginDiscoveryEnabled = value; },
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

function scanEntry({ binaryPath = '/opt/plug-ins/reverb.fixture' } = {}) {
	return {
		stableId: 'fixture:reverb',
		name: 'Fixture Reverb',
		vendor: 'Soundscaper',
		version: '1.0.0',
		binaryPath,
		binaryBytes: 4_096,
		binarySha256: 'd'.repeat(64),
		classification: 'effect',
		channelSupport: [{ inputs: 2, outputs: 2 }],
		realtime: true,
		offline: true,
		reportedLatencyFrames: 0,
		signature: 'signed-valid',
		compatibility: 'compatible',
		descriptorVersion: 1,
	};
}
