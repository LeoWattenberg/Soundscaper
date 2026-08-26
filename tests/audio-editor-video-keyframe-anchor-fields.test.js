/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const EDITOR = new URL(
	'../src/common/editor/ui/inspector/VideoKeyframeCurveEditor.tsx',
	import.meta.url,
);

/**
 * The anchor drafts are seeded on mount and resynced both by the reseed effect
 * and by selecting an anchor, so a render-time fallback to the stored value is
 * redundant. It is also harmful: clearing the field leaves the state empty while
 * React rewrites the input back to the stored text, so the caret sits in a field
 * showing a number the submit handler does not have, and submitting reports the
 * entry invalid while a valid value is on screen.
 */
test('anchor fields render their own draft rather than falling back to the stored value', async () => {
	const source = await readFile(EDITOR, 'utf8');
	const field = (name) => {
		const match = new RegExp(`data-video-keyframe-field="${name}"[^>]*`, 'u').exec(source);
		assert.ok(match, `the ${name} field is present`);
		return match[0];
	};

	assert.match(field('anchor-position'), /value=\{positionText\}/u);
	assert.doesNotMatch(field('anchor-position'), /value=\{positionText \|\|/u);
	assert.match(field('anchor-value'), /value=\{valueText\}/u);
	assert.doesNotMatch(field('anchor-value'), /value=\{valueText \|\|/u);

	// The drafts must still be resynced, or dropping the fallback would leave a
	// stale field behind when the selected anchor or curve changes.
	assert.match(source, /setPositionText\(nextVisible \? rationalText\(nextVisible\) : ''\)/u);
	assert.match(source, /setValueText\(String\(nextAnchor\?\.value \?\? ''\)\)/u);
});
