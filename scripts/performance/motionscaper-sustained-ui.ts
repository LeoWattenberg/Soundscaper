/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { expect, type Locator, type Page } from '@playwright/test';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';

export async function motionSustainedMenu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}
export async function openMotionSustainedArchive(page: Page, path: string, nativeChoose?: (path: string) => Promise<void>): Promise<void> {
	await expect(page.locator('[data-motion-editor-bound]')).toBeVisible({ timeout: 30000 });
	await motionSustainedMenu(page, 'File', 'Open');
	if (nativeChoose) await nativeChoose(path);
	else await page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true }).setInputFiles(path);
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device', { timeout: 30000 });
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Sustained duration');
}
export async function openMotionSustainedPreview(page: Page): Promise<Locator> {
	await motionSustainedMenu(page, 'View', 'Composition Preview');
	const dialog = page.getByRole('dialog', { name: 'Composition Preview', exact: true });
	await expect(dialog.getByLabel('Frame', { exact: true })).toBeEnabled({ timeout: 30000 });
	await expect(dialog.locator('canvas')).toHaveAttribute('data-motion-frame', '0', { timeout: 30000 }); return dialog;
}
/** Every seek is the ordinary input event, awaited through its actual presented-frame identity. */
export async function seekMotionSustainedPreview(dialog: Locator, frames: 300 | 1200,
	onFrame: (completed: number) => void, assertHealthy: () => void) {
	const selected: { index: number; rgba: Uint8Array }[] = [], canvas = dialog.locator('canvas');
	for (let frame = 0; frame < frames; frame++) {
		assertHealthy(); await dialog.getByLabel('Frame', { exact: true }).fill(String(frame));
		await expect(canvas).toHaveAttribute('data-motion-frame', String(frame), { timeout: 30000 });
		if ([0, frames / 2, frames - 1].includes(frame)) {
			const data = await canvas.evaluate((element: HTMLCanvasElement) => {
				if (element.width !== 160 || element.height !== 90) throw new Error('Preview geometry changed.');
				const context = element.getContext('2d'); if (!context) throw new Error('Preview canvas unavailable.');
				return Array.from(context.getImageData(0, 0, 160, 90).data);
			});
			selected.push({ index: frame, rgba: Uint8Array.from(data) });
		}
		onFrame(frame + 1);
	}
	return selected;
}
export async function openMotionSustainedRender(page: Page, format: 'png' | 'webm' | 'prores', frames: 300 | 1200): Promise<Locator> {
	await motionSustainedMenu(page, 'File', 'Render');
	const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	if (format === 'prores') await expect(dialog.getByLabel('Output format', { exact: true }).locator('option[value="prores"]')).toHaveCount(1, { timeout: 30000 });
	await dialog.getByLabel('Output format', { exact: true }).selectOption(format);
	await dialog.getByLabel('First frame', { exact: true }).fill('0');
	await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill(String(frames)); return dialog;
}
export async function motionSustainedRenderProgress(dialog: Locator, frames: number): Promise<number> {
	const alert = dialog.getByRole('alert'); if (await alert.count()) throw new Error(await alert.innerText());
	if (await dialog.getByRole('status').textContent() === 'Render complete') return frames;
	const progress = dialog.getByRole('progressbar', { name: 'Rendered frames', exact: true });
	const value = await progress.count() ? Number(await progress.getAttribute('value')) : 0;
	assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= frames); return value;
}
export async function finishMotionSustainedRender(dialog: Locator): Promise<void> {
	await expect(dialog.getByRole('status')).toHaveText('Render complete', { timeout: plan.maximumPhaseMs });
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}
export async function removeMotionSustainedJob(page: Page, digest: string): Promise<void> {
	await motionSustainedMenu(page, 'File', 'Render Queue');
	const queue = page.getByRole('dialog', { name: 'Render Queue', exact: true });
	const job = queue.locator('[data-motion-render-job]'); await expect(job).toHaveCount(1);
	await expect(job.getByRole('status')).toHaveText('Completed');
	await job.getByText('Submitted revision', { exact: true }).click(); await expect(job.locator('code')).toHaveText(digest);
	await expect(job.getByRole('button', { name: 'Download Again', exact: true })).toHaveCount(0);
	await job.getByRole('button', { name: 'Remove Job', exact: true }).click(); await expect(job).toHaveCount(0);
	await queue.getByRole('button', { name: 'Close', exact: true }).last().click();
}
