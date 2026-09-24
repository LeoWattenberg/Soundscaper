/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

async function openProgramEditor(page, editor, source) {
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await expect(manager).toBeVisible();
	await manager.locator('[data-macro-programs]').getByRole('button', { name: 'New program', exact: true }).click();
	const program = manager.locator('[data-macro-script-source]');
	await expect(program).toBeVisible();
	await program.fill(source);
	return { manager, program };
}

async function runProgram(page, editor, source) {
	const { manager } = await openProgramEditor(page, editor, source);
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u, { timeout: 30_000 });
	return { manager, log };
}

test.describe('macro programs', () => {
	test('a program reaches the editor and reports what it did', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const { manager, log } = await runProgram(page, editor, `
			const tracks = await sound.project.tracks();
			sound.log.info('tracks ' + tracks.length);
			await sound.select.all();
			const selection = await sound.project.selection();
			sound.log.info('selected ' + selection.startFrame + '-' + selection.endFrame);
			await sound.effect('audacity-invert');
			sound.log.info('done');
		`.trim());

		await expect(log).toHaveAttribute('data-outcome', 'completed');
		await expect(log).toContainText('tracks 2');
		await expect(log).toContainText('done');
		await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('the sandbox denies the worker every ambient capability', async ({ page }) => {
		// The boundary is the host's dispatch table; this is the defence in depth
		// behind it, and it is one missing prototype walk away from being nothing.
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const { log } = await runProgram(page, editor, [
			"const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'caches',",
			"  'importScripts', 'Worker', 'WebAssembly', 'Atomics', 'SharedArrayBuffer',",
			"  'crypto', 'navigator', 'location', 'setTimeout', 'setInterval'];",
			"const reachable = names.filter((name) => typeof globalThis[name] !== 'undefined');",
			"sound.log.info('reachable ' + JSON.stringify(reachable));",
			"let evalOutcome = 'allowed';",
			"try { (0, eval)('1'); } catch (error) { evalOutcome = 'refused'; }",
			"sound.log.info('eval ' + evalOutcome);",
			"sound.log.info('ordinary js ' + [3, 1, 2].sort().join('') + JSON.stringify({ ok: true }));",
		].join('\n'));

		await expect(log).toHaveAttribute('data-outcome', 'completed');
		await expect(log).toContainText('reachable []');
		// The allowlist takes `eval` away before the policy has to refuse it; either
		// way it does not evaluate, which is the claim that matters.
		await expect(log).toContainText('eval refused');
		await expect(log).toContainText('ordinary js 123{"ok":true}');
	});

	test('a program is deterministic, and asking for something it may not have is refused', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const { log } = await runProgram(page, editor, [
			"sound.log.info('clock ' + Date.now() + ' ' + Date.now());",
			"sound.log.info('random ' + sound.random().toFixed(6));",
			"try { await sound.command('ExportWav'); } catch (error) { sound.log.info('refused ' + error.message); }",
		].join('\n'));

		await expect(log).toHaveAttribute('data-outcome', 'completed');
		// The clock is virtual and only advances when the program waits or asks.
		await expect(log).toContainText('clock 0 0');
		await expect(log).toContainText('refused');
	});

	test('a program that throws reports the author\'s own line and changes nothing', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clipCount = await editor.getAttribute('data-clip-count');

		const { manager } = await runProgram(page, editor, [
			'await sound.select.all();',
			'await sound.effect(\'audacity-invert\');',
			'throw new Error(\'stop here\');',
		].join('\n'));

		const failure = manager.locator('[data-macro-script-failure]');
		await expect(failure).toBeVisible();
		await expect(failure).toContainText('stop here');
		await expect(editor).toHaveAttribute('data-clip-count', clipCount ?? '0');
	});
});
