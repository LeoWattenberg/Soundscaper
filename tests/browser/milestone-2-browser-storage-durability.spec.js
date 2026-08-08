import { readFile } from 'node:fs/promises';

import {
	expect,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { hasMediaRecorderCapability } from './helpers/media-recorder-capability.js';

const DATABASE_NAME = 'kw-media-audio-editor';
const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

test.describe('milestone 2 browser storage durability', () => {
	registerAudioEditorHooks();

	test('indexeddb-quota-refusal preserves the last committed project', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 10_000,
		});

		await page.evaluate(() => {
			const originalPut = IDBObjectStore.prototype.put;
			Object.defineProperty(IDBObjectStore.prototype, 'put', {
				configurable: true,
				value(value, key) {
					if (this.name === 'projects') {
						Object.defineProperty(IDBObjectStore.prototype, 'put', {
							configurable: true,
							value: originalPut,
						});
						throw new DOMException('Injected IndexedDB quota exhaustion.', 'QuotaExceededError');
					}
					return originalPut.call(this, value, key);
				},
			});
		});
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'dirty', {
			timeout: 10_000,
		});

		await page.reload();
		const reopened = await bootedEditor(page);
		await expect(reopened).toHaveAttribute('data-track-count', '2');
		await expect(reopened.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	});

	test('opfs-quota-refusal preserves the project or uses the IndexedDB fallback', async ({ page }) => {
		test.skip(!await page.evaluate(hasMediaRecorderCapability), 'Generated WebM fixtures require MediaRecorder.');
		test.setTimeout(60_000);
		let wrappedWorkerRequests = 0;
		await page.route(/\/assets\/opfs-sync-worker-[^/?]+\.js(?:\?.*)?$/u, async (route) => {
			wrappedWorkerRequests += 1;
			const response = await route.fetch();
			const original = await response.text();
			const injected = original.replace(
				/let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.access\.write\(([^;]+)\);/u,
				"throw new DOMException('Injected OPFS quota exhaustion.','QuotaExceededError');let $1=0;",
			);
			expect(injected).not.toBe(original);
			return route.fulfill({
				status: 200,
				contentType: 'text/javascript; charset=utf-8',
				body: injected,
			});
		});

		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const fixture = await generatedVideoFixture(page);
		await editor.locator('[data-import-input]').setInputFiles(fixture);
		await expect.poll(async () => {
			const clipCount = Number(await editor.getAttribute('data-clip-count'));
			const status = await editor.locator('[data-status]').getAttribute('data-state');
			if (clipCount > 0) return 'indexeddb-fallback';
			if (status === 'error') return 'opfs-refused';
			return 'pending';
		}, { timeout: 30_000 }).toMatch(/^(?:indexeddb-fallback|opfs-refused)$/u);
		expect(wrappedWorkerRequests).toBeGreaterThan(0);
		const outcome = Number(await editor.getAttribute('data-clip-count')) > 0
			? 'indexeddb-fallback'
			: 'opfs-refused';

		if (outcome === 'opfs-refused') {
			await expect(editor).toHaveAttribute('data-clip-count', '0');
			await page.reload();
			const reopened = await bootedEditor(page);
			await expect(reopened).toHaveAttribute('data-clip-count', '0');
			await expect(reopened.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			return;
		}

		const storageKinds = await persistedSourceStorageKinds(page);
		expect(storageKinds.length).toBeGreaterThan(0);
		expect(storageKinds).not.toContain('opfs');
		expect(storageKinds).not.toContain('opfs-pcm-v1');
		await page.reload();
		const reopened = await bootedEditor(page);
		await expect(reopened).toHaveAttribute('data-clip-count', '2');
	});

	test('storage-eviction-recovery restores an exported project after local storage loss', async ({ context, page }) => {
		await page.addInitScript(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: undefined,
		}));
		let editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 10_000,
		});
		const projectId = await editor.getAttribute('data-project-id');
		const archive = await exportProject(page, editor);

		await page.close();
		const recoveryPage = await context.newPage();
		await recoveryPage.goto('/logo/logo-klein-schwarz.svg');
		await recoveryPage.evaluate(async (databaseName) => {
			await new Promise((resolve, reject) => {
				const request = indexedDB.deleteDatabase(databaseName);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
				request.onblocked = () => reject(new Error('Editor storage eviction was blocked.'));
			});
		}, DATABASE_NAME);

		await recoveryPage.goto('/embed/en/');
		editor = await bootedEditor(recoveryPage);
		await expect(editor).toHaveAttribute('data-track-count', '1');
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'eviction-recovery.scape',
			mimeType: SCAPE_MIME_TYPE,
			buffer: archive,
		});
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 10_000,
		});
	});
});

async function bootedEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function exportProject(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	const download = await downloading;
	const path = await download.path();
	expect(path).toBeTruthy();
	const archive = await readFile(path);
	await download.delete();
	return archive;
}

async function generatedVideoFixture(page) {
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
		const recorder = new MediaRecorder(stream, {
			mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
				? 'video/webm;codecs=vp8,opus'
				: MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
					? 'video/webm;codecs=vp8'
				: 'video/webm',
			videoBitsPerSecond: 120_000,
		});
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
		name: 'm2-opfs-quota.webm',
		mimeType: 'video/webm',
		buffer: Buffer.from(base64, 'base64'),
	};
}

async function persistedSourceStorageKinds(page) {
	return page.evaluate(async (databaseName) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['sources', 'mediaAssets'], 'readonly');
			const [sources, mediaAssets] = await Promise.all([
				request(transaction.objectStore('sources').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
			]);
			return [...sources, ...mediaAssets].map(({ storage }) => storage).filter(Boolean);
		} finally {
			database.close();
		}
	}, DATABASE_NAME);
}
