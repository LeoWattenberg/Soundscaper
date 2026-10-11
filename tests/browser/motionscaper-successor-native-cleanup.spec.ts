/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { motionscaperSuccessorNativeFixture } from '../helpers/motionscaper-successor-native-fixture.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE } from '../../src/framescaper/editor-successor-native-delivery-contract.ts';
async function menu(page: Page, item: string) { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); }
interface Capture { begins: number; commits: number; cancellations: number; waiting: boolean; recover(): void; publish(): void; releaseBegin(): void }
async function prepare(page: Page, lateCancel = false) {
	const fixture = motionscaperSuccessorNativeFixture(), archive = await exportMotionscaperArchive(fixture.revision.project, () => new Blob([fixture.bytes])); if (!archive) throw new Error('Fixture missing.');
	await page.addInitScript(({ archive, profile, lateCancel }) => {
		const bytes = new Uint8Array(archive); let cleanupFails = !lateCancel, publicationFails = !lateCancel, finish: (() => void) | null = null, releaseBegin: (() => void) | null = null;
		let plan: import('../../src/framescaper/editor-successor-native-delivery-contract.ts').FramescaperSuccessorNativePlan | null = null;
		const state = { begins: 0, commits: 0, cancellations: 0, waiting: false, recover() { cleanupFails = false; publicationFails = false; }, publish() { finish?.(); }, releaseBegin() { releaseBegin?.(); } };
		const files = { select: async () => ({ watchId: 'watch', name: 'Native.mscape' }), poll: async ({ afterGeneration }: { afterGeneration: number }) => afterGeneration === 1 ? { state: 'unchanged', generation: 1 } : { state: 'snapshot', snapshot: { token: 'snapshot', name: 'Native.mscape', generation: 1, byteLength: bytes.length } }, read: async ({ offset, length }: { offset: number; length: number }) => bytes.slice(offset, offset + length), release: async () => {}, cancel: async () => {} };
		const delivery = { getProfile: async () => profile, begin: async (request: { plan: NonNullable<typeof plan> }) => { state.begins++; plan = request.plan; if (state.begins === 2) await new Promise<void>(resolve => { releaseBegin = resolve; }); return { token: 'owned' }; }, write: async () => {},
			commit: async () => { state.commits++; if (publicationFails) throw new Error('Native commit fault'); if (!plan) throw new Error('Missing plan'); const receipt = { identity: plan.identity, name: 'Committed.mov', byteLength: 10, sha256: 'a'.repeat(64), frameCount: plan.frameCount, profile, audio: { sampleRate: 48000, channels: 2, sampleCount: 4800 } };
				if (lateCancel) { state.waiting = true; await new Promise<void>(resolve => { finish = resolve; }); } return receipt; },
			cancel: async () => { state.cancellations++; if (cleanupFails) throw new Error('Native cancel fault'); if (lateCancel && state.waiting) throw new Error('Native destination already committed'); } };
		Object.defineProperty(globalThis, 'framescaperSuccessorDesktop', { value: { v1: { motionSavedFiles: files, delivery } } });
		Object.defineProperty(globalThis, 'frameCleanupFixture', { value: state });
	}, { archive: [...new Uint8Array(await archive.arrayBuffer())], profile: FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE, lateCancel });
	await page.goto('/embed/en/'); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible(); await menu(page, 'Linked compositions…');
	await page.getByRole('button', { name: 'Choose saved .mscape file', exact: true }).click(); await expect(page.getByText('Native revision 0', { exact: true }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await menu(page, 'Export sequence as ProRes 4444…');
	return page.locator('[data-frame-native-delivery]');
}
const captured = (page: Page) => page.evaluate(() => { const state = (globalThis as unknown as { frameCleanupFixture: Capture }).frameCleanupFixture; return { begins: state.begins, commits: state.commits, cancellations: state.cancellations, waiting: state.waiting }; });
test('Frame File ProRes export retains commit/cancel failures and blocks close or new export until cleanup retry succeeds', async ({ page }) => {
	const dialog = await prepare(page), start = dialog.getByRole('button', { name: 'Choose destination and export', exact: true }), close = dialog.getByRole('button', { name: 'Close', exact: true }); await start.click();
	await expect(dialog.getByRole('alert')).toContainText('Native commit fault'); await expect(dialog.getByRole('alert')).toContainText('Native cancel fault');
	const retry = dialog.getByRole('button', { name: 'Retry Output Cleanup', exact: true }); await expect(retry).toBeEnabled(); await expect(close).toBeDisabled(); await expect(start).toBeDisabled();
	await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); await dialog.evaluate((element: HTMLDialogElement) => element.close()); await expect(dialog).toBeVisible();
	const before = await captured(page); await retry.click(); await expect(retry).toBeEnabled(); await expect(dialog.getByRole('alert')).toContainText('Native cancel fault'); await expect(close).toBeDisabled(); expect((await captured(page)).begins).toBe(1); expect((await captured(page)).cancellations).toBeGreaterThan(before.cancellations);
	await page.evaluate(() => (globalThis as unknown as { frameCleanupFixture: Capture }).frameCleanupFixture.recover()); await retry.click(); await expect(retry).toHaveCount(0); await expect(close).toBeEnabled();
	await start.click(); await expect.poll(async () => (await captured(page)).begins).toBe(2);
	await dialog.getByRole('button', { name: 'Cancel export', exact: true }).click(); await page.evaluate(() => (globalThis as unknown as { frameCleanupFixture: Capture }).frameCleanupFixture.releaseBegin());
	await expect(dialog.getByRole('status')).toHaveText('Export cancelled.'); await expect(dialog.getByRole('alert')).toHaveCount(0); await close.click(); await expect(dialog).toHaveCount(0);
});
test('Frame File native export shows successful publication after a late cancel while awaiting its receipt', async ({ page }) => {
	const dialog = await prepare(page, true); await dialog.getByRole('button', { name: 'Choose destination and export', exact: true }).click(); await expect.poll(async () => (await captured(page)).waiting).toBe(true);
	await dialog.getByRole('button', { name: 'Cancel export', exact: true }).click(); await page.evaluate(() => (globalThis as unknown as { frameCleanupFixture: Capture }).frameCleanupFixture.publish());
	await expect(dialog.getByRole('status')).toHaveText('Saved Committed.mov'); await expect(dialog.getByRole('alert')).toHaveCount(0); await expect(dialog.getByRole('button', { name: 'Retry Output Cleanup', exact: true })).toHaveCount(0); await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled(); expect((await captured(page)).commits).toBe(1);
});
