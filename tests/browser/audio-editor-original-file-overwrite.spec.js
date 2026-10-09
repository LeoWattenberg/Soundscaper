/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { ordinaryTailM4aFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';
import { ordinaryOggOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { decodePinnedVideoRgbFrame, readRgbPixel } from './helpers/pinned-video-frame-decoder.mjs';
import {
	installOriginalOverwriteDesktopRenderer,
	installPinnedOriginalOverwriteVideoCodec,
	releaseOriginalOverwriteDesktopRenderer,
} from './helpers/original-overwrite-desktop-video.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	closeClipProperties,
	collectClientErrors,
	commitInput,
	importFiles,
	openClipProperties,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

async function installOriginalOverwriteBridge(page, productId, fixtures = [toneA, toneB], holdPreparation = false) {
	for (const fixture of fixtures) {
		await page.route(`**/__e2e-overwrite/${fixture.name}`, (route) => route.fulfill({
			body: fixture.buffer, contentType: fixture.mimeType,
			headers: { 'Content-Length': String(fixture.buffer.byteLength) },
		}));
	}
	await page.addInitScript(({ productId, files, holdPreparation }) => {
		const state = { imports: 0, preparedOriginals: [], savePickers: 0, completed: [], releasedOriginals: [], releasedTargets: [], statuses: [] };
		addEventListener('DOMContentLoaded', () => {
			new MutationObserver(() => {
				for (const element of document.querySelectorAll('[data-editor-toast], [data-status]')) {
					const value = element.textContent;
					if (value && !state.statuses.includes(value)) state.statuses.push(value);
				}
			}).observe(document.body, { subtree: true, childList: true, characterData: true });
		});
		const targets = new Map();
		const sessions = new Map();
		const bridge = Object.freeze({
			...globalThis.__originalOverwriteVideoBridge,
			chooseFiles: async () => {
				const index = Math.min(state.imports++, files.length - 1);
				const file = files[index];
				return [{ id: String(index + 1).repeat(64), readProfile: 'materialized-v1',
					url: `${location.origin}/__e2e-overwrite/${file.name}`, ...file,
					originalFile: { id: String(index + 1).repeat(48), name: file.name } }];
			},
			releaseRead: async () => true,
			prepareOriginalOverwrite: async (id) => {
				state.preparedOriginals.push(id);
				const targetId = String(state.preparedOriginals.length + 3).repeat(48);
				targets.set(targetId, files[0].name);
				if (holdPreparation) await new Promise((resolve) => { state.releasePreparation = resolve; });
				return { id: targetId, name: files[0].name };
			},
			releaseOriginalFile: async (id) => { state.releasedOriginals.push(id); return true; },
			chooseSaveTarget: async () => { state.savePickers += 1; return null; },
			releaseSaveTarget: async (id) => { state.releasedTargets.push(id); return targets.delete(id); },
			beginWrite: async ({ targetId, size, maximumSize }) => {
				if (!targets.has(targetId)) throw new Error('The overwrite save target is unavailable.');
				const name = targets.get(targetId);
				targets.delete(targetId);
				const writeId = String(state.completed.length + 7).repeat(48);
				sessions.set(writeId, { name, bytes: [], maximumSize: size ?? maximumSize });
				return { writeId, chunkSize: 1024 * 1024 };
			},
			writeChunk: async ({ writeId, offset, bytes }) => {
				const session = sessions.get(writeId);
				if (offset !== session.bytes.length) throw new Error('The write offset is wrong.');
				for (const byte of bytes) session.bytes.push(byte);
				return { nextOffset: session.bytes.length };
			},
			patchFinalPrefix: async ({ writeId, bytes }) => {
				const session = sessions.get(writeId);
				for (let index = 0; index < bytes.length; index += 1) session.bytes[index] = bytes[index];
				return { byteLength: session.bytes.length };
			},
			finishWrite: async (writeId) => {
				const session = sessions.get(writeId);
				if (session.bytes.length > session.maximumSize) throw new Error('The file exceeds its declared size.');
				state.completed.push({ name: session.name, bytes: session.bytes });
				sessions.delete(writeId);
				return { byteLength: session.bytes.length };
			},
			abortWrite: async (writeId) => sessions.delete(writeId),
		});
		Object.defineProperty(globalThis, '__originalOverwriteFixture', { value: state });
		Object.defineProperty(globalThis, `${productId}Desktop`, { enumerable: true, value: Object.freeze({ v1: bridge }) });
	}, { productId, holdPreparation, files: fixtures.map(({ name, mimeType, buffer }) => ({
		name, mimeType, size: buffer.byteLength, lastModified: 123,
	})) });
}

test('deleting the imported clip during original destination preparation releases the unused target', async ({ page }) => {
	await installOriginalOverwriteBridge(page, 'soundscaper', [toneA], true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Import');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseFileAction(page, editor, `Overwrite ${toneA.name}`);
	await expect.poll(() => page.evaluate(() => globalThis.__originalOverwriteFixture.preparedOriginals.length)).toBe(1);
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await clip.press('Enter');
	await clip.press('Delete');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await page.evaluate(() => globalThis.__originalOverwriteFixture.releasePreparation());
	await expect.poll(() => page.evaluate(() => globalThis.__originalOverwriteFixture.releasedTargets)).toEqual(['4'.repeat(48)]);
	expect(await page.evaluate(() => globalThis.__originalOverwriteFixture.completed)).toEqual([]);
});

test('ordinary tail-metadata AAC import keeps the original overwrite menu available', async ({ page }) => {
	const file = await ordinaryTailM4aFixture();
	const fixture = { name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) };
	await installOriginalOverwriteBridge(page, 'soundscaper', [fixture]);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Import');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const menu = await openNestedCommandMenu(page, editor, 'File', []);
	await expect(menu.getByRole('menuitem', { name: `Overwrite ${fixture.name}`, exact: true })).toBeEnabled();
});

for (const extension of ['opus', 'ogg']) {
	test(`ordinary Ogg Opus import retains its supported overwrite action as .${extension}`, async ({ page }) => {
		const file = await ordinaryOggOpusFixture(extension);
		const fixture = { name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) };
		await installOriginalOverwriteBridge(page, 'soundscaper', [fixture]);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const menu = await openNestedCommandMenu(page, editor, 'File', []);
		await expect(menu.getByRole('menuitem', { name: `Overwrite ${fixture.name}`, exact: true })).toBeEnabled();
	});
}

for (const variant of [
	{ name: 'Dialogue.wav', bitDepth: 24, bext: { description: 'Location dialogue', timeReference: '172800000' } },
]) {
	test(`desktop original overwrite retains ${variant.name} delivery facts`, async ({ page }) => {
		const fixture = { name: variant.name, mimeType: 'audio/wav', buffer: Buffer.from(encodeWav(
			[Float32Array.from({ length: 2400 }, (_, index) => Math.sin(index / 17) * 0.2)],
			{ sampleRate: 48_000, bitDepth: variant.bitDepth, bext: variant.bext },
		)) };
		await installOriginalOverwriteBridge(page, 'soundscaper', [fixture]);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await chooseFileAction(page, editor, `Overwrite ${fixture.name}`);
		await expect.poll(() => page.evaluate(() => globalThis.__originalOverwriteFixture.completed.length)).toBe(1);
		const bytes = Uint8Array.from(await page.evaluate(() => globalThis.__originalOverwriteFixture.completed[0].bytes));
		const descriptor = await inspectWavBlobPcm(new Blob([bytes]));
		expect(descriptor?.bitDepth).toBe(variant.bitDepth);
		expect(descriptor?.sampleRate).toBe(48_000);
		expect(descriptor?.frameCount).toBe(2400);
		if (variant.bext) {
			expect(descriptor?.bext?.description).toBe(variant.bext.description);
			expect(descriptor?.bext?.timeReference).toBe(variant.bext.timeReference);
		}
	});
}

test.afterEach(async ({ page }) => { await releaseOriginalOverwriteDesktopRenderer(page); });

test.describe('Framescaper Electron video overwrite', () => {
	// The standard coverage collector maps ordinary browser builds, not this desktop renderer.
	test.use({ browserCoverage: false });
	test('framescaper desktop overwrites the edited original MP4 using its video settings without a chooser', async ({ browserName, page }) => {
		test.skip(browserName !== 'chromium', 'Electron runs its native codec composition in Chromium.');
		test.setTimeout(360_000);
		const source = videoTimingProbeMedia[0];
		await installOriginalOverwriteDesktopRenderer(page);
		await installPinnedOriginalOverwriteVideoCodec(page);
		await installOriginalOverwriteBridge(page, 'framescaper', [source.file]);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await chooseFileAction(page, editor, 'Import');
		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClip).toHaveCount(1);
		const fileMenu = await openNestedCommandMenu(page, editor, 'File', []);
		await expect(fileMenu.getByRole('menuitem', { name: `Overwrite ${source.file.name}`, exact: true })).toBeEnabled();
		await page.keyboard.press('Escape');

		await videoClip.focus();
		await videoClip.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
		const composition = page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
		await composition.getByRole('spinbutton', { name: 'Opacity (%)', exact: true }).fill('0');
		await composition.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(composition.getByRole('status')).toContainText('Composition applied.');
		await page.keyboard.press('Escape');
		await expect(composition).toBeHidden();
		await chooseFileAction(page, editor, `Overwrite ${source.file.name}`);
		try {
			await expect.poll(() => page.evaluate(() => globalThis.__originalOverwriteFixture.completed.length), {
				timeout: 90_000,
			}).toBe(1);
		} catch (error) {
			const statuses = await page.evaluate(() => globalThis.__originalOverwriteFixture.statuses);
			throw new Error(`The original video overwrite did not finish: ${statuses.join('\n')}`, { cause: error });
		}
		await expect(page.getByRole('dialog', { name: /Export/u })).toHaveCount(0);
		const state = await page.evaluate(() => ({
			prepared: globalThis.__originalOverwriteFixture.preparedOriginals,
			pickers: globalThis.__originalOverwriteFixture.savePickers,
			completed: globalThis.__originalOverwriteFixture.completed,
			plans: globalThis.__originalOverwriteVideoPlans,
		}));
		expect(state.prepared).toEqual(['1'.repeat(48)]);
		expect(state.pickers).toBe(0);
		expect(state.completed[0].name).toBe(source.file.name);
		expect(state.plans).toHaveLength(1);
		expect(state.plans[0]).toMatchObject({ format: 'mp4', width: source.coded.width,
			height: source.coded.height, frameRate: source.nominalRate, audioInputBytes: null });
		const bytes = Buffer.from(state.completed[0].bytes);
		expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
		const metadata = await page.evaluate(async (data) => {
			const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/mp4' }));
			const video = document.createElement('video');
			try {
				await new Promise((resolve, reject) => {
					video.onloadeddata = resolve;
					video.onerror = () => reject(new Error('The overwritten MP4 is not playable.'));
					video.src = url;
				});
				return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
			} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
		}, Array.from(bytes));
		expect(metadata).toMatchObject(source.coded);
		expect(metadata.duration).toBeCloseTo(source.presentationTicks.length / source.nominalRate.num, 2);
		const center = { x: source.coded.width / 2, y: source.coded.height / 2 };
		const frameTime = { timeSeconds: 0.4 };
		const originalPixel = readRgbPixel(await decodePinnedVideoRgbFrame(source.file.buffer, frameTime), center);
		expect(Math.max(...originalPixel)).toBeGreaterThan(80);
		const editedPixel = readRgbPixel(await decodePinnedVideoRgbFrame(bytes, frameTime), center);
		expect(Math.max(...editedPixel)).toBeLessThanOrEqual(3);
		expect(errors).toEqual([]);
	});
});

function readPcmWav(values) {
	const bytes = Buffer.from(values);
	expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
	expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
	let format, audio;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = bytes.readUInt32LE(offset + 4);
		const chunk = bytes.subarray(offset + 8, offset + 8 + size);
		if (bytes.toString('ascii', offset, offset + 4) === 'fmt ') format = chunk;
		if (bytes.toString('ascii', offset, offset + 4) === 'data') audio = chunk;
		offset += 8 + size + (size & 1);
	}
	expect(format).toBeDefined();
	expect(audio).toBeDefined();
	expect(format.readUInt16LE(14)).toBe(16);
	let peak = 0;
	for (let offset = 0; offset + 2 <= audio.length; offset += 2) {
		peak = Math.max(peak, Math.abs(audio.readInt16LE(offset)) / 32768);
	}
	return { sampleRate: format.readUInt32LE(4), channels: format.readUInt16LE(2),
		frames: audio.length / format.readUInt16LE(12), peak };
}

for (const productId of ['soundscaper', 'framescaper']) {
	const route = productId === 'framescaper' ? '/framescaper/embed/en/' : '/embed/en/';
	test(`${productId} desktop overwrites the complete edited original repeatedly without a dialog`, async ({ page }) => {
		test.setTimeout(90_000);
		await installOriginalOverwriteBridge(page, productId);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, route);
		let fileMenu = await openNestedCommandMenu(page, editor, 'File', []);
		await expect(fileMenu.getByRole('menuitem', { name: 'Overwrite original file', exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		const setGain = async (value) => {
			const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
			await panel.getByText('Normalize', { exact: true }).click();
			await commitInput(panel.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true }), value);
			await closeClipProperties(panel);
		};
		await setGain('-6');
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit project to width']);
		const timecodes = editor.locator('[data-selection-toolbar] .timecode');
		const fullSelection = await timecodes.allTextContents();
		const clip = await clipByName(editor, toneA.name).boundingBox();
		const ruler = await editor.locator('[data-ruler]').boundingBox();
		expect(clip).not.toBeNull();
		expect(ruler).not.toBeNull();
		await page.mouse.move(clip.x + clip.width * 0.25, ruler.y + 26);
		await page.mouse.down();
		await page.mouse.move(clip.x + clip.width * 0.5, ruler.y + 26, { steps: 5 });
		await page.mouse.up();
		await expect.poll(() => timecodes.allTextContents()).not.toEqual(fullSelection);
		await chooseFileAction(page, editor, `Overwrite ${toneA.name}`);
		await expect.poll(() => page.evaluate(() => globalThis.__originalOverwriteFixture.completed.length)).toBe(1);
		await expect(page.getByRole('dialog', { name: /Export/u })).toHaveCount(0);
		const first = readPcmWav(await page.evaluate(() => globalThis.__originalOverwriteFixture.completed[0].bytes));
		expect(first).toMatchObject({ sampleRate: 48_000, channels: 2, frames: 38_400 });
		expect(first.peak).toBeCloseTo(0.35 * 10 ** (-6 / 20), 3);

		await setGain('-12');
		await chooseFileAction(page, editor, `Overwrite ${toneA.name}`);
		await expect.poll(() => page.evaluate(() => globalThis.__originalOverwriteFixture.completed.length)).toBe(2);
		const second = readPcmWav(await page.evaluate(() => globalThis.__originalOverwriteFixture.completed[1].bytes));
		expect(second.frames).toBe(first.frames);
		expect(second.peak).toBeCloseTo(0.35 * 10 ** (-12 / 20), 3);
		const state = await page.evaluate(() => ({
			prepared: globalThis.__originalOverwriteFixture.preparedOriginals,
			pickers: globalThis.__originalOverwriteFixture.savePickers,
			names: globalThis.__originalOverwriteFixture.completed.map(({ name }) => name),
		}));
		expect(state).toEqual({ prepared: ['1'.repeat(48), '1'.repeat(48)], pickers: 0,
			names: [toneA.name, toneA.name] });

		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		fileMenu = await openNestedCommandMenu(page, editor, 'File', []);
		await expect(fileMenu.getByRole('menuitem', { name: 'Overwrite original file', exact: true })).toBeDisabled();
		expect(errors).toEqual([]);
	});

	test(`${productId} browser File menu leaves original overwrite to desktop`, async ({ page }) => {
		const editor = await bootEditor(page, route);
		await importFiles(editor, [toneA]);
		const fileMenu = await openNestedCommandMenu(page, editor, 'File', []);
		await expect(fileMenu.getByRole('menuitem', { name: /^Overwrite /u })).toHaveCount(0);
	});
}
