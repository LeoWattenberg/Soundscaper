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
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
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

	test('switching projects while the sandbox chunk loads leaves both projects unedited', async ({ page }) => {
		test.setTimeout(60_000);
		let releaseChunk = () => undefined;
		let chunkRequested = false;
		const heldChunk = new Promise((resolve) => { releaseChunk = resolve; });
		await page.route('**/assets/browser-sandbox-*.js', async (route) => {
			chunkRequested = true;
			await heldChunk;
			await route.continue();
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const originId = await editor.getAttribute('data-project-id');
		const originTracks = await editor.getAttribute('data-track-count');
		const { manager } = await openProgramEditor(page, editor, [
			"await sound.command('NewMonoTrack');",
			"sound.log.info('stale macro ran');",
		].join('\n'));
		const log = manager.locator('[data-macro-script-log]');
		await page.evaluate(() => {
			const staleSuccesses = [];
			const observer = new MutationObserver(() => {
				const currentLog = document.querySelector('[data-macro-script-log]');
				if (currentLog?.getAttribute('data-outcome') === 'completed'
					|| currentLog?.textContent?.includes('stale macro ran')) {
					staleSuccesses.push(currentLog?.textContent ?? '');
				}
			});
			observer.observe(document.body, {
				attributes: true,
				attributeFilter: ['data-outcome'],
				childList: true,
				subtree: true,
			});
			globalThis.__macroLoadMonitor = { observer, staleSuccesses };
		});

		try {
			await manager.getByRole('button', { name: 'Run program', exact: true }).click();
			await expect.poll(() => chunkRequested).toBe(true);
			await expect(log).toHaveAttribute('data-outcome', 'running');
			// The dialog owns pointer focus; this click models the project action
			// arriving from the host while its lazy import is still outstanding.
			await editor.getByRole('button', { name: 'New project', exact: true })
				.evaluate((button) => button.click());
			await expect(editor).not.toHaveAttribute('data-project-id', originId);
			const nextId = await editor.getAttribute('data-project-id');
			const nextTracks = await editor.getAttribute('data-track-count');

			const sandboxResponse = page.waitForResponse((response) =>
				/browser-sandbox-[^/]+\.js$/u.test(new URL(response.url()).pathname));
			releaseChunk();
			const response = await sandboxResponse;
			await page.evaluate(async (url) => {
				await import(url);
				await new Promise((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(resolve));
				});
			}, response.url());
			await expect(log).toHaveAttribute('data-outcome', /idle|failed/u, { timeout: 15_000 });
			await expect(log).not.toContainText('stale macro ran');
			const staleSuccesses = await page.evaluate(() => {
				const monitor = globalThis.__macroLoadMonitor;
				monitor.observer.disconnect();
				return monitor.staleSuccesses;
			});
			expect(staleSuccesses).toEqual([]);
			await expect(editor).toHaveAttribute('data-track-count', nextTracks ?? '0');
			// The command is a real edit once its sandbox is available; undo this
			// control run so both projects remain in their original state.
			await manager.getByRole('button', { name: 'Run program', exact: true }).click();
			await expect(log).toHaveAttribute('data-outcome', 'completed', { timeout: 30_000 });
			await expect(editor).toHaveAttribute('data-track-count', String(Number(nextTracks) + 1));

			await manager.getByRole('button', { name: 'Close', exact: true }).click();
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-track-count', nextTracks ?? '0');
			await editor.getByRole('navigation', { name: 'Project tabs' })
				.getByRole('tab').first().click();
			await expect(editor).toHaveAttribute('data-project-id', originId);
			await expect(editor).toHaveAttribute('data-track-count', originTracks ?? '0');
			await expect(editor).not.toHaveAttribute('data-project-id', nextId);
		} finally {
			releaseChunk();
		}
	});
});
