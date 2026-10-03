/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerExternalMediaIpc } from '../desktop/external-media-ipc.ts';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { acceptsFile } from '../desktop/validation.js';
import { IPC } from '../desktop/constants.js';
import { attachExternalMedia } from '../src/common/editor/desktop-external-media.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createBaselineAudioEditorProject } from './helpers/baseline-scape-runtime.ts';

test('external originals reopen through a freshly selected project after a native restart', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-external-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const originalPath = join(root, 'original.wav');
	const bytes = new TextEncoder().encode('external original');
	await writeFile(originalPath, bytes);
	const owner = {}, reads = new ReadCapabilityStore();
	context.after(() => reads.dispose());
	const handlers = new Map<string, (event: unknown, value: unknown) => Promise<unknown>>();
	registerExternalMediaIpc({ channels: IPC, readCapabilities: reads, ownerFor: () => owner, acceptsFile,
		handle: (channel, handler) => { handlers.set(channel, handler); } });
	const selected = await reads.registerSelectedRangePath(originalPath, { owner });
	const reference = await handlers.get(IPC.captureExternalMedia)!(null, selected.id);
	assert.equal(typeof reference, 'string');
	const source = attachExternalMedia({ id: 'audio', kind: 'audio', name: 'original.wav', frameCount: 4,
		sampleRate: 48_000, channelCount: 1, chunkFrames: 4 }, {
		reference: String(reference), byteLength: bytes.byteLength, sha256: digestScapeBytes(bytes),
	}, 'audio');
	const project = createBaselineAudioEditorProject({ sources: [source] });
	const exported = await exportScapeProject(project, {
		readSourceChunks: async () => { throw new Error('Reference saves must not read PCM.'); },
		loadMediaAsset: async () => { throw new Error('Reference saves must not read media.'); },
	}, { externalMedia: true });
	assert.ok(exported.blob);
	await reads.release(selected.id, { owner });
	for (const extension of ['sscape', 'fscape']) {
		const path = join(root, `project.${extension}`);
		await writeFile(path, new Uint8Array(await exported.blob.arrayBuffer()));
		const archive = await reads.registerScapeRangePath(path, { owner });
		assert.equal(await handlers.get(IPC.captureExternalMedia)!(null, archive.id), null);
		const resolved = await handlers.get(IPC.resolveExternalMedia)!(null, { projectReadId: archive.id, sourceId: 'audio' });
		assert.ok(resolved && typeof resolved === 'object' && 'id' in resolved);
		assert.equal('path' in resolved, false);
		assert.equal((await reads.resolveHelperGrant(String(resolved.id), { owner }))?.path, originalPath);
		await assert.rejects(handlers.get(IPC.resolveExternalMedia)!(null, { projectReadId: archive.id, sourceId: 'forged' }), /source|selected project/u);
		await reads.release(archive.id, { owner });
		await assert.rejects(handlers.get(IPC.resolveExternalMedia)!(null, { projectReadId: archive.id, sourceId: 'audio' }), /selected desktop project/u);
	}
	const untrusted = new Map<string, (event: unknown, value: unknown) => Promise<unknown>>();
	registerExternalMediaIpc({ channels: IPC, readCapabilities: reads, ownerFor: () => ({}), acceptsFile,
		handle: (channel, handler) => { untrusted.set(channel, handler); } });
	const archive = await reads.registerScapeRangePath(join(root, 'project.sscape'), { owner });
	await assert.rejects(untrusted.get(IPC.resolveExternalMedia)!(null, { projectReadId: archive.id, sourceId: 'audio' }), /selected desktop project/u);
	await rm(originalPath);
	await assert.rejects(handlers.get(IPC.resolveExternalMedia)!(null, { projectReadId: archive.id, sourceId: 'audio' }), /unavailable.*Restore/u);
});
