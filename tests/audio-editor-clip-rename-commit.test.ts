/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { clipRenameTitle } from '../src/common/editor/ui/inspector/ClipPropertiesDialog.jsx';

/**
 * The Clip Properties name field commits on blur, and an untitled clip shows a
 * placeholder — its source name, or a generic label. Tabbing through the field
 * must not turn that placeholder into the clip's real title.
 */
test('leaving the displayed placeholder untouched renames nothing', () => {
	assert.equal(clipRenameTitle('Clip', 'Clip'), null);
	assert.equal(clipRenameTitle('interview-take-3.wav', 'interview-take-3.wav'), null);
	assert.equal(clipRenameTitle('  Clip  ', 'Clip'), null, 'surrounding space is not an edit');
});

test('an edited name is committed', () => {
	assert.equal(clipRenameTitle('Opening line', 'Clip'), 'Opening line');
	assert.equal(clipRenameTitle('  Opening line  ', 'Clip'), 'Opening line');
});

test('an emptied name is refused rather than committed', () => {
	assert.throws(() => clipRenameTitle('', 'Clip'), /clip name is required/iu);
	assert.throws(() => clipRenameTitle('   ', 'Clip'), /clip name is required/iu);
});
