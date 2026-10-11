/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Page } from '@playwright/test';
import { MOTION_PRORES_DELIVERY_PROFILE } from '../../src/motionscaper/desktop-delivery-contract.ts';
import { motionNativePcmPlan, openMotionNativePcmReader, type MotionNativePcmOptions, type MotionNativePcmReceipt } from '../../src/common/editor/motion-native-pcm-carrier-v1.ts';
import { createScapeArchiveByteSource } from '../../src/common/editor/scape-archive-byte-source.ts';
import type { MotionRenderPlan } from '../../src/common/editor/controller/export/motion-render-pipeline.ts';
import { motionWavFixture } from '../helpers/motion-media-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click();
}

for (const excludeAudio of [false, true]) test(`native ProRes preserves pinned publication, cancellation and ${excludeAudio ? 'explicit audio exclusion' : 'actual PCM audio'}`, async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/');
	await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
	await page.evaluate((profile) => {
		const state = { begins: 0, writes: 0, bytes: 0, commits: 0, cancelled: 0, audioBytes: [] as number[], audio: null as MotionNativePcmOptions | null, audioReceipt: null as MotionNativePcmReceipt | null, plan: null as MotionRenderPlan | null };
		Object.defineProperty(globalThis, 'motionDeliveryTestState', { value: state });
		Object.defineProperty(globalThis, 'scapeDesktop', { value: { v1: { motionDelivery: {
			getProfile: () => Promise.resolve(profile),
			begin: ({ plan, audio }: { plan: MotionRenderPlan; audio?: MotionNativePcmOptions }) => { state.begins++; state.plan = plan; state.audio = audio ?? null; return Promise.resolve(state.begins === 1 ? null : { token: 'chosen' }); },
			write: ({ offset, bytes, stream }: { offset: number; bytes: Uint8Array; stream?: 'audio' }) => { if (stream === 'audio') { if (offset !== state.audioBytes.length) throw new Error('Unexpected PCM byte order.'); state.audioBytes.push(...bytes); return Promise.resolve(); } if (offset !== state.bytes) throw new Error('Unexpected native byte order.'); state.writes++; state.bytes += bytes.byteLength; return Promise.resolve(); },
			commit: ({ byteLength, sha256, audio }: { byteLength: number; sha256: string; audio?: MotionNativePcmReceipt }) => { state.commits++; state.audioReceipt = audio ?? null; return Promise.resolve({ identity: state.plan!.identity, name: 'Native.mov', frameCount: state.plan!.frameCount, byteLength, sha256, profile, audio: audio ? { ...state.audio!, sampleCount: audio.sampleCount } : null }); },
			cancel: () => { state.cancelled++; return Promise.resolve(); },
		} } } });
	}, MOTION_PRORES_DELIVERY_PROFILE);
	await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByLabel('Duration in frames', { exact: true }).fill('2'); await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'File', 'Import Media');
	await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(motionWavFixture()) });
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'File', 'Render'); const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await dialog.getByLabel('Output format', { exact: true }).selectOption('prores');
	await expect(dialog).toContainText('10-bit'); await expect(dialog).toContainText('16-bit alpha');
	await expect(dialog).toContainText('24-bit PCM');
	await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
	if (excludeAudio) await dialog.getByRole('checkbox', { name: 'Export without audio', exact: true }).check();
	await dialog.getByRole('button', { name: 'Render', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
	await expect(dialog.getByRole('status')).toHaveText(''); await expect(dialog.getByRole('alert')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('Render complete');
	const result = await page.evaluate(() => Reflect.get(globalThis, 'motionDeliveryTestState') as { begins: number; commits: number; bytes: number; writes: number; audioBytes: number[]; audio: MotionNativePcmOptions | null; audioReceipt: MotionNativePcmReceipt | null; plan: MotionRenderPlan });
	expect(result.begins).toBe(2); expect(result.commits).toBe(1); expect(result.writes).toBeGreaterThan(0); expect(result.bytes).toBeGreaterThan(2 * 64 * 64 * 16);
	expect(result.plan.frameCount).toBe(2); expect(result.plan.identity.revisionDigest).toMatch(/^[a-f0-9]{64}$/u);
	if (excludeAudio) { expect(result.audio).toBeNull(); expect(result.audioBytes).toHaveLength(0); expect(result.audioReceipt).toBeNull(); }
	else {
		expect(result.audio).toEqual({ sampleRate: 48000, channels: 2 }); expect(result.audioReceipt?.sampleCount).toBe(3200);
		const bytes = Uint8Array.from(result.audioBytes);
		const reader = await openMotionNativePcmReader(createScapeArchiveByteSource({ size: bytes.length, read: ({ offset, length }) => bytes.slice(offset, offset + length) }), motionNativePcmPlan(result.plan, result.audio!));
		const pcm = await reader.read(0); expect(pcm.length).toBe(6400); expect(pcm.some((value) => Math.abs(value) > .1)).toBe(true);
	}
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
});

test('browser Render does not advertise unavailable native ProRes', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition'); await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'File', 'Render');
	await expect(page.getByRole('option', { name: /ProRes/u })).toHaveCount(0);
});

test('native render queue retains failed cleanup and retries the original revision through a fresh destination', async ({ page }) => {
	await page.goto('/embed/en/');
	await page.evaluate(profile => {
		const state = { begins: 0, commits: 0, cancellations: 0, cleanupFails: true, publicationFails: true, plan: null as MotionRenderPlan | null };
		Object.defineProperty(globalThis, 'motionCleanupTestState', { value: state });
		Object.defineProperty(globalThis, 'scapeDesktop', { value: { v1: { motionDelivery: {
			getProfile: () => Promise.resolve(profile),
			begin: ({ plan }: { plan: MotionRenderPlan }) => { state.plan = plan; return Promise.resolve({ token: `chosen-${++state.begins}` }); },
			write: () => Promise.resolve(),
			commit: ({ byteLength, sha256 }: { byteLength: number; sha256: string }) => {
				state.commits++; if (state.publicationFails) return Promise.reject(new Error('Native publication failed'));
				return Promise.resolve({ identity: state.plan!.identity, name: 'Cleanup.mov', frameCount: state.plan!.frameCount, byteLength, sha256, profile, audio: null });
			},
			cancel: () => { state.cancellations++; return state.cleanupFails ? Promise.reject(new Error('Native cleanup unavailable')) : Promise.resolve(); },
		} } } });
	}, MOTION_PRORES_DELIVERY_PROFILE);
	await menu(page, 'File', 'New Composition'); await page.getByLabel('Project title', { exact: true }).fill('Retained cleanup');
	await page.getByLabel('Width', { exact: true }).fill('32'); await page.getByLabel('Height', { exact: true }).fill('32'); await page.getByLabel('Duration in frames', { exact: true }).fill('2');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Solid'); await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Render'); const render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await render.getByLabel('Output format', { exact: true }).selectOption('prores'); await render.getByRole('button', { name: 'Render', exact: true }).click();
	await expect(render.getByRole('alert')).toBeVisible(); await render.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'File', 'Render Queue'); const queue = page.getByRole('dialog', { name: 'Render Queue', exact: true }); const job = queue.locator('[data-motion-render-job]');
	await expect(job.getByRole('button', { name: 'Retry Output Cleanup', exact: true })).toBeVisible();
	await expect(job.getByRole('button', { name: 'Remove Job', exact: true })).toHaveCount(0); await expect(job.getByRole('button', { name: 'Retry Original Revision', exact: true })).toHaveCount(0);
	await job.getByText('Submitted revision', { exact: true }).click(); const digest = await job.locator('code').textContent();
	await job.getByRole('button', { name: 'Retry Output Cleanup', exact: true }).click(); await expect(queue.getByRole('alert')).toContainText('Native cleanup unavailable');
	await expect(job.getByRole('button', { name: 'Retry Output Cleanup', exact: true })).toBeVisible();
	await page.evaluate(() => { const state = Reflect.get(globalThis, 'motionCleanupTestState') as { cleanupFails: boolean; publicationFails: boolean }; state.cleanupFails = false; state.publicationFails = false; });
	await job.getByRole('button', { name: 'Retry Output Cleanup', exact: true }).click(); await expect(job.getByRole('button', { name: 'Retry Original Revision', exact: true })).toBeVisible();
	await job.getByRole('button', { name: 'Retry Original Revision', exact: true }).click(); await expect(job.getByRole('status')).toHaveText('Completed');
	await expect(job).toContainText('Attempt 2'); await expect(job.locator('code')).toHaveText(digest!);
	const counts = await page.evaluate(() => Reflect.get(globalThis, 'motionCleanupTestState') as { begins: number; commits: number; cancellations: number });
	expect(counts.begins).toBe(2); expect(counts.commits).toBe(2); expect(counts.cancellations).toBeGreaterThan(1);
});
