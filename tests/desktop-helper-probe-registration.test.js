/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IPC } from '../desktop/constants.js';

const ELECTRON_STUB = 'stub-electron:main';
const RUNTIME_PREFIX = './project-library-runtime/desktop/';
const ELECTRON_STUB_SOURCE = `
export const app = { getAppMetrics: () => [] };
export class MessageChannelMain {
	constructor() { throw new Error('A stub MessageChannel is not opened unless a native stream passes its gate.'); }
}
export const utilityProcess = {
	fork: () => { throw new Error('A stub Electron surface never forks a helper.'); },
};
`;

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

const { ReadCapabilityStore } = await import('../desktop/file-capabilities.js');
const { registerDesktopHelperProbe } = await import('../desktop/helper-registration.mjs');

test('the probe helper resolves its engine on use, not while the application registers', async (context) => {
	// Desktop codec policy ships no bundled FFmpeg, so a packaged application has
	// neither config/ffmpeg-runtime-manifest.json nor the engine beside it.
	// Reading them while registering made every packaged start emit an unhandled
	// rejection nobody could catch, long before any probe asked for a helper.
	const applicationRoot = await mkdtemp(join(tmpdir(), 'scape-helper-registration-'));
	context.after(() => rm(applicationRoot, { recursive: true, force: true }));
	const desktopRoot = join(applicationRoot, 'desktop');
	await mkdir(desktopRoot);
	const rejections = [];
	const recordRejection = (reason) => rejections.push(reason);
	process.on('unhandledRejection', recordRejection);
	context.after(() => process.off('unhandledRejection', recordRejection));

	const claimed = [];
	const service = registerDesktopHelperProbe({
		channels: IPC,
		handle: (channel) => claimed.push(channel),
		ownerFor: () => ({}),
		readCapabilities: new ReadCapabilityStore(),
		settings: createSettings({ nativeProbeHelperEnabled: false }),
		desktopRoot,
		packaged: true,
		resourcesPath: join(applicationRoot, 'resources'),
	});
	await new Promise((resolve) => { setImmediate(resolve); });

	assert.deepEqual(rejections, [],
		'registration must not read an engine the package is not allowed to carry');
	assert.deepEqual(claimed.sort(), [
		IPC.helperProbeAvailability, IPC.helperProbeAwait,
		IPC.helperProbeBegin, IPC.helperProbeCancel,
	].sort());
	assert.equal((await service.availability()).enabled, false);
});

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
