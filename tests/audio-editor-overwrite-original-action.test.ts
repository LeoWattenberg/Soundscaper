/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOriginalOverwriteActions, type OriginalOverwriteState } from '../src/common/editor/controller/export/internal/overwrite-original-action.ts';
import { createDesktopOriginalImportRecorder, resetDesktopOriginal } from '../src/common/editor/desktop-overwrite-original.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { encodeWav } from '../src/common/editor/wav.js';

async function fixture() {
	const state: OriginalOverwriteState = {};
	let project = { id: 'project', sources: [] as Record<string, unknown>[], clips: [] as object[] };
	const file = new File([new Uint8Array(encodeWav([new Float32Array(4)], { sampleRate: 96_000, bitDepth: 16 }))], 'original.wav');
	registerDesktopOriginalFile(file, { id: 'a'.repeat(48), name: file.name });
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = { id: 'project', sources: [{ id: 'source', kind: 'audio', channelCount: 1 }], clips: [{}] };
	})(file);
	const requests: unknown[] = [];
	const target = { id: 'target', name: file.name };
	const fileService = {
		originalOverwriteAvailable: true,
		prepareOriginalOverwrite: async (id: string): Promise<unknown> => { requests.push(id); return target; },
	};
	const actions = createOriginalOverwriteActions({ state, getProject: () => project, fileService,
		handleExportAction: async (action, settings) => { requests.push([action, settings]); return 'exported'; } });
	return { state, requests, target, actions, fileService, clearClips: () => { project = { ...project, clips: [] }; } };
}

test('overwrite starts one complete mix with source settings and no export dialog', async () => {
	const { actions, requests, target } = await fixture();
	assert.equal(actions.originalFile()?.name, 'original.wav');
	assert.equal(actions.overwriteOriginalAvailable(), true);
	assert.equal(await actions.overwriteOriginal(), 'exported');
	assert.deepEqual(requests, ['a'.repeat(48), ['start', {
		format: 'wav', mode: 'mix', range: 'project', sampleRate: 96_000,
		channelMapping: 'mono', sampleFormat: 'int16', bitDepth: 16, includeTail: false,
		masteringSequenceId: null, loudnessNormalization: null, saveTarget: target,
	}]]);
});

test('overwrite refuses busy, disposed and unavailable sessions before authorizing a write', async () => {
	for (const key of ['recorder', 'recordingStarting', 'recordingFinishing', 'importing', 'exportAbort', 'disposed']) {
		const { state, actions, requests } = await fixture();
		Reflect.set(state, key, true);
		assert.equal(actions.overwriteOriginalAvailable(), false, key);
		await actions.overwriteOriginal();
		assert.deepEqual(requests, []);
	}
	const { state, actions, requests } = await fixture();
	resetDesktopOriginal(state);
	await actions.overwriteOriginal();
	assert.deepEqual(requests, []);
});

test('a project switch while acquiring the destination prevents export and concurrent calls are ignored', async () => {
	const { state, actions, fileService, requests } = await fixture();
	let resolve!: (value: unknown) => void;
	fileService.prepareOriginalOverwrite = () => new Promise((settle) => { resolve = settle; });
	const pending = actions.overwriteOriginal();
	assert.equal(actions.overwriteOriginalAvailable(), false);
	await actions.overwriteOriginal();
	resetDesktopOriginal(state);
	resolve({ id: 'target', name: 'original.wav' });
	await pending;
	assert.deepEqual(requests, []);
});

test('destination admission errors remain visible and release the action preparation fence', async () => {
	const { actions, fileService } = await fixture();
	fileService.prepareOriginalOverwrite = () => Promise.reject(new Error('The original file changed'));
	await assert.rejects(actions.overwriteOriginal(), /original file changed/u);
	assert.equal(actions.overwriteOriginalAvailable(), true);
});

test('removing all material while acquiring the destination prevents an empty overwrite', async () => {
	const { actions, fileService, requests, clearClips } = await fixture();
	let resolve!: (value: unknown) => void;
	fileService.prepareOriginalOverwrite = () => new Promise((settle) => { resolve = settle; });
	const pending = actions.overwriteOriginal();
	clearClips();
	resolve({ id: 'target', name: 'original.wav' });
	await pending;
	assert.deepEqual(requests, []);
});
