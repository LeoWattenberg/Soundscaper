/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DIALOG = new URL(
	'../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx',
	import.meta.url,
);

/**
 * The authoring model is rebuilt on every playhead move because the freeze
 * surface fences against it. Reseeding the form from the model object therefore
 * fired continuously during playback and discarded in-progress entry on the
 * dissolve, adjustment and mask surfaces, which never read the playhead.
 */
test('the authoring form reseeds on document identity, not on the playhead', async () => {
	const source = await readFile(DIALOG, 'utf8');
	const reseed = /setFinishingPresetId\([\s\S]*?\n\t\}, \[([\s\S]*?)\]\);/u.exec(source);
	assert.ok(reseed, 'the reseed effect is present');
	const dependencies = reseed[1]!;

	assert.doesNotMatch(
		dependencies,
		/playhead/iu,
		'the playhead must not reseed the form',
	);
	assert.doesNotMatch(
		dependencies.replace(/model\.\w+/gu, ''),
		/\bmodel\b/u,
		'depending on the whole model reintroduces the playhead through the memo',
	);
	for (const field of [
		'model.surface', 'model.selectedClipId', 'model.selectedPairId',
		'model.adjustmentBrightness', 'model.adjustmentLayerId', 'model.selectedMaskId',
	]) {
		assert.ok(dependencies.includes(field), `${field} still reseeds the form`);
	}
});
