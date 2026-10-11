/* SPDX-License-Identifier: AGPL-3.0-only */
/** External package qualification through public menus; never imported by a production entry. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, type Page } from '@playwright/test';
import { encodeMotionChannel, decodeMotionChannel } from '../src/common/editor/motion-surface.ts';
import { motionscaperSuccessorNativeExpectedSample } from '../tests/helpers/motionscaper-successor-native-fixture.ts';
import { buildMotionNativeReferenceDecoder, decodeMotionNativeReference } from './motionscaper-native-reference.ts';
export async function qualifyFramescaperSuccessorNativeDelivery(page: Page, options: { root: string; temporary: string; sourceRevision: string; acceptedDigest: string }): Promise<void> {
	const menu = async (item: string) => { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); };
	const preview = async () => {
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-visual-error', '');
		const canvas = page.locator('[data-video-preview-canvas]'); await expect(canvas).toBeVisible();
		return canvas.evaluate((element: HTMLCanvasElement) => {
			const copy = document.createElement('canvas'); copy.width = element.width; copy.height = element.height;
			const context = copy.getContext('2d')!; context.drawImage(element, 0, 0);
			return [...context.getImageData(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1).data];
		});
	};
	await page.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect.poll(preview).not.toEqual([0, 0, 0, 0]); const before = await preview();
	const projectId = await page.locator('[data-project-id]').getAttribute('data-project-id'); assert.ok(projectId);
	await rm(join(options.temporary, 'saved.mscape')); await page.context().setOffline(true); await page.reload();
	await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible(); await expect(page.locator('[data-project-id]')).toHaveAttribute('data-project-id', projectId);
	await expect.poll(preview).toEqual(before);
	await menu('Linked compositions…'); await expect(page.getByRole('dialog').locator('code')).toHaveText(options.acceptedDigest); await page.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu('Export sequence as ProRes 4444…'); const dialog = page.locator('[data-frame-native-delivery]');
	await expect(dialog.getByRole('button', { name: 'Choose destination and export', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Choose destination and export', exact: true }).click();
	const movie = join(options.temporary, 'output.mov');
	const selected = await promisify(execFile)('python3', [join(options.root, 'scripts/lib/motionscaper-successor-delivery-chooser-x11.py'), movie], { timeout: 20000 });
	assert.match(selected.stdout, /MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u);
	await expect(dialog.getByRole('status')).toHaveText('Saved output.mov', { timeout: 30000 }); await expect(dialog.getByRole('alert')).toHaveCount(0);
	const frameDigest = await dialog.locator('[data-frame-native-digest]').textContent(); assert.match(frameDigest ?? '', /^[a-f0-9]{64}$/u);
	const decoder = await buildMotionNativeReferenceDecoder(options.temporary); const decoded = await decodeMotionNativeReference(decoder, movie, options.temporary);
	assert.equal(decoded.metadata.width, 64); assert.equal(decoded.metadata.height, 32);
	assert.equal(decoded.metadata.frames.length, 3); for (const [index, time] of decoded.metadata.frames.entries()) assert.equal(time.num * 30, index * time.den);
	assert.deepEqual(decoded.metadata.audio, { sampleRate: 48000, channels: 2, sampleCount: 4800 });
	const channels = [0.2, 0.05, 0.6].map(value => Math.round(encodeMotionChannel(decodeMotionChannel(Math.round(encodeMotionChannel(value, 'srgb') * 255) / 255, 'srgb'), 'rec709') * 255) / 255);
	let maximumColorError = 0, maximumAlphaError = 0, maximumPcmError = 0;
	for (let frame = 0; frame < 3; frame++) for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
		const pixel = (frame * 64 * 32 + y * 64 + x) * 4, visible = x >= 4 + frame && x < 36 + frame && y >= 4 && y < 28;
		const alpha = visible ? 128 / 255 : 0; maximumAlphaError = Math.max(maximumAlphaError, Math.abs(decoded.rgba[pixel + 3]! - alpha));
		if (!visible) { assert.equal(decoded.rgba[pixel + 3], 0); continue; }
		for (let channel = 0; channel < 3; channel++) maximumColorError = Math.max(maximumColorError, Math.abs(decoded.rgba[pixel + channel]! - channels[channel]!));
	}
	for (let index = 0; index < decoded.pcm.length / 2; index++) for (let channel = 0; channel < 2; channel++) maximumPcmError = Math.max(maximumPcmError, Math.abs(decoded.pcm[index * 2 + channel]! - motionscaperSuccessorNativeExpectedSample(index, channel)));
	assert.ok(maximumColorError <= 8 / 1023, `Native RGB error ${String(maximumColorError)}`); assert.ok(maximumAlphaError <= 2 / 1023, `Native alpha error ${String(maximumAlphaError)}`); assert.ok(maximumPcmError <= 2 ** -23, `Native PCM error ${String(maximumPcmError)}`);
	console.log(`FRAMESCAPER_SUCCESSOR_NATIVE_DELIVERY_QUALIFIED ${JSON.stringify({ sourceRevision: options.sourceRevision, acceptedMotionDigest: options.acceptedDigest, frameProjectId: projectId, frameProjectDigest: frameDigest,
		actualNativeSaveChooser: true, offlineRetainedOriginals: true, previewBeforeAndAfterOfflineReopen: before, inputPrecision: 'Frame managed SDR unorm8 straight alpha', maximumRec709ColorError: maximumColorError, maximumAlphaError, maximumPcmError,
		metadata: decoded.metadata, movieSha256: createHash('sha256').update(await readFile(movie)).digest('hex') })}`);
}
