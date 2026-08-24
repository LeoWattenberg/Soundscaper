/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const ELECTRON = 'stub-electron:plugin-registration';
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
			export const app = { getAppMetrics: () => [] };
			export const dialog = {};
			export class MessageChannelMain {}
			export const utilityProcess = { fork: () => { throw new Error('unused'); } };
		` };
		return nextLoad(url, context);
	},
});

const {
	createDesktopPluginHostingRuntime,
	registerDesktopPluginDiscovery,
} = await import('../desktop/plugin-registration.mjs');
const { DesktopPluginRegistry } = await import('../desktop/plugin-registry.ts');

function recordFixtureInstallation(registry) {
	const admission = registry.record({
		format: 'clap', stableId: 'org.example.effect', bundleStableIds: ['org.example.effect'],
		name: 'Effect', vendor: 'Example', version: '1.0.0', platform: 'linux', architecture: 'x64',
		binaryPath: '/tmp/example.clap', binaryBytes: 4, binarySha256: 'ab'.repeat(32),
		identity: { dev: 1, ino: 2 }, classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true,
		offlineSupported: true, reportedLatencyFrames: 0, signature: 'trusted',
		compatibility: 'compatible', descriptorVersion: 1,
	});
	assert.equal(admission.status, 'recorded');
	return admission;
}

test('the production host reserves only a main-minted capability for the isolated vendor window', async () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const admission = recordFixtureInstallation(registry);
	if (admission.status !== 'recorded') return;
	const runtime = createDesktopPluginHostingRuntime({
		registry,
		quarantine: { isQuarantined: () => false },
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }) },
		stateBodies: { persist: () => { throw new Error('unused'); }, read: () => null },
		isFormatActivated: () => true,
		createHostHelper: () => ({
			describePayload: async () => ({ status: 'available' }),
			supervisor: { dispose: () => undefined },
		}),
		openPersistentPluginSession: async () => ({
			format: 'clap', reportedLatencyFrames: 0, closed: new Promise(() => undefined),
			transferTo: () => undefined,
			authenticateState: () => { throw new Error('unused'); },
			vendorWindowCapability: (windowId) => `${windowId}.${'c'.repeat(64)}`,
			close: async () => undefined,
		}),
	});
	const owner = {};
	const instance = await runtime.service.instantiate(owner, {
		installationId: admission.installationId, instanceId: null, sampleRate: 48_000,
	});
	await runtime.openRealtime(owner, instance.instanceId, { postMessage: () => undefined }, 48_000);
	const outcome = runtime.service.openVendorUi(owner, instance.instanceId);
	assert.equal(outcome.status, 'opened');
	if (outcome.status !== 'opened') return;
	assert.match(outcome.window.windowHandleId, /^[a-f\d]{40}\.[a-f\d]{64}$/u);
	assert.equal(JSON.stringify(outcome).includes('/tmp/example.clap'), false);
	assert.equal('nativeHandle' in outcome.window, false);
	assert.equal('dom' in outcome.window, false);
	assert.deepEqual(runtime.isolation.vendorUiWindows(), [outcome.window]);
	assert.equal(runtime.service.closeVendorUi(owner, {
		instanceId: instance.instanceId, windowHandleId: outcome.window.windowHandleId,
	}), true);
	runtime.service.dispose();
});

test('a session the supervisor rejects reports the host crash instead of leaving the instance hosted', async () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const admission = recordFixtureInstallation(registry);
	if (admission.status !== 'recorded') return;
	let rejectClosed;
	const runtime = createDesktopPluginHostingRuntime({
		registry,
		quarantine: { isQuarantined: () => false },
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }) },
		stateBodies: { persist: () => { throw new Error('unused'); }, read: () => null },
		isFormatActivated: () => true,
		createHostHelper: () => ({
			describePayload: async () => ({ status: 'available' }),
			supervisor: { dispose: () => undefined },
		}),
		openPersistentPluginSession: async () => ({
			format: 'clap', reportedLatencyFrames: 0,
			closed: new Promise((_resolve, reject) => { rejectClosed = reject; }),
			transferTo: () => undefined,
			authenticateState: () => { throw new Error('unused'); },
			vendorWindowCapability: (windowId) => `${windowId}.${'c'.repeat(64)}`,
			close: async () => undefined,
		}),
	});
	const owner = {};
	const instance = await runtime.service.instantiate(owner, {
		installationId: admission.installationId, instanceId: null, sampleRate: 48_000,
	});
	await runtime.openRealtime(owner, instance.instanceId, { postMessage: () => undefined }, 48_000);
	assert.equal(runtime.isolation.describeInstance(instance.instanceId).state, 'hosted');
	const crash = new Error('The helper process exited unexpectedly.');
	crash.cause_ = 'helper-exit';
	rejectClosed(crash);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runtime.isolation.describeInstance(instance.instanceId).state, 'faulted');
	assert.equal(runtime.isolation.describeDigest('ab'.repeat(32)).recentFaults, 1);
	runtime.service.dispose();
});

test('repeated host crashes quarantine the digest durably, and the explicit clear rehosts it', async (t) => {
	const { mkdtemp, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const userDataPath = await mkdtemp(join(tmpdir(), 'plugin-quarantine-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const digest = 'ab'.repeat(32);
	const owner = {};
	const sessions = [];
	const handlers = new Map();
	const channels = new Proxy({}, { get: (_target, name) => String(name) });
	const registration = registerDesktopPluginDiscovery({
		channels,
		handle: (channel, handler) => handlers.set(channel, handler),
		ownerFor: () => owner,
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }) },
		supervisor: {
			runJob: async () => { throw new Error('no scans in this test'); },
			snapshot: () => ({ state: 'idle', quarantined: false }),
			clearQuarantine: () => undefined,
			dispose: () => undefined,
		},
		describePayload: async () => ({ status: 'available' }),
		userDataPath,
		parentWindow: () => null,
		desktopRoot: userDataPath,
		packaged: false,
		resourcesPath: userDataPath,
		nativePluginStateAuthority: { persist: () => { throw new Error('unused'); }, read: () => null },
		isPluginHostFormatActivated: () => true,
		createPluginHostHelper: () => ({
			describePayload: async () => ({ status: 'available' }),
			supervisor: { dispose: () => undefined },
		}),
		openPersistentPluginSession: async () => {
			const session = {
				format: 'clap', reportedLatencyFrames: 0,
				closed: null, reject: null,
				transferTo: () => undefined,
				authenticateState: () => { throw new Error('unused'); },
				vendorWindowCapability: (windowId) => `${windowId}.${'c'.repeat(64)}`,
				close: async () => undefined,
			};
			session.closed = new Promise((_resolve, reject) => { session.reject = reject; });
			sessions.push(session);
			return session;
		},
	});
	t.after(() => registration.dispose());
	await registration.ready();
	const admission = recordFixtureInstallation(registration.registry);
	if (admission.status !== 'recorded') return;
	const event = { sender: { postMessage: () => undefined } };
	const instantiate = () => handlers.get('nativePluginInstantiate')(event, {
		installationId: admission.installationId, instanceId: null, sampleRate: 48_000,
	});
	const crashOnce = async () => {
		await instantiate();
		const crash = new Error('The helper process exited unexpectedly.');
		crash.cause_ = 'helper-exit';
		sessions.at(-1).reject(crash);
		await new Promise((resolve) => setImmediate(resolve));
		await registration.settlePluginQuarantineWrites();
	};
	await crashOnce();
	assert.equal(registration.quarantine.isQuarantined(digest), false);
	await crashOnce();
	assert.equal(registration.quarantine.isQuarantined(digest), true,
		'two qualifying host faults within the window must reach the durable store');
	assert.equal(registration.quarantine.describe(digest).scope, 'host');
	await assert.rejects(instantiate, /quarantined/u);
	const outcome = await handlers.get('nativePluginClearQuarantine')(event, { digest, clearance: 're-enable' });
	assert.deepEqual(outcome, { cleared: true });
	assert.equal(registration.quarantine.isQuarantined(digest), false);
	// The clear must release the in-memory hold too, not only the durable file.
	const rehosted = await instantiate();
	assert.equal(rehosted.state, 'hosted');
});
