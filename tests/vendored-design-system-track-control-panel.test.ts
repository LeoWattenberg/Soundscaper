/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PANEL_URL = new URL(
	'../vendor/audacity-design-system/components/src/TrackControlPanel/TrackControlPanel.tsx',
	import.meta.url,
);
test('ending a rename by clicking another control leaves focus where the user put it', async () => {
	const source = await readFile(PANEL_URL, 'utf8');
	const commit = source.slice(source.indexOf('const commitRename'), source.indexOf('// Drag-to-reorder gesture'));

	assert.match(commit, /const commitRename = \(returnFocus: boolean\) => \{/u);
	assert.match(commit, /if \(returnFocus\) focusReturnRef\.current = true;/u);
	assert.doesNotMatch(
		commit,
		/^\s*focusReturnRef\.current = true;$/mu,
		'an unconditional focus return yanks focus off the control the user clicked to end the rename',
	);
});

test('a keyboard rename commit and a cancel still return focus to the track name', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.match(source, /if \(e\.key === 'Enter'\) \{\s*e\.preventDefault\(\);\s*commitRename\(true\);/u);
	assert.match(source, /onBlur=\{\(\) => commitRename\(false\)\}/u);
	assert.match(source, /const cancelRename = \(\) => \{[\s\S]*?focusReturnRef\.current = true;/u);
});

test('drag-to-reorder only listens on the document while a drag is armed', async () => {
	const source = await readFile(PANEL_URL, 'utf8');
	const gesture = source.slice(source.indexOf('const DRAG_REORDER_THRESHOLD'), source.indexOf('const cancelRename'));

	assert.match(gesture, /React\.useEffect\(\(\) => \{\s*if \(!isDragReorderArmed\) return;/u);
	assert.match(
		gesture,
		/const handleDragReorderMouseDown[\s\S]*?dragReorderStartRef\.current = \{ y: e\.clientY, active: false \};\s*setIsDragReorderArmed\(true\);/u,
	);
	assert.match(gesture, /const onUp = \(e: MouseEvent\) => \{[\s\S]*?setIsDragReorderArmed\(false\);/u);
	assert.match(gesture, /document\.addEventListener\('mousemove', onMove\);/u);
	assert.match(gesture, /document\.removeEventListener\('mouseup', onUp\);/u);
});

test('a consumer can isolate live meter rendering without replacing the track panel', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.match(source, /meterContent\?: React\.ReactNode;/u);
	assert.match(source, /meterContent !== undefined \? meterContent :/u);
	assert.match(source, /<div className="track-control-panel__meter">/u);
});

test('volume and pan controls expose complete automation gesture lifecycles', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	for (const name of [
		'onVolumeGestureStart', 'onVolumeGestureEnd', 'onVolumeGestureCancel',
		'onPanGestureStart', 'onPanGestureEnd', 'onPanGestureCancel',
	]) {
		assert.match(source, new RegExp(`${name}\\?:`, 'u'));
	}
	assert.match(source, /<PanKnob[\s\S]*?onGestureStart=\{onPanGestureStart\}[\s\S]*?onGestureEnd=\{onPanGestureEnd\}[\s\S]*?onGestureCancel=\{onPanGestureCancel\}/u);
	assert.match(source, /<Slider[\s\S]*?onGestureStart=\{onVolumeGestureStart\}[\s\S]*?onGestureEnd=\{onVolumeGestureEnd\}[\s\S]*?onGestureCancel=\{onVolumeGestureCancel\}/u);
});
