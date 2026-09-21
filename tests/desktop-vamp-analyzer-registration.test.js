/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { nativeTierScanEntry } from './helpers/desktop-native-tier-fixtures.js';

const ELECTRON = 'stub-electron:vamp-analyzer-registration';
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'electron/main') return { url: ELECTRON, shortCircuit: true };
		const prefix = './project-library-runtime/desktop/';
		if (specifier.startsWith(prefix)) {
			return nextResolve(`./${specifier.slice(prefix.length).replace(/\.js$/u, '.ts')}`, context);
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === ELECTRON) return { format: 'module', shortCircuit: true, source: `
			export const answers = { openDialog: { canceled: true, filePaths: [] } };
			export const app = { getAppMetrics: () => [] };
			export const dialog = { showOpenDialog: async () => answers.openDialog };
			export class MessageChannelMain { constructor() { throw new Error('unused'); } }
			export const utilityProcess = { fork: () => { throw new Error('unused'); } };
		` };
		return nextLoad(url, context);
	},
});

const { registerDesktopVampAnalyzers } = await import('../desktop/vamp-analyzer-registration.mjs');
const { registerDesktopPluginDiscovery } = await import('../desktop/plugin-registration.mjs');
const electron = await import('electron/main');

const INSTALLATION_ID = `vi${'a'.repeat(30)}`;
const OWNER = Object.freeze({ id: 'renderer-1' });

function observation() {
	return {
		kind: 'analyzer-library', format: 'vamp', libraryPath: '/private/vamp/onsets.so',
		libraryBytes: 8192, librarySha256: 'd'.repeat(64), identity: { dev: 1, ino: 2 },
		platform: 'linux', architecture: 'x64', compatibility: 'compatible', descriptors: [{
			kind: 'analyzer', format: 'vamp', identifier: 'org.example.onsets', name: 'Onsets',
			description: '', maker: 'Example', copyright: '', pluginVersion: 3, vampApiVersion: 2,
			inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
			preferredStepSize: 2, preferredBlockSize: 4,
			parameters: [], programs: [], outputs: [{ identifier: 'onsets', name: 'Onsets',
				description: '', unit: '', binCount: 1, binNames: [], extents: null,
				quantizeStep: null, sampleType: 'variable-sample-rate', sampleRate: null,
				hasDuration: false }],
		}],
	};
}

function runtimeFixture() {
	const calls = [];
	return {
		calls,
		runtime: Object.freeze({
			scanRoot: async (owner, value) => { calls.push(['scan', owner, value]); return { status: 'described' }; },
			catalog: () => Object.freeze([{ analyzerId: `va${'b'.repeat(30)}` }]),
			pluginRegistryEntries: () => Object.freeze([{ entryId: `va${'b'.repeat(30)}`, kind: 'analyzer' }]),
			setInstallationAllowed: async (...args) => { calls.push(['allow', ...args]); return { entries: [] }; },
			selectInstallation: async (...args) => { calls.push(['select', ...args]); return { entries: [] }; },
			start: async (owner, value) => { calls.push(['start', owner, value]); return { sessionId: 'vamp_session_1' }; },
			configure: async (owner, value) => { calls.push(['configure', owner, value]); return { sessionId: value.sessionId }; },
			pushPcm: async (owner, value) => { calls.push(['push', owner, value]); return { features: [] }; },
			finish: async (owner, value) => { calls.push(['finish', owner, value]); return { features: [] }; },
			cancel: async (owner, value) => { calls.push(['cancel', owner, value]); return true; },
			revokeOwner: async (owner) => { calls.push(['revoke', owner]); return 1; },
			disable: async () => { calls.push(['disable']); return 1; },
			dispose: async () => { calls.push(['dispose']); },
		}),
	};
}

async function deferredDiscoveryFixture(t) {
	const userDataPath = await mkdtemp(join(tmpdir(), 'vamp-scan-revocation-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const rootPath = join(userDataPath, 'plug-ins');
	const binaryPath = join(rootPath, 'reverb.so');
	await mkdir(rootPath);
	await writeFile(binaryPath, 'fixture');
	const requests = [];
	const supervisor = {
		runJob: (request) => {
			requests.push(request);
			return new Promise((resolve) => request.signal.addEventListener('abort', () => resolve(
				request.grant.format === 'vamp'
					? { format: 'vamp', status: 'scanned', detail: '', libraries: [observation()] }
					: { format: 'ladspa', status: 'scanned', detail: '', entries: [{
						...nativeTierScanEntry({ binaryPath }), stableId: 'ladspa:reverb',
					}] },
			), { once: true }));
		},
		snapshot: () => ({ state: 'ready', quarantined: false }),
		clearQuarantine: () => undefined, dispose: () => undefined,
	};
	let enabled = true;
	const handlers = new Map();
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const registration = registerDesktopPluginDiscovery({
		channels, handle: (channel, handler) => handlers.set(channel, handler), ownerFor: () => OWNER,
		settings: {
			snapshot: () => ({ nativePluginDiscoveryEnabled: enabled }),
			setNativePluginDiscoveryEnabled: async (value) => { enabled = value; return enabled; },
		},
		supervisor, describePayload: async () => ({ status: 'available', descriptor: {} }),
		userDataPath, parentWindow: () => null, desktopRoot: userDataPath,
		packaged: false, resourcesPath: userDataPath, isPluginHostFormatActivated: () => true,
	});
	t.after(() => registration.dispose());
	await registration.ready();
	const event = Object.freeze({ sender: {} });
	const addRoot = async (format) => {
		await handlers.get(channels.nativePluginConsent)(event, { format, action: 'grant' });
		electron.answers.openDialog = { canceled: false, filePaths: [rootPath] };
		return handlers.get(channels.nativePluginConsent)(event, { format, action: 'add-custom-root' });
	};
	return { channels, handlers, event, registration, requests, addRoot };
}

function register(runtime) {
	const handlers = new Map();
	const ownerReads = [];
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const registration = registerDesktopVampAnalyzers({
		channels, handle: (channel, handler) => handlers.set(channel, handler),
		ownerFor: (event) => { ownerReads.push(event); return OWNER; }, runtime,
	});
	return { channels, handlers, ownerReads, registration };
}

test('Vamp IPC is owner-scoped and delegates the finite analyzer session lifecycle', async () => {
	const fixture = runtimeFixture();
	const { channels, handlers, ownerReads } = register(fixture.runtime);
	const event = Object.freeze({ sender: {} });
	assert.deepEqual([...handlers.keys()], [
		channels.nativeVampInventory, channels.nativeVampSessionStart, channels.nativeVampSessionConfigure,
		channels.nativeVampSessionPush, channels.nativeVampSessionFinish, channels.nativeVampSessionCancel,
	]);
	assert.equal((await handlers.get(channels.nativeVampInventory)(event))[0].analyzerId, `va${'b'.repeat(30)}`);
	await handlers.get(channels.nativeVampSessionStart)(event, { analyzerId: 'analyzer' });
	await handlers.get(channels.nativeVampSessionConfigure)(event, { sessionId: 'vamp_session_1' });
	await handlers.get(channels.nativeVampSessionPush)(event, { sessionId: 'vamp_session_1' });
	await handlers.get(channels.nativeVampSessionFinish)(event, { sessionId: 'vamp_session_1' });
	assert.equal(await handlers.get(channels.nativeVampSessionCancel)(event, {
		sessionId: 'vamp_session_1', reason: 'user-cancelled',
	}), true);
	assert.equal(ownerReads.length, 6);
	assert.deepEqual(fixture.calls.map(([name]) => name), ['start', 'configure', 'push', 'finish', 'cancel']);
});

test('Vamp registration routes analyzer discovery and decisions without changing the effect registry shape', async () => {
	const fixture = runtimeFixture();
	const { registration } = register(fixture.runtime);
	assert.equal(registration.ownsInstallation(INSTALLATION_ID), true);
	assert.equal(registration.ownsInstallation(`i${'a'.repeat(15)}`), false);
	assert.deepEqual(await registration.scanRoot(OWNER, { rootId: 'vamp-root', format: 'vamp' }), {
		status: 'described',
	});
	assert.deepEqual(registration.mergeRegistry({ entries: [{ entryId: 'effect-entry', format: 'ladspa' }] }), {
		entries: [
			{ entryId: 'effect-entry', format: 'ladspa' },
			{ entryId: `va${'b'.repeat(30)}`, kind: 'analyzer' },
		],
	});
	await registration.setInstallationAllowed(INSTALLATION_ID, false);
	await registration.selectInstallation(INSTALLATION_ID);
	await registration.revokeOwner(OWNER);
	await registration.dispose();
	assert.deepEqual(fixture.calls.map(([name]) => name), ['scan', 'allow', 'select', 'revoke', 'dispose']);
});

test('the generic plug-in registration routes Vamp scans, inventory and decisions to the analyzer runtime', async (t) => {
	const fixture = runtimeFixture();
	const userDataPath = await mkdtemp(join(tmpdir(), 'vamp-main-registration-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const handlers = new Map();
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const scanner = {
		runJob: async () => { throw new Error('the effect scanner must not receive a Vamp scan'); },
		snapshot: () => ({ state: 'idle', quarantined: false }),
		clearQuarantine: () => undefined, dispose: () => undefined,
	};
	const registration = registerDesktopPluginDiscovery({
		channels, handle: (channel, handler) => handlers.set(channel, handler), ownerFor: () => OWNER,
		settings: {
			snapshot: () => ({ nativePluginDiscoveryEnabled: true }),
			setNativePluginDiscoveryEnabled: async (value) => value,
		},
		supervisor: scanner, describePayload: async () => ({ status: 'available', descriptor: {} }),
		userDataPath, parentWindow: () => null, desktopRoot: userDataPath,
		packaged: false, resourcesPath: userDataPath, isPluginHostFormatActivated: () => true,
		vampAnalyzerRuntime: fixture.runtime,
	});
	const event = Object.freeze({ sender: {} });
	assert.deepEqual(await handlers.get(channels.nativePluginScan)(event, {
		format: 'vamp', rootId: 'vamp-root',
	}), { status: 'described' });
	assert.deepEqual(await handlers.get(channels.nativePluginInventory)(event), {
		entries: [{ entryId: `va${'b'.repeat(30)}`, kind: 'analyzer' }],
	});
	await handlers.get(channels.nativePluginSetInstallationAllowed)(event, {
		installationId: INSTALLATION_ID, allowed: false,
	});
	await handlers.get(channels.nativePluginSelectInstallation)(event, {
		installationId: INSTALLATION_ID,
	});
	assert.equal(await registration.setEnabled(false), false);
	assert.equal(await registration.setEnabled(true), true);
	await registration.revokeOwner(OWNER);
	await registration.dispose();
	assert.deepEqual(fixture.calls.map(([name]) => name), [
		'scan', 'allow', 'select', 'disable', 'revoke', 'dispose',
	]);
});

test('global disable cancels deferred LADSPA and Vamp scans before either inventory is published', async (t) => {
	const fixture = await deferredDiscoveryFixture(t);
	const ladspaRoot = await fixture.addRoot('ladspa');
	const vampRoot = await fixture.addRoot('vamp');
	const ladspa = fixture.handlers.get(fixture.channels.nativePluginScan)(fixture.event, {
		format: 'ladspa', rootId: ladspaRoot.root.rootId,
	});
	const vamp = fixture.handlers.get(fixture.channels.nativePluginScan)(fixture.event, {
		format: 'vamp', rootId: vampRoot.root.rootId,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(fixture.requests.map((request) => request.grant.format).sort(), ['ladspa', 'vamp']);
	assert.equal(await fixture.registration.setEnabled(false), false);
	for (const outcome of await Promise.all([ladspa, vamp])) {
		assert.equal(outcome.status, 'failed');
		assert.equal(outcome.code, 'helper-cancelled');
	}
	assert.equal(fixture.requests.every((request) => request.signal.aborted), true);
	assert.deepEqual(await fixture.handlers.get(fixture.channels.nativePluginInventory)(fixture.event), {
		entries: [],
	});
});

test('format consent revocation cancels only that deferred scan and publishes no raced answer', async (t) => {
	const fixture = await deferredDiscoveryFixture(t);
	const ladspaRoot = await fixture.addRoot('ladspa');
	const vampRoot = await fixture.addRoot('vamp');
	const ladspa = fixture.handlers.get(fixture.channels.nativePluginScan)(fixture.event, {
		format: 'ladspa', rootId: ladspaRoot.root.rootId,
	});
	const vamp = fixture.handlers.get(fixture.channels.nativePluginScan)(fixture.event, {
		format: 'vamp', rootId: vampRoot.root.rootId,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	await fixture.handlers.get(fixture.channels.nativePluginConsent)(fixture.event, {
		format: 'ladspa', action: 'revoke',
	});
	assert.equal(fixture.requests.find((request) => request.grant.format === 'ladspa').signal.aborted, true);
	assert.equal(fixture.requests.find((request) => request.grant.format === 'vamp').signal.aborted, false);
	await fixture.handlers.get(fixture.channels.nativePluginConsent)(fixture.event, {
		format: 'vamp', action: 'revoke',
	});
	for (const outcome of await Promise.all([ladspa, vamp])) {
		assert.equal(outcome.status, 'failed');
		assert.equal(outcome.code, 'helper-cancelled');
	}
	assert.deepEqual(await fixture.handlers.get(fixture.channels.nativePluginInventory)(fixture.event), {
		entries: [],
	});
});

test('production composition shares discovery authority and streams through the injected analyzer backend', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'vamp-production-registration-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const rootPath = join(userDataPath, 'vamp');
	await mkdir(rootPath);
	const calls = [];
	const backend = Object.freeze({
		open: async (grant) => {
			calls.push(`open:${grant.analyzerIdentifier}`);
			return Object.freeze({
				configure: async () => ({ outputs: observation().descriptors[0].outputs }),
				process: async () => [{ outputId: 'onsets', timestamp: { seconds: 0, nanoseconds: 0 },
					duration: null, values: [1], label: 'onset' }],
				finish: async () => [], cancel: async (reason) => { calls.push(`cancel:${reason}`); },
				close: async () => { calls.push('close'); },
			});
		},
	});
	const handlers = new Map();
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const registration = registerDesktopPluginDiscovery({
		channels, handle: (channel, handler) => handlers.set(channel, handler), ownerFor: () => OWNER,
		settings: {
			snapshot: () => ({ nativePluginDiscoveryEnabled: true }),
			setNativePluginDiscoveryEnabled: async (value) => value,
		},
		supervisor: {
			runJob: async () => ({ format: 'vamp', status: 'scanned', detail: '', libraries: [observation()] }),
			snapshot: () => ({ state: 'idle', quarantined: false }),
			clearQuarantine: () => undefined, dispose: () => undefined,
		},
		describePayload: async () => ({ status: 'available', descriptor: {} }),
		userDataPath, parentWindow: () => null, desktopRoot: userDataPath,
		packaged: false, resourcesPath: userDataPath, isPluginHostFormatActivated: () => true,
		vampAnalyzerBackend: backend,
	});
	t.after(() => registration.dispose());
	await registration.ready();
	const event = Object.freeze({ sender: {} });
	await handlers.get(channels.nativePluginConsent)(event, { format: 'vamp', action: 'grant' });
	electron.answers.openDialog = { canceled: false, filePaths: [rootPath] };
	const added = await handlers.get(channels.nativePluginConsent)(event, {
		format: 'vamp', action: 'add-custom-root',
	});
	const scan = await handlers.get(channels.nativePluginScan)(event, {
		format: 'vamp', rootId: added.root.rootId,
	});
	assert.equal(scan.status, 'described');
	const installationId = (await handlers.get(channels.nativePluginInventory)(event))
		.entries[0].installations[0].installationId;
	await handlers.get(channels.nativePluginSetInstallationAllowed)(event, { installationId, allowed: true });
	const catalog = await handlers.get(channels.nativeVampInventory)(event);
	assert.equal(catalog[0].stableId, installationId);
	assert.equal(JSON.stringify(catalog).includes('/private/vamp'), false);
	const session = await handlers.get(channels.nativeVampSessionStart)(event, {
		analyzerId: catalog[0].analyzerId, stableId: catalog[0].stableId,
		binarySha256: catalog[0].binarySha256, sessionId: null,
	});
	await handlers.get(channels.nativeVampSessionConfigure)(event, {
		sessionId: session.sessionId, sampleRate: 48_000, channelCount: 1,
		stepSize: 2, blockSize: 4, frameCount: 4, parameters: {}, program: null,
	});
	const batch = await handlers.get(channels.nativeVampSessionPush)(event, {
		sessionId: session.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0, 0, 0)],
	});
	assert.equal(batch.features[0].label, 'onset');
	await handlers.get(channels.nativeVampSessionFinish)(event, { sessionId: session.sessionId });
	assert.deepEqual(calls, ['open:org.example.onsets', 'close']);
});

test('two analyzer helper faults accrue in the shared durable host quarantine and refuse a restart', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'vamp-quarantine-registration-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const rootPath = join(userDataPath, 'vamp');
	await mkdir(rootPath);
	const failure = Object.assign(new Error('analyzer helper exited'), { cause_: 'helper-exit' });
	const backendCalls = [];
	let backendOrdinal = 0;
	const backend = Object.freeze({ open: async () => {
		backendOrdinal += 1;
		const ordinal = backendOrdinal;
		backendCalls.push(`open:${ordinal}`);
		return Object.freeze({
			configure: async () => {
				if (ordinal !== 2) throw failure;
				return { outputs: observation().descriptors[0].outputs };
			},
			process: async () => [], finish: async () => [],
			cancel: async (reason) => { backendCalls.push(`cancel:${ordinal}:${reason}`); },
			close: async () => { backendCalls.push(`close:${ordinal}`); },
		});
	} });
	const handlers = new Map();
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const registration = registerDesktopPluginDiscovery({
		channels, handle: (channel, handler) => handlers.set(channel, handler), ownerFor: () => OWNER,
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }),
			setNativePluginDiscoveryEnabled: async (value) => value },
		supervisor: {
			runJob: async () => ({ format: 'vamp', status: 'scanned', detail: '', libraries: [observation()] }),
			snapshot: () => ({ state: 'idle', quarantined: false }),
			clearQuarantine: () => undefined, dispose: () => undefined,
		},
		describePayload: async () => ({ status: 'available', descriptor: {} }),
		userDataPath, parentWindow: () => null, desktopRoot: userDataPath,
		packaged: false, resourcesPath: userDataPath, isPluginHostFormatActivated: () => true,
		vampAnalyzerBackend: backend,
	});
	t.after(() => registration.dispose());
	await registration.ready();
	const event = Object.freeze({ sender: {} });
	await handlers.get(channels.nativePluginConsent)(event, { format: 'vamp', action: 'grant' });
	electron.answers.openDialog = { canceled: false, filePaths: [rootPath] };
	const added = await handlers.get(channels.nativePluginConsent)(event, {
		format: 'vamp', action: 'add-custom-root',
	});
	await handlers.get(channels.nativePluginScan)(event, { format: 'vamp', rootId: added.root.rootId });
	const installation = (await handlers.get(channels.nativePluginInventory)(event)).entries[0].installations[0];
	await handlers.get(channels.nativePluginSetInstallationAllowed)(event, {
		installationId: installation.installationId, allowed: true,
	});
	const analyzer = (await handlers.get(channels.nativeVampInventory)(event))[0];
	const start = () => handlers.get(channels.nativeVampSessionStart)(event, {
		analyzerId: analyzer.analyzerId, stableId: analyzer.stableId,
		binarySha256: analyzer.binarySha256, sessionId: null,
	});
	const configure = (session) => handlers.get(channels.nativeVampSessionConfigure)(event, {
		sessionId: session.sessionId, sampleRate: 48_000, channelCount: 1,
		stepSize: 2, blockSize: 4, frameCount: 4, parameters: {}, program: null,
	});
	const firstFault = await start();
	await assert.rejects(() => configure(firstFault), failure);
	assert.equal(registration.quarantine.snapshot().pendingFaults, 1);
	const survivor = await start();
	await configure(survivor);
	const secondFault = await start();
	await assert.rejects(() => configure(secondFault), failure);
	assert.equal(registration.quarantine.snapshot().pendingFaults, 0);
	await registration.settlePluginQuarantineWrites();
	assert.deepEqual(registration.quarantine.snapshot().records.map(({ digest, scope, kind }) => ({
		digest, scope, kind,
	})), [{ digest: 'd'.repeat(64), scope: 'host', kind: 'crash' }]);
	await assert.rejects(() => handlers.get(channels.nativeVampSessionPush)(event, {
		sessionId: survivor.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0, 0, 0)],
	}), /unknown.*session/iu);
	await assert.rejects(start, /quarantined/iu);
	const persisted = JSON.parse(await readFile(join(userDataPath, 'native-plugin-quarantine-v1.json'), 'utf8'));
	assert.equal(persisted.quarantined[0].digest, 'd'.repeat(64));
	assert.equal(backendCalls.filter((call) => call.startsWith('open:')).length, 3);
	assert.equal(backendCalls.includes('cancel:2:digest-quarantined'), true);
});

test('repeated analyzer configuration refusals do not charge the plug-in host quarantine', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'vamp-refusal-registration-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const rootPath = join(userDataPath, 'vamp');
	await mkdir(rootPath);
	const failure = Object.assign(new Error('configuration refused'), { code: 'configuration-refused' });
	let backendCalls = 0;
	const backend = Object.freeze({ open: async () => {
		backendCalls += 1;
		return Object.freeze({
			configure: async () => { throw failure; }, process: async () => [], finish: async () => [],
			cancel: async () => undefined, close: async () => undefined,
		});
	} });
	const handlers = new Map();
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const registration = registerDesktopPluginDiscovery({
		channels, handle: (channel, handler) => handlers.set(channel, handler), ownerFor: () => OWNER,
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }),
			setNativePluginDiscoveryEnabled: async (value) => value },
		supervisor: {
			runJob: async () => ({ format: 'vamp', status: 'scanned', detail: '', libraries: [observation()] }),
			snapshot: () => ({ state: 'idle', quarantined: false }),
			clearQuarantine: () => undefined, dispose: () => undefined,
		},
		describePayload: async () => ({ status: 'available', descriptor: {} }),
		userDataPath, parentWindow: () => null, desktopRoot: userDataPath,
		packaged: false, resourcesPath: userDataPath, isPluginHostFormatActivated: () => true,
		vampAnalyzerBackend: backend,
	});
	t.after(() => registration.dispose());
	await registration.ready();
	const event = Object.freeze({ sender: {} });
	await handlers.get(channels.nativePluginConsent)(event, { format: 'vamp', action: 'grant' });
	electron.answers.openDialog = { canceled: false, filePaths: [rootPath] };
	const added = await handlers.get(channels.nativePluginConsent)(event, {
		format: 'vamp', action: 'add-custom-root',
	});
	await handlers.get(channels.nativePluginScan)(event, { format: 'vamp', rootId: added.root.rootId });
	const installation = (await handlers.get(channels.nativePluginInventory)(event)).entries[0].installations[0];
	await handlers.get(channels.nativePluginSetInstallationAllowed)(event, {
		installationId: installation.installationId, allowed: true,
	});
	const analyzer = (await handlers.get(channels.nativeVampInventory)(event))[0];
	for (let refusal = 0; refusal < 2; refusal += 1) {
		const session = await handlers.get(channels.nativeVampSessionStart)(event, {
			analyzerId: analyzer.analyzerId, stableId: analyzer.stableId,
			binarySha256: analyzer.binarySha256, sessionId: null,
		});
		await assert.rejects(() => handlers.get(channels.nativeVampSessionConfigure)(event, {
			sessionId: session.sessionId, sampleRate: 48_000, channelCount: 1,
			stepSize: 2, blockSize: 4, frameCount: 4, parameters: {}, program: null,
		}), failure);
	}
	await registration.settlePluginQuarantineWrites();
	assert.equal(backendCalls, 2);
	assert.equal(registration.quarantine.snapshot().pendingFaults, 0);
	assert.deepEqual(registration.quarantine.snapshot().records, []);
});
