/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('unimplemented assistance accuracy criteria stay in manual QA, not the runnable config', async () => {
	const [config, guide] = await Promise.all([
		readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);
	for (const id of [
		'm7-local-assistance-speech-accuracy',
		'm7-local-assistance-visual-accuracy',
		'm7-local-assistance-speech-accuracy-v1',
		'm7-local-assistance-visual-accuracy-v1',
	]) {
		assert.doesNotMatch(JSON.stringify(config), new RegExp(id, 'u'));
	}
	assert.match(guide, /local assistance.*manual QA/isu);
	assert.match(guide, /real offline models and runners/iu);
});
