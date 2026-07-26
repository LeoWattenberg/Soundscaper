/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCheckboxChangeCoalescer } from '../src/common/editor/ui/EditorPreferenceCheckbox.tsx';

test('checkbox adapter publishes one value for the vendor wrapper gesture', () => {
	const scheduled: Array<() => void> = [];
	const published: boolean[] = [];
	const onChange = createCheckboxChangeCoalescer(
		(checked) => published.push(checked),
		(callback) => scheduled.push(callback),
	);

	onChange(true);
	onChange(true);
	assert.deepEqual(published, [true]);
	scheduled.shift()?.();
	onChange(false);
	onChange(false);
	assert.deepEqual(published, [true, false]);
});
