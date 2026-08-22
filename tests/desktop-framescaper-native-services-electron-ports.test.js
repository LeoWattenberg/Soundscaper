/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const ELECTRON_STUB = 'stub-framescaper-native-services-electron:main';
const ELECTRON_STUB_SOURCE = `
export const answers = { openDialog: { canceled: true, filePaths: [] } };
export const dialogCalls = [];
export const dialog = {
	showOpenDialog: async (options) => {
		dialogCalls.push(options);
		return answers.openDialog;
	},
};
export class BrowserWindow { constructor() { throw new Error('No window is created by a picker.'); } }
export class MessageChannelMain { constructor() { throw new Error('No channel is created by a picker.'); } }
export const ipcMain = {
	on: () => { throw new Error('No IPC listener is created by a picker.'); },
	removeListener: () => undefined,
};
export const screen = {
	getPrimaryDisplay: () => ({ id: 1 }), getAllDisplays: () => [],
	on: () => undefined, removeListener: () => undefined,
};
`;

registerHooks({
	resolve(specifier, _context, nextResolve) {
		if (specifier === 'electron/main') return { url: ELECTRON_STUB, shortCircuit: true };
		return nextResolve(specifier);
	},
	load(url, context, nextLoad) {
		if (url === ELECTRON_STUB) {
			return { format: 'module', source: ELECTRON_STUB_SOURCE, shortCircuit: true };
		}
		return nextLoad(url, context);
	},
});

const electron = await import('electron/main');
const { createFramescaperNativeServicesElectronPorts } = await import(
	'../desktop/framescaper-native-services-electron-ports.mjs'
);

test('the Electron OpenFX picker is lazy, file-only, singular, and main-owned', async () => {
	const ports = createFramescaperNativeServicesElectronPorts(
		{ snapshot: () => ({ nativeMediaEnabled: false }) },
		() => undefined,
	);
	assert.equal(electron.dialogCalls.length, 0, 'constructing the menu seam must not open a chooser');

	electron.answers.openDialog = {
		canceled: false,
		filePaths: ['/private/plugins/example.ofx'],
	};
	assert.equal(await ports.selectOpenFxPluginBinary(), '/private/plugins/example.ofx');
	assert.deepEqual(electron.dialogCalls, [{
		title: 'Choose OpenFX plug-in binary',
		properties: ['openFile'],
	}]);

	for (const answer of [
		{ canceled: true, filePaths: ['/private/plugins/example.ofx'] },
		{ canceled: false, filePaths: [] },
		{ canceled: false, filePaths: ['/private/plugins/one.ofx', '/private/plugins/two.ofx'] },
	]) {
		electron.answers.openDialog = answer;
		assert.equal(await ports.selectOpenFxPluginBinary(), null);
	}
	assert.equal(JSON.stringify(ports).includes('/private/plugins'), false,
		'the internal selected path must not become renderer-visible port state');
});
