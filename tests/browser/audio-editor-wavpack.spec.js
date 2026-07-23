import { expect, test } from '@playwright/test';

const DATABASE_NAME = 'kw-media-audio-editor';
const DATABASE_VERSION = 2;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const fixture = createWavFixture({
	name: 'browser-wavpack-persistence.wav',
	frequency: 293.66,
	duration: 2.2,
	sampleRate: 48_000,
	channelCount: 1,
});

test.describe('adaptive WavPack PCM persistence', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('persists, reloads, edits, and first-access migrates PCM', async ({ page }) => {
		test.setTimeout(60_000);
		let editor = await bootEditor(page);
		await importAudio(editor, fixture);
		await expect(clipByName(editor, fixture.name)).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		const persisted = await persistedPcmState(page, fixture.name);
		expect(['opfs-pcm-v1', 'indexeddb-chunks']).toContain(persisted.storage);
		expect(persisted.pcmEncodingVersion).toBe(1);
		expect(persisted.uncompressedBytes).toBeGreaterThan(0);
		expect(persisted.storedBytes).toBeLessThan(persisted.uncompressedBytes);
		expect(persisted.wavpackChunkCount).toBeGreaterThan(0);
		expect(persisted.compressionRatio).toBeLessThan(1);
		expect(persisted.containerMagic).toBe(persisted.storage === 'opfs-pcm-v1' ? 'SSPCMWV1' : null);
		expect(persisted.footerMagic).toBe(persisted.storage === 'opfs-pcm-v1' ? 'SSPCMIDX' : null);
		expect(persisted.encodings).toContain('wavpack-f32-v1');

		await page.reload();
		editor = await waitForEditor(page);
		await expect(clipByName(editor, fixture.name)).toBeVisible();
		await seekAndPlay(editor);

		await applySampleEdit(page, editor, fixture.name);
		await expect.poll(
			() => copyOnWriteState(page),
			{ timeout: 20_000 },
		).not.toBeNull();
		const overlayState = await copyOnWriteState(page);
		expect(overlayState.pcmEncodingVersion).toBe(1);
		expect(overlayState.overrideChunkCount).toBeGreaterThan(0);
		expect(overlayState.encodings).not.toContain('legacy-planar');
		expect(overlayState.encodings.length).toBe(overlayState.overrideChunkCount);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, fixture.name)).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		const seeded = await seedLegacyIndexedDbSource(page, fixture.name);
		expect(seeded.chunkCount).toBeGreaterThan(1);
		expect(await legacySourceState(page, seeded.sourceId)).toMatchObject({
			pcmEncodingVersion: null,
			legacyChunkCount: seeded.chunkCount,
			encodedChunkCount: 0,
		});

		await page.reload();
		editor = await waitForEditor(page);
		await expect(clipByName(editor, fixture.name)).toBeVisible();
		await seekAndPlay(editor);
		await expect.poll(
			() => legacySourceState(page, seeded.sourceId),
			{ timeout: 20_000 },
		).toMatchObject({
			pcmEncodingVersion: 1,
			legacyChunkCount: 0,
			encodedChunkCount: seeded.chunkCount,
		});
		const migrated = await legacySourceState(page, seeded.sourceId);
		expect(migrated.wavpackChunkCount).toBeGreaterThan(0);
		expect(migrated.storedBytes).toBeLessThan(migrated.uncompressedBytes);
	});
});

function createWavFixture({
	name,
	frequency,
	duration,
	sampleRate,
	channelCount,
}) {
	const frameCount = Math.round(duration * sampleRate);
	const bytesPerSample = 2;
	const dataLength = frameCount * channelCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);

	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
	buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
	buffer.writeUInt16LE(bytesPerSample * 8, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);

	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 0.35;
			buffer.writeInt16LE(
				Math.round(sample * 32767),
				44 + (frame * channelCount + channel) * bytesPerSample,
			);
		}
	}
	return { name, mimeType: 'audio/wav', buffer };
}

async function bootEditor(page) {
	await page.goto('/embed/en/');
	return waitForEditor(page);
}

async function waitForEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	return editor;
}

async function importAudio(editor, file) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.locator('[data-import-input]').setInputFiles(file);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
}

function clipByName(editor, name) {
	return editor.locator('[data-clip-id]').filter({ hasText: name });
}

async function seekAndPlay(editor) {
	const ruler = editor.locator('[data-ruler]');
	await ruler.click({ position: { x: 160, y: 8 } });
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await editor.page().waitForTimeout(150);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

async function applySampleEdit(page, editor, name) {
	const clip = clipByName(editor, name);
	await clip.click({ position: { x: 24, y: 10 } });
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
	for (let step = 0; step < 9; step += 1) await zoomIn.click();
	const sampleTools = editor.getByRole('toolbar', { name: 'Sample tools', exact: true });
	await expect(sampleTools).toBeVisible();
	await expect(sampleTools.getByRole('button', { name: 'Sample pencil', exact: true })).toHaveAttribute('aria-pressed', 'true');

	await clip.scrollIntoViewIfNeeded();
	const box = await clip.boundingBox();
	expect(box).not.toBeNull();
	const start = { x: box.x + 80, y: box.y + Math.min(70, box.height - 8) };
	const end = { x: box.x + 86, y: box.y + Math.min(82, box.height - 5) };
	await clip.dispatchEvent('pointerdown', {
		pointerId: 0, pointerType: 'mouse', button: 0, buttons: 1,
		clientX: start.x, clientY: start.y,
	});
	await clip.dispatchEvent('pointermove', {
		pointerId: 0, pointerType: 'mouse', button: 0, buttons: 1,
		clientX: end.x, clientY: end.y,
	});
	await clip.dispatchEvent('pointerup', {
		pointerId: 0, pointerType: 'mouse', button: 0, buttons: 0,
		clientX: end.x, clientY: end.y,
	});
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
}

async function persistedPcmState(page, name) {
	return page.evaluate(async ({ databaseName, databaseVersion, sourceName }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName, databaseVersion));
		try {
			const sources = await request(database.transaction('sources', 'readonly').objectStore('sources').getAll());
			const source = sources.find((candidate) => candidate.name === sourceName && candidate.storage !== 'copy-on-write');
			if (!source) throw new Error(`Persisted source ${sourceName} was not found.`);
			let encodings = [];
			let containerMagic = null;
			let footerMagic = null;
			if (source.storage === 'opfs-pcm-v1') {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle('audio-editor-sources');
				const file = await (await directory.getFileHandle(source.path)).getFile();
				containerMagic = new TextDecoder().decode(await file.slice(0, 8).arrayBuffer());
				const footerBytes = await file.slice(file.size - 32).arrayBuffer();
				const footer = new DataView(footerBytes);
				footerMagic = new TextDecoder().decode(footerBytes.slice(0, 8));
				const chunkCount = footer.getUint32(12, true);
				const indexOffset = Number(footer.getBigUint64(16, true));
				const index = new Uint8Array(await file.slice(indexOffset, indexOffset + chunkCount * 24).arrayBuffer());
				encodings = Array.from(
					{ length: chunkCount },
					(_, chunkIndex) => index[chunkIndex * 24 + 16] === 1 ? 'wavpack-f32-v1' : 'raw-f32le',
				);
			} else {
				const records = await request(database.transaction('sourceChunks', 'readonly')
					.objectStore('sourceChunks').index('sourceToken').getAll(source.sourceToken));
				encodings = records.map((record) => record.encoding || 'legacy-planar');
			}
			return {
				storage: source.storage,
				pcmEncodingVersion: source.pcmEncodingVersion,
				uncompressedBytes: source.uncompressedBytes,
				storedBytes: source.storedBytes,
				wavpackChunkCount: source.wavpackChunkCount,
				rawChunkCount: source.rawChunkCount,
				compressionRatio: source.compressionRatio,
				containerMagic,
				footerMagic,
				encodings,
			};
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		databaseVersion: DATABASE_VERSION,
		sourceName: name,
	});
}

async function copyOnWriteState(page) {
	return page.evaluate(async ({ databaseName, databaseVersion }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName, databaseVersion));
		try {
			const sources = await request(database.transaction('sources', 'readonly').objectStore('sources').getAll());
			const source = sources.find((candidate) => candidate.storage === 'copy-on-write');
			if (!source) return null;
			const records = await request(database.transaction('sourceChunks', 'readonly')
				.objectStore('sourceChunks').index('sourceToken').getAll(source.sourceToken));
			return {
				pcmEncodingVersion: source.pcmEncodingVersion,
				overrideChunkCount: source.overrideChunkCount,
				encodings: records
					.sort((left, right) => left.index - right.index)
					.map((record) => record.encoding || 'legacy-planar'),
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, databaseVersion: DATABASE_VERSION });
}

async function seedLegacyIndexedDbSource(page, name) {
	return page.evaluate(async ({
		databaseName,
		databaseVersion,
		sourceName,
	}) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const transactionDone = (transaction) => new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
		});
		const database = await request(indexedDB.open(databaseName, databaseVersion));
		let oldPath = null;
		try {
			const sources = await request(database.transaction('sources', 'readonly').objectStore('sources').getAll());
			const source = sources.find((candidate) => candidate.name === sourceName && candidate.storage !== 'copy-on-write');
			if (!source) throw new Error(`Persisted source ${sourceName} was not found.`);
			const chunkFrames = 65_536;
			const frameCount = source.frameCount ?? source.frameLength;
			const chunkCount = Math.ceil(frameCount / chunkFrames);
			const channelCount = source.channelCount;
			const sampleRate = source.sampleRate || 48_000;
			const token = `${source.id}:legacy-browser-fixture`;
			const transaction = database.transaction(['sources', 'sourceChunks', 'analysis'], 'readwrite');
			const chunks = transaction.objectStore('sourceChunks');
			for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
				const frames = Math.min(chunkFrames, frameCount - chunkIndex * chunkFrames);
				const channels = Array.from({ length: channelCount }, (_, channelIndex) => {
					const samples = new Float32Array(frames);
					for (let frame = 0; frame < frames; frame += 1) {
						const absoluteFrame = chunkIndex * chunkFrames + frame;
						samples[frame] = Math.sin(
							2 * Math.PI * (220 + channelIndex * 55) * absoluteFrame / sampleRate,
						) * 0.25;
					}
					return samples.buffer;
				});
				chunks.put({
					key: `${token}:${String(chunkIndex).padStart(10, '0')}`,
					sourceToken: token,
					index: chunkIndex,
					frames,
					channels,
					createdAt: Date.now() + chunkIndex,
				});
			}
			const legacy = {
				...source,
				storage: 'indexeddb-chunks',
				sourceToken: token,
				chunkFrames,
				chunkCount,
			};
			oldPath = legacy.path || null;
			delete legacy.path;
			delete legacy.pcmEncodingVersion;
			delete legacy.uncompressedBytes;
			delete legacy.storedBytes;
			delete legacy.wavpackChunkCount;
			delete legacy.rawChunkCount;
			delete legacy.compressionRatio;
			delete legacy.migratedAt;
			transaction.objectStore('sources').put(legacy);
			transaction.objectStore('analysis').delete(`audio-editor-peaks-v1:${source.id}`);
			transaction.objectStore('analysis').delete(`audio-editor-peaks-v2:${source.id}`);
			await transactionDone(transaction);
			return { sourceId: source.id, token, chunkCount, oldPath };
		} finally {
			database.close();
			if (oldPath) {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle('audio-editor-sources');
				await directory.removeEntry(oldPath).catch(() => undefined);
			}
		}
	}, {
		databaseName: DATABASE_NAME,
		databaseVersion: DATABASE_VERSION,
		sourceName: name,
	});
}

async function legacySourceState(page, sourceId) {
	return page.evaluate(async ({
		databaseName,
		databaseVersion,
		id,
	}) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName, databaseVersion));
		try {
			const source = await request(database.transaction('sources', 'readonly').objectStore('sources').get(id));
			const records = await request(database.transaction('sourceChunks', 'readonly')
				.objectStore('sourceChunks').index('sourceToken').getAll(source.sourceToken));
			return {
				pcmEncodingVersion: source.pcmEncodingVersion ?? null,
				legacyChunkCount: records.filter((record) => Array.isArray(record.channels)).length,
				encodedChunkCount: records.filter((record) => record.encoding && record.payload).length,
				uncompressedBytes: source.uncompressedBytes,
				storedBytes: source.storedBytes,
				wavpackChunkCount: source.wavpackChunkCount,
			};
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		databaseVersion: DATABASE_VERSION,
		id: sourceId,
	});
}
