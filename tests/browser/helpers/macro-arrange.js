/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '../audio-editor-test-fixtures.js';
import { chooseCommandAction } from '../audio-editor-test-helpers.js';

/**
 * Reach an expensive project state by running a macro program, through the real
 * Macro Manager.
 *
 * **Use a macro to reach a state, never to be the state under test.** Every UI
 * path a macro can shortcut keeps exactly one hand-clicked golden-path spec, and
 * if deleting that spec would leave a UI path untested then the shortcut is not
 * allowed there. Specs that click real controls are the only thing proving menu
 * reachability, the deliberate no-op on a disabled item, the divergence between
 * a menu handler and its runtime action, per-product capability filtering, that
 * the lazy dialog chunk resolves, the copy across seventeen route locales, and
 * three engines rather than one code path three times. A macro run bypasses all
 * of it.
 *
 * The payoff is elsewhere: a spec whose subject sits downstream of a six-track
 * project or a forty-clip timeline currently pays two hundred lines of setup
 * that duplicates coverage another spec already owns, runs slowly, and flakes.
 *
 * The rule is checked mechanically rather than left to memory. A spec that calls
 * this helper may not also assert on the macro surface — see
 * `tests/browser-macro-arrangement-rule.test.js`, which reads the call sites.
 */
export async function arrangeWithMacro(page, editor, source, options = {}) {
	const { timeout = 30_000 } = options;
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await expect(manager).toBeVisible();
	await manager.locator('[data-macro-programs]')
		.getByRole('button', { name: 'New program', exact: true }).click();
	const program = manager.locator('[data-macro-script-source]');
	await expect(program).toBeVisible();
	await program.fill(source.trim());
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();

	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u, { timeout });
	// An arrangement that failed must fail its spec here, with what the program
	// said, rather than leaving a later assertion to fail against a state nobody
	// actually built.
	const outcome = await log.getAttribute('data-outcome');
	if (outcome !== 'completed') {
		throw new Error(`The arranging macro failed: ${(await log.textContent()) || 'no log output'}`);
	}
	await page.keyboard.press('Escape');
	await expect(manager).toBeHidden();
}
