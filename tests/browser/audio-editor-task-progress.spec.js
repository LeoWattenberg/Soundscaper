import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('audio editor task progress', () => {
	registerAudioEditorHooks();

	test('announces bounded work in the status area and removes it after completion', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await editor.evaluate((root) => {
			globalThis.__taskProgressEvents = [];
			new MutationObserver(() => {
				const progress = root.querySelector('[data-editor-task-progress]');
				if (!progress) return;
				const bar = progress.querySelector('[role="progressbar"]');
				globalThis.__taskProgressEvents.push({
					kind: progress.getAttribute('data-editor-task-progress'),
					indeterminate: progress.hasAttribute('data-indeterminate'),
					role: bar?.getAttribute('role'),
					value: bar?.getAttribute('aria-valuenow'),
				});
			}).observe(root, { attributes: true, childList: true, subtree: true });
		});

		await editor.locator('[data-import-input]').setInputFiles([longTone]);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		const events = await page.evaluate(() => globalThis.__taskProgressEvents);
		expect(events.some((event) => (
			event.kind === 'import'
			&& event.indeterminate
			&& event.role === 'progressbar'
			&& event.value === null
		))).toBe(true);
		await expect(editor.locator('[data-editor-task-progress]')).toHaveCount(0);
	});
});
