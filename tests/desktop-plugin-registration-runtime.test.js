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

const { createDesktopPluginHostingRuntime } = await import('../desktop/plugin-registration.mjs');
const { DesktopPluginRegistry } = await import('../desktop/plugin-registry.ts');

test('the production host reserves only a main-minted capability for the isolated vendor window', async () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
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
