/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles,
	registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });
test.describe('ordinary live recording level', () => {
	registerAudioEditorHooks();
	for (const cycle of [false, true]) test(`${cycle ? 'take-cycle' : 'ordinary'} capture applies Record level changed while recording`, async ({ page }) => {
		await installOscillatorMicrophone(page);
		await page.addInitScript(() => {
			const chunks = [];
			globalThis.__liveLevelChunks = chunks;
			const NativeWorklet = AudioWorkletNode;
			globalThis.AudioWorkletNode = class extends NativeWorklet {
				constructor(context, name, options) {
					super(context, name, options);
					if (name !== 'kw-audio-recorder') return;
					this.port.addEventListener('message', ({ data }) => {
						if (data.type !== 'audio-chunk') return;
						let peak = 0;
						for (const channel of data.channels) for (const value of new Float32Array(channel)) peak = Math.max(peak, Math.abs(value));
						chunks.push({ frames: data.frames, peak });
					});
					this.port.start();
				}
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const projectId = await editor.getAttribute('data-project-id');
		const initial = await persistedProject(page, projectId);
		const originalIds = initial.sources.map(source => source.id);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		if (cycle) {
			await editor.getByRole('button', { name: 'Record options', exact: true }).click();
			const options = page.getByRole('dialog', { name: 'Record options', exact: true });
			const start = options.getByRole('button', { name: 'Record loop into takes', exact: true });
			await expect(start).toBeEnabled();
			await start.click();
		} else await record.click();
		try {
			await expect(record).toHaveAttribute('aria-pressed', 'true');
			await expect.poll(() => page.evaluate(() => globalThis.__liveLevelChunks.length)).toBeGreaterThanOrEqual(3);
			expect(await page.evaluate(() => Math.max(...globalThis.__liveLevelChunks.map(chunk => chunk.peak)))).toBeGreaterThan(.05);
			await editor.getByRole('button', { name: 'Record level', exact: true }).click();
			const level = page.getByRole('slider', { name: 'Record level', exact: true });
			await expect(level).toBeEnabled();
			await level.focus();
			await level.press('Home');
			await expect(level).toHaveValue('-60');
			await page.keyboard.press('Escape');
			const before = await page.evaluate(() => globalThis.__liveLevelChunks.length);
			await expect.poll(() => page.evaluate(() => globalThis.__liveLevelChunks.length)).toBeGreaterThanOrEqual(before + 5);
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
			await expect(record).toHaveAttribute('aria-pressed', 'false');
			await expect.poll(async () => {
				const project = await persistedProject(page, projectId);
				return cycle ? project.takeGroups?.[0]?.takes.length ?? 0 : project.sources.filter(source => !originalIds.includes(source.id)).length;
			}).toBeGreaterThan(0);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			const project = await persistedProject(page, projectId);
			const recordedIds = cycle ? project.takeGroups[0].takes.map(take => take.sourceId)
				: project.sources.filter(source => !originalIds.includes(source.id)).map(source => source.id);
			expect(project.sources.filter(source => recordedIds.includes(source.id)).some(source => source.frameCount > 4096)).toBe(true);
			const muted = await page.evaluate(index => globalThis.__liveLevelChunks.slice(index + 2), before);
			expect(muted.length).toBeGreaterThanOrEqual(3);
			expect(Math.max(...muted.map(chunk => chunk.peak))).toBe(0);
		} finally {
			if (await record.getAttribute('aria-pressed') === 'true') await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		}
	});
});
