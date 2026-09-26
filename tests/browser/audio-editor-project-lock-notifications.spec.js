import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, registerAudioEditorHooks, waitForEditor } from './audio-editor-test-helpers.js';

test.describe('project lock notifications', () => {
	registerAudioEditorHooks();

	test('project lock toasts disappear after ten seconds and editing remains available through the menu', async ({ page, context }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		const otherPage = await context.newPage();
		await otherPage.goto('/embed/en/');
		await waitForEditor(otherPage);
		const toast = editor.getByRole('region', { name: 'This project is already open in another tab.', exact: true });
		await expect(toast).toBeVisible();
		await expect(toast.getByRole('button', { name: 'Close', exact: true })).toHaveText('×Close');
		await expect(toast).toBeHidden({ timeout: 15_000 });
		const record = editor.getByRole('button', { name: /Record.*read-only/iu });
		await expect(record).toBeDisabled();
		await chooseCommandAction(page, editor, 'File', 'Edit here');
		await expect(record).toHaveCount(0);
		await otherPage.close();
		expect(errors).toEqual([]);
	});

	test('indexeddb-multitab-writer uses a toast to reclaim the project lock without shifting the editor', async ({ page, context }) => {
		const errors = collectClientErrors(page);
		const first = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, first, 'Tracks', ['Add new track', 'Audio track']);
		await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		const selectionBefore = await first.getByRole('toolbar', { name: 'Selection toolbar', exact: true }).boundingBox();

		const secondPage = await context.newPage();
		const secondErrors = collectClientErrors(secondPage);
		await secondPage.goto('/embed/en/');
		const second = await waitForEditor(secondPage);
		const secondRecord = second.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(secondRecord).toBeEnabled();
		await expect(second.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		const firstRecord = first.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(firstRecord).toBeDisabled({ timeout: 5_000 });
		await expect(firstRecord).toHaveAttribute('aria-label', /read-only/i);
		const firstToast = first.getByRole('region', { name: 'This project is already open in another tab.', exact: true });
		await expect(firstToast).toBeVisible();
		await expect(firstToast.getByRole('alert')).toContainText('already open in another tab');
		await expect(first.locator('[data-project-lock-notice]')).toHaveCount(0);
		const [toastBounds, editorBounds, selectionAfter] = await Promise.all([
			firstToast.boundingBox(), first.boundingBox(),
			first.getByRole('toolbar', { name: 'Selection toolbar', exact: true }).boundingBox(),
		]);
		expect(toastBounds).not.toBeNull();
		expect(editorBounds).not.toBeNull();
		expect(toastBounds.width).toBeLessThan(editorBounds.width * 0.75);
		expect(selectionAfter).toEqual(selectionBefore);

		await page.bringToFront();
		await firstToast.getByRole('button', { name: 'Edit here', exact: true }).click();
		await expect(firstRecord).toBeEnabled();
		await expect(firstToast).toBeHidden();
		await expect(secondRecord).toBeDisabled();
		const secondToast = second.getByRole('region', { name: 'This project is already open in another tab.', exact: true });
		await expect(secondToast).toBeVisible();
		await secondPage.bringToFront();
		await secondToast.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(secondToast).toBeHidden();
		await expect(secondRecord).toBeDisabled();
		await chooseCommandAction(secondPage, second, 'File', 'Edit here');
		await expect(secondRecord).toBeEnabled();
		await expect(firstRecord).toBeDisabled();
		await expect(firstToast).toBeVisible();

		await secondPage.close();
		await expect(first.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 5_000 });
		await expect(firstRecord).toBeEnabled();
		await expect(firstToast).toBeHidden();
		expect(errors).toEqual([]);
		expect(secondErrors).toEqual([]);
	});

	test('a second tab autosave survives takeover while the first tab save is held', async ({ page, context }) => {
		const firstErrors = collectClientErrors(page);
		await page.addInitScript(() => {
			// WebKit lacks this optional API; provide an estimate so its save can pause at the same preflight.
			if (typeof navigator.storage?.estimate === 'function') return;
			Object.defineProperty(navigator, 'storage', {
				configurable: true,
				value: { estimate: async () => ({ usage: 0, quota: 1_000_000_000 }) },
			});
		});
		const first = await bootEditor(page, '/embed/en/');
		await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		const projectId = await first.getAttribute('data-project-id');
		await page.evaluate(() => {
			const originalEstimate = navigator.storage.estimate.bind(navigator.storage);
			let releaseEstimate;
			const held = new Promise((resolve) => { releaseEstimate = resolve; });
			globalThis.__heldProjectEstimate = {
				entered: 0,
				release: () => { releaseEstimate(); },
			};
			Object.defineProperty(navigator.storage, 'estimate', {
				configurable: true,
				value: async () => {
					globalThis.__heldProjectEstimate.entered += 1;
					await held;
					return originalEstimate();
				},
			});
		});

		try {
			await chooseNestedCommandAction(page, first, 'Tracks', ['Add new track', 'Audio track']);
			await expect(first).toHaveAttribute('data-track-count', '2');
			await expect.poll(() => page.evaluate(() => globalThis.__heldProjectEstimate.entered)).toBeGreaterThan(0);

			const secondPage = await context.newPage();
			const secondErrors = collectClientErrors(secondPage);
			await secondPage.goto('/embed/en/');
			const second = await waitForEditor(secondPage);
			await expect(second).toHaveAttribute('data-project-id', projectId);
			await expect(second).toHaveAttribute('data-track-count', '1');
			await expect(first.getByRole('button', { name: /Record.*read-only/iu }))
				.toBeDisabled({ timeout: 5_000 });
			await chooseNestedCommandAction(secondPage, second, 'Tracks', ['Add new track', 'Audio track']);
			await chooseNestedCommandAction(secondPage, second, 'Tracks', ['Add new track', 'Audio track']);
			await expect(second).toHaveAttribute('data-track-count', '3');
			await expect(second.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

			await page.evaluate(async () => {
				globalThis.__heldProjectEstimate.release();
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			await secondPage.reload();
			const reopened = await waitForEditor(secondPage);
			await expect(reopened).toHaveAttribute('data-project-id', projectId);
			await expect(reopened).toHaveAttribute('data-track-count', '3');
			await expect(reopened.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			expect(firstErrors).toEqual([]);
			expect(secondErrors).toEqual([]);
		} finally {
			await page.evaluate(() => globalThis.__heldProjectEstimate.release()).catch(() => undefined);
		}
	});
});
