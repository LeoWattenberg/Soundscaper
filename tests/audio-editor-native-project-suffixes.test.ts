/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import {
	createFixture,
	nativeFile,
	project,
} from './helpers/native-project-service-fixture.ts';

test('every accepted suffix opens while a save always writes the active product suffix', async () => {
	for (const openedName of ['legacy.scape', 'home.sscape', 'foreign.FSCAPE', 'reserved.liscape']) {
		const saved: string[] = [];
		const fixture = createFixture({
			projectFileExtension: '.sscape',
			importScapeProject: async () => ({
				project: project('cross-suffix'), readOnly: false, manifest: { format: 'scape-project' },
			}),
			exportScapeProject: async () => ({ blob: new Blob(['x']), manifest: {} }),
			fileService: {
				isDesktop: false,
				chooseSaveTarget: async () => ({ browserDownload: true }),
				prepareSave: async (request) => ({
					mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true },
				}),
				saveFile: async (request) => {
					saved.push(request.suggestedName);
					return { fileName: request.suggestedName, size: request.blob.size };
				},
			},
		});
		const service = createNativeProjectService(fixture.runtime);
		assert.equal((await service.openScape(nativeFile(openedName, 8)))?.project.id, 'cross-suffix');
		await service.saveScape({ fileName: openedName, useFileSystemAccess: false });
		assert.deepEqual(saved, [`${openedName.replace(/\.[^.]+$/u, '')}.sscape`], openedName);
	}
});

test('a Framescaper save renames a Soundscaper project without touching its stem', async () => {
	const saved: string[] = [];
	const fixture = createFixture({
		projectFileExtension: '.fscape',
		exportScapeProject: async () => ({ blob: new Blob(['x']), manifest: {} }),
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => ({ browserDownload: true }),
			prepareSave: async (request) => ({
				mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true },
			}),
			saveFile: async (request) => {
				saved.push(request.suggestedName);
				return { fileName: request.suggestedName, size: request.blob.size };
			},
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	await service.saveScape({ fileName: 'Mix.sscape', useFileSystemAccess: false });
	await service.saveScape({ fileName: 'Mix v2.1', useFileSystemAccess: false });
	assert.deepEqual(saved, ['Mix.fscape', 'Mix v2.1.fscape']);
});

test('a retained future archive is renamed to the active suffix but copied byte for byte', async () => {
	const archive = new File([Uint8Array.of(80, 75, 3, 4, 42)], 'future.scape', {
		type: 'application/vnd.soundscaper.scape+zip',
	});
	const saved: Array<Readonly<{ name: string; blob: Blob }>> = [];
	const fixture = createFixture({
		projectFileExtension: '.fscape',
		importScapeProject: async () => ({
			project: { ...project('future-project'), schemaVersion: 99 },
			readOnly: true,
			manifest: { format: 'scape-project' },
		}),
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => ({ browserDownload: true }),
			prepareSave: async (request) => ({
				mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true },
			}),
			saveFile: async (request) => {
				saved.push({ name: request.suggestedName, blob: request.blob });
				return { fileName: request.suggestedName, size: request.blob.size };
			},
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	await service.openScape(archive);
	fixture.state.readOnly = true;
	await service.saveScape({ fileName: 'future.scape', saveCopy: true, useFileSystemAccess: false });
	await service.saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.deepEqual(saved.map(({ name }) => name), ['future.fscape', 'future-project.fscape']);
	for (const { blob } of saved) {
		assert.equal(blob, archive, 'the copy must hand over the exact retained archive');
	}
});
