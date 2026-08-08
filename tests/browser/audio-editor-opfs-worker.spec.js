import { expect, test } from '@playwright/test';

import { hasMediaRecorderCapability } from './helpers/media-recorder-capability.js';

const DATABASE_NAME = 'kw-media-audio-editor';
const DATABASE_VERSION = 8;
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.describe('dedicated OPFS storage worker', () => {
	test.beforeEach(async ({ context, page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
		await context.addInitScript(() => {
			globalThis.__opfsMainThreadFallbacks = { createWritable: 0, getFile: 0 };
			const prototype = globalThis.FileSystemFileHandle?.prototype;
			if (!prototype) return;
			Object.defineProperty(prototype, 'createWritable', {
				configurable: true,
				value() {
					globalThis.__opfsMainThreadFallbacks.createWritable += 1;
					throw new Error('Main-thread OPFS writes are disabled by the worker-boundary witness.');
				},
			});
			Object.defineProperty(prototype, 'getFile', {
				configurable: true,
				value() {
					globalThis.__opfsMainThreadFallbacks.getFile += 1;
					throw new Error('Main-thread OPFS reads are disabled by the worker-boundary witness.');
				},
			});
		});
	});

	test('opfs-multitab-writer persists media and transfers one project writer', async ({ context, page }) => {
		test.skip(!await page.evaluate(hasMediaRecorderCapability), 'Generated WebM fixtures require MediaRecorder.');
		test.setTimeout(90_000);
		const workerRequests = [];
		page.on('request', (request) => {
			if (request.url().includes('opfs-sync-worker')) workerRequests.push(request.url());
		});
		await page.goto('/framescaper/en/');
		let editor = await waitForVideoEditor(page);
		const fixture = await createGeneratedVideoFixture(page);
		await importVideo(editor, fixture);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
		await expect(editor.locator('[data-video-preview-clip]')).toBeVisible();

		const inventory = await persistedOpfsInventory(page, fixture.name);
		expect(inventory.sourceStorage).toBe('opfs-pcm-v1');
		expect(inventory.mediaStorage).toBe('opfs');
		expect(inventory.derivativeCount).toBeGreaterThan(0);
		expect(inventory.derivativeStorage).toEqual(['opfs']);
		expect(await mainThreadFallbacks(page)).toEqual({ createWritable: 0, getFile: 0 });
		expect(workerRequests.length).toBeGreaterThan(0);

		await page.reload();
		editor = await waitForVideoEditor(page);
		await expect(editor.locator('[data-video-preview-clip]')).toBeVisible();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await page.waitForTimeout(150);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(await mainThreadFallbacks(page)).toEqual({ createWritable: 0, getFile: 0 });

		const secondPage = await context.newPage();
		await secondPage.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
		await secondPage.goto('/framescaper/en/');
		const second = await waitForVideoEditor(secondPage);
		await expect(second.locator('[data-video-preview-clip]')).toBeVisible();
		const firstAddTrack = editor.getByRole('button', { name: 'Add track', exact: true });
		const secondAddTrack = second.getByRole('button', { name: 'Add track', exact: true });
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only', { timeout: 5_000 });
		const firstTrackCount = await editor.getAttribute('data-track-count');
		await firstAddTrack.click();
		await expect(editor).toHaveAttribute('data-track-count', firstTrackCount);
		await expect(second).not.toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(secondAddTrack).toBeEnabled();
		await secondPage.close();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only', { timeout: 5_000 });
		await expect(firstAddTrack).toBeEnabled();
	});
});

async function waitForVideoEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	return editor;
}

async function importVideo(editor, fixture) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.locator('[data-import-input]').setInputFiles(fixture);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
}

async function createGeneratedVideoFixture(page) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 54;
		const context = canvas.getContext('2d');
		const videoStream = canvas.captureStream(15);
		const audioContext = new AudioContext({ sampleRate: 48_000 });
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		const audioDestination = audioContext.createMediaStreamDestination();
		oscillator.frequency.value = 330;
		gain.gain.value = 0.06;
		oscillator.connect(gain).connect(audioDestination);
		oscillator.start();
		await audioContext.resume();
		const stream = new MediaStream([
			...videoStream.getVideoTracks(),
			...audioDestination.stream.getAudioTracks(),
		]);
		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
			? (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
				? 'video/webm;codecs=vp8,opus'
				: 'video/webm;codecs=vp8')
			: 'video/webm';
		const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 120_000 });
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < 16; frame += 1) {
			context.fillStyle = frame % 2 ? '#245fce' : '#d92f45';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#ffffff';
			context.fillRect(frame * 5, 20, 12, 12);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		oscillator.stop();
		await audioContext.close();
		const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	});
	return {
		name: 'opfs-worker-video.webm',
		mimeType: 'video/webm',
		buffer: Buffer.from(base64, 'base64'),
	};
}

async function persistedOpfsInventory(page, sourceName) {
	return page.evaluate(async ({ databaseName, databaseVersion, name }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName, databaseVersion));
		try {
			const transaction = database.transaction(['sources', 'mediaAssets', 'videoDerivatives'], 'readonly');
			const [sources, media, derivatives] = await Promise.all([
				request(transaction.objectStore('sources').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('videoDerivatives').getAll()),
			]);
			const source = sources.find((candidate) => candidate.mimeType === 'audio/x-soundscaper-extracted');
			const mediaRecord = media.find((candidate) => candidate.name === name);
			const related = derivatives.filter((candidate) => candidate.sourceId === mediaRecord?.sourceId);
			return {
				sourceStorage: source?.storage ?? null,
				mediaStorage: mediaRecord?.storage ?? null,
				derivativeCount: related.length,
				derivativeStorage: [...new Set(related.map((candidate) => candidate.storage))].sort(),
			};
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, databaseVersion: DATABASE_VERSION, name: sourceName });
}

function mainThreadFallbacks(page) {
	return page.evaluate(() => globalThis.__opfsMainThreadFallbacks);
}
