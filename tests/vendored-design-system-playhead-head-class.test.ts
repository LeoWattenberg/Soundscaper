/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const CURSOR = resolve(ROOT, 'vendor/audacity-design-system/components/src/PlayheadCursor/PlayheadCursor.tsx');
const ANNOTATIONS = resolve(ROOT, 'src/common/editor/ui/audio-editor-design-system/19-timeline-annotations.css');

// The head is the one part of the playhead that takes a pointer, and it hangs
// above its boundary into the strip the marker lane owns. The editor withdraws
// it from hit testing while that lane is open, which it can only do by class:
// the component's own stylesheet already names one, but the element carried no
// class at all, so the rule matched nothing and an annotation at the playhead's
// own time could not be clicked.
test('the playhead head carries the class its stylesheet and the marker lane both target', async () => {
	const source = await readFile(CURSOR, 'utf8');
	const head = source.slice(source.indexOf('{showTopIcon && ('));
	assert.match(head.slice(0, 600), /className="playhead-cursor__icon"/u);
	assert.match(head.slice(0, 600), /pointerEvents: onPositionChange \? 'auto' : 'none'/u);

	const annotations = await readFile(ANNOTATIONS, 'utf8');
	assert.match(
		annotations,
		/\[data-show-markers='true'\][\s\S]{0,200}\.playhead-cursor__icon \{\n\tpointer-events: none !important;/u,
	);
});
