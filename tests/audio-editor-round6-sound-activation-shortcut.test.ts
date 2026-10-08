/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { recordingSettingsOwnNavigation } from '../src/common/editor/ui/toolbar/record-flyout-keyboard.ts';

for (const key of ['ArrowRight', 'Home', 'End']) {
	for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] as const) {
		test(`recording settings release navigation already owned by ${modifier}: ${key}`, () => {
			assert.equal(recordingSettingsOwnNavigation({ key, [modifier]: true }), false);
		});
	}
}

test('recording settings keep their native navigation and preserve unrelated keys', () => {
	for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
		assert.equal(recordingSettingsOwnNavigation({ key }), true);
	}
	for (const key of ['Tab', 'Escape', 'Enter', 'b']) {
		assert.equal(recordingSettingsOwnNavigation({ key }), false);
	}
});
