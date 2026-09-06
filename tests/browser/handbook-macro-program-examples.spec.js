/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

import { expect, halfMinuteTone, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { runMacro } from './helpers/guide-workflows.js';

/**
 * The handbook's macro-program reference is held to the editor the way the
 * guides are: every JavaScript block on the page is read out of the page's own
 * text and run through the real Macro Manager. The page may therefore promise
 * that its programs run, and a change to the `sound` API that breaks one fails
 * here rather than in a reader's editor.
 *
 * The page is the fixture, deliberately. A copy of the programs kept in this
 * file would drift from the page the moment either was edited.
 */
const PAGE = new URL('../../handbook/src/content/docs/reference/macro-programs.md', import.meta.url);

/** Every fenced `js` block on the page, named by the heading it sits under. */
function readPrograms(markdown) {
	const programs = [];
	const counts = new Map();
	let heading = 'Macro programs';
	let fence = null;
	for (const line of markdown.split('\n')) {
		if (fence) {
			if (line.startsWith('```')) {
				const ordinal = (counts.get(heading) ?? 0) + 1;
				counts.set(heading, ordinal);
				programs.push({ title: `${heading} (${ordinal})`, source: fence.join('\n') });
				fence = null;
			} else {
				fence.push(line);
			}
			continue;
		}
		const headed = /^#{2,3}\s+(.+)$/u.exec(line);
		if (headed) heading = headed[1].replace(/`/gu, '');
		else if (line.trim() === '```js') fence = [];
	}
	return programs;
}

const PROGRAMS = readPrograms(readFileSync(PAGE, 'utf8'));

/**
 * What a program needs in place before it runs. The page says effects run over
 * the current selection on the focused track, so a program that changes the
 * project gets an import and a full selection; one that only reads gets the
 * import alone; and the one that runs a saved macro gets the macro it names.
 */
function arrangementFor(source) {
	if (source.includes('sound.runSaved(')) return 'saved-macro';
	if (/\bsound\.(?:select|effects?|command)\b/u.test(source)) return 'selection';
	return 'read-only';
}

/** The log lines the page says a program produces, where it says so. */
function expectedLogFor(source) {
	const expected = [];
	if (source.includes('ExportWav')) expected.push('refused: Unsupported macro command: ExportWav.');
	if (source.includes('Faded in ')) expected.push(/Faded in .+ on .+/u);
	if (source.includes('clip(s)')) expected.push(/clip\(s\), \d+\.\d s of audio/u);
	return expected;
}

async function runProgram(page, editor, source) {
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await expect(manager).toBeVisible();
	await manager.locator('[data-macro-programs]').getByRole('button', { name: 'New program', exact: true }).click();
	const program = manager.locator('[data-macro-script-source]');
	await expect(program).toBeVisible();
	await program.fill(source);
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u, { timeout: 60_000 });
	return { manager, log };
}

test.describe('handbook macro-program examples', () => {
	registerAudioEditorHooks();

	test('the page holds the programs this suite replays', () => {
		// A regression in the extraction would otherwise pass by running nothing.
		expect(PROGRAMS.length).toBeGreaterThanOrEqual(9);
		expect(PROGRAMS.filter(({ source }) => arrangementFor(source) === 'saved-macro')).toHaveLength(1);
	});

	for (const { title, source } of PROGRAMS) {
		test(`runs the program under ${title}`, async ({ page }) => {
			test.setTimeout(150_000);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			const arrangement = arrangementFor(source);
			await importFiles(editor, [arrangement === 'saved-macro' ? halfMinuteTone : longTone], { timeout: 60_000 });
			if (arrangement !== 'read-only') await chooseCommandAction(page, editor, 'Select', 'Select all');
			if (arrangement === 'saved-macro') {
				// The saved macro the page's example names, made the way the guide makes it.
				await runMacro(page, { editor }, { name: 'Episode finish', effects: ['Normalize', 'Fade Out'] });
			}

			const { manager, log } = await runProgram(page, editor, source);
			await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
			await expect(log).toHaveAttribute('data-outcome', 'completed');
			for (const line of expectedLogFor(source)) await expect(log).toContainText(line);
			expect(errors).toEqual([]);
		});
	}
});
