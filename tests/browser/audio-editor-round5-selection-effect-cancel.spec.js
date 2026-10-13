/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction,
	importFiles } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME, SOUNDSCAPER_OPFS_DIRECTORY_NAME } from './helpers/editor-databases.js';

test('Cancel during selection-effect rendering leaves the recording unchanged', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'room-recording.wav', frequency: 440,
		duration: 30, channelCount: 1, channelAmplitudes: [0.1] });
	await importFiles(editor, [recording]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	await expect(editor.locator('[data-workspace-panel="history"] [data-history-list] > li').first()).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const original = await cancellationSnapshot(page, await editor.getAttribute('data-project-id'));
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(editor.locator('[data-editor-task-progress]')).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden({ timeout: 30_000 });
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect(await cancellationSnapshot(page, await editor.getAttribute('data-project-id'))).toEqual(original);
});

async function cancellationSnapshot(page, projectId) {
	return page.evaluate(async ({ databaseName, opfsDirectoryName, projectId }) => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const fingerprint = async bytes => {
			if (!bytes.byteLength) throw new Error('Referenced PCM has an empty stored body.');
			return { byteLength: bytes.byteLength, sha256: Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
				value => value.toString(16).padStart(2, '0'),
			).join('') };
		};
		const database = await result(indexedDB.open(databaseName));
		let project, sources, chunks;
		try {
			const transaction = database.transaction(['projects', 'sources', 'sourceChunks'], 'readonly');
			[project, sources, chunks] = await Promise.all([
				result(transaction.objectStore('projects').get(projectId)),
				result(transaction.objectStore('sources').getAll()),
				result(transaction.objectStore('sourceChunks').getAll()),
			]);
		} finally { database.close(); }
		if (!project) throw new Error('The cancellation project was not saved.');
		const referencedKeys = [...new Set(project.clips.map(clip =>
			project.sources.find(source => source.id === clip.sourceId)?.storageKey || clip.sourceId,
		))].sort();
		if (!referencedKeys.length) throw new Error('The cancellation project has no referenced PCM.');
		const pcm = [];
		for (const key of referencedKeys) {
			const source = sources.find(candidate => candidate.id === key);
			if (!source) throw new Error(`Referenced PCM source ${key} was not found.`);
			if (!source.chunkCount || !source.frameCount) throw new Error('Referenced PCM has no stored samples.');
			let bodies;
			if (source.storage === 'opfs-pcm-v1') {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle(opfsDirectoryName);
				const file = await (await directory.getFileHandle(source.path)).getFile();
				bodies = [await fingerprint(await file.arrayBuffer())];
			} else if (source.storage === 'indexeddb-chunks') {
				const records = chunks.filter(chunk => chunk.sourceToken === source.sourceToken)
					.sort((left, right) => left.index - right.index);
				if (records.length !== source.chunkCount) throw new Error('Referenced PCM chunks are missing.');
				bodies = await Promise.all(records.map(async chunk => ({
					index: chunk.index, frames: chunk.frames, encoding: chunk.encoding ?? null,
					pcmCrc32: chunk.pcmCrc32 ?? null,
					payload: chunk.payload ? await fingerprint(chunk.payload) : null,
					channels: chunk.channels ? await Promise.all(chunk.channels.map(fingerprint)) : null,
				})));
				if (bodies.some(body => !body.payload && !body.channels?.length)) {
					throw new Error('Referenced PCM chunk has no stored body.');
				}
			} else throw new Error(`Unexpected referenced PCM storage: ${source.storage}`);
			pcm.push({ id: key, storage: source.storage, sourceToken: source.sourceToken, path: source.path,
				channelCount: source.channelCount, sampleRate: source.sampleRate,
				frameCount: source.frameCount, chunkFrames: source.chunkFrames, chunkCount: source.chunkCount, bodies });
		}
		// Hash the actual canonical PCM bodies, including compressed payload bytes;
		// identical bodies and geometry preserve every sample without rendering a mix.
		return {
			project: { id: project.id, sampleRate: project.sampleRate, masterChannels: project.masterChannels,
				master: project.master, mixer: project.mixer, sources: project.sources, clips: project.clips,
				tracks: project.tracks, selection: project.selection },
			pcm,
			history: [...document.querySelectorAll('[data-workspace-panel="history"] [data-history-list] > li')]
				.map(entry => ({ text: entry.textContent, redo: entry.getAttribute('data-redo') })),
		};
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, opfsDirectoryName: SOUNDSCAPER_OPFS_DIRECTORY_NAME, projectId });
}
