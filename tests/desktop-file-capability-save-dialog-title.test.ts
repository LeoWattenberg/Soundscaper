/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';

const CHANNELS = Object.freeze({
	chooseFiles: 'files:choose',
	releaseRead: 'files:release',
	chooseSaveTarget: 'save:choose',
	beginWrite: 'save:begin',
	writeChunk: 'save:chunk',
	patchFinalPrefix: 'save:prefix',
	finishWrite: 'save:finish',
	abortWrite: 'save:abort',
});

type SaveDialogOptions = Readonly<{ title?: unknown; defaultPath?: unknown; filters?: unknown }>;

function saveDialogFixture() {
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	const dialogs: SaveDialogOptions[] = [];
	registerFileCapabilityIpc({
		channels: CHANNELS,
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: {
			showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
			showSaveDialog: async (_window: unknown, options: SaveDialogOptions) => {
				dialogs.push(options);
				return { canceled: true, filePath: '' };
			},
		},
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => {
			handlers.set(channel, listener);
		},
		opaqueId: (value: unknown) => String(value ?? ''),
		ownerFor: () => 'owner',
		pendingOpenProjects: new Map(),
		readCapabilities: {},
		saves: {},
		saveTargets: { registerPath: () => null },
		windowFor: () => null,
	});
	const chooseSaveTarget = handlers.get(CHANNELS.chooseSaveTarget);
	assert.ok(chooseSaveTarget, 'the save chooser registers on its channel');
	return {
		async choose(purpose: string): Promise<SaveDialogOptions> {
			const before = dialogs.length;
			await chooseSaveTarget({}, { purpose, suggestedName: 'untitled' });
			assert.equal(dialogs.length, before + 1, `the ${purpose} save opened one dialog`);
			return dialogs[before];
		},
	};
}

test('the native project save dialog is titled for the project save, not the Audacity export', async () => {
	const fixture = saveDialogFixture();
	const options = await fixture.choose('project');
	assert.equal(options.title, 'Save project');
});

test('the Audacity interchange export dialog names the interchange export', async () => {
	const fixture = saveDialogFixture();
	const options = await fixture.choose('aup4');
	assert.equal(options.title, 'Export Audacity interchange');
});

test('every other save purpose keeps the generic export title', async () => {
	const fixture = saveDialogFixture();
	assert.equal((await fixture.choose('audio')).title, 'Export');
	assert.equal((await fixture.choose('labels')).title, 'Export');
});
