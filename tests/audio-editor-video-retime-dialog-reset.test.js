/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DIALOG = new URL(
	'../src/common/editor/ui/dialogs/VideoRetimeDialog.tsx',
	import.meta.url,
);

/**
 * Speed ramp and Freeze frame are separate fieldsets applied by separate
 * buttons. The direction decides only where the ramp starts, so resetting the
 * freeze entry alongside it threw away an unrelated value the operator had
 * typed and was about to apply.
 */
test('the speed-ramp direction resets only the ramp start', async () => {
	const source = await readFile(DIALOG, 'utf8');
	const effects = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n\t\}, \[([^\]]*)\]\);/gu)];
	const directionEffect = effects.find(([, , deps]) => deps.includes('direction'));
	assert.ok(directionEffect, 'a direction-keyed effect exists');

	assert.match(directionEffect[1], /setSourceStartFrame\(/u);
	assert.doesNotMatch(
		directionEffect[1],
		/setFreezeFrame\(/u,
		'the freeze entry belongs to its own fieldset, not to the ramp direction',
	);

	const freezeEffect = effects.find(([, body, deps]) => (
		body.includes('setFreezeFrame(') && !deps.includes('direction')
	));
	assert.ok(freezeEffect, 'the freeze entry is still reseeded when the clip changes');
});
