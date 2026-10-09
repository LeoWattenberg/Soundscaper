/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeTimelineAnnotationRenameKey } from '../src/common/editor/ui/timeline/timeline-annotation-rename-keyboard.ts';

for (const key of ['Enter', 'Escape']) test(`annotation rename releases composing ${key}`, () => {
	const calls: string[] = [];
	const event = { key, nativeEvent: { isComposing: true },
		preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') };
	assert.equal(consumeTimelineAnnotationRenameKey(event), null);
	assert.equal(calls.length, 0);
	assert.deepEqual(consumeTimelineAnnotationRenameKey({ ...event, nativeEvent: { isComposing: false } }),
		{ save: key === 'Enter', restoreFocus: true });
	assert.deepEqual(calls, ['stop', 'prevent']);
});
