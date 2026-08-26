/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('timeline clip rename paths require a selected focused clip and preserve inline completion semantics', async () => {
	const [track, header, audioRow, videoRow, properties] = await Promise.all([
		readFile(new URL('vendor/audacity-design-system/components/src/Track/TrackNew.tsx', ROOT), 'utf8'),
		readFile(new URL('vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/timeline/AudioTrackRow.jsx', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/timeline/VideoTrackRow.jsx', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/inspector/ClipPropertiesDialog.jsx', ROOT), 'utf8'),
	]);

	assert.match(track, /e\.key === 'F2'[\s\S]*?!e\.altKey[\s\S]*?!e\.ctrlKey[\s\S]*?!e\.metaKey[\s\S]*?!e\.shiftKey[\s\S]*?!e\.repeat[\s\S]*?clipSelected[\s\S]*?onClipRename/u);
	assert.match(videoRow, /event\.key === 'F2'[\s\S]*?!event\.altKey[\s\S]*?!event\.ctrlKey[\s\S]*?!event\.metaKey[\s\S]*?!event\.shiftKey[\s\S]*?!event\.repeat[\s\S]*?!blocked[\s\S]*?selectedClipIdSet\.has/u);
	assert.match(header, /renameRequestId[\s\S]*?consumedRenameRequestRef[\s\S]*?setIsRenaming\(true\)/u);
	assert.match(header, /if \(next && next !== name\) onRename\?\.\(next\);[\s\S]*?onRenameFinished\?\.\(\);/u);
	assert.match(header, /if \(e\.key === 'Escape'\)[\s\S]*?cancelRename\(\);/u);
	assert.match(audioRow, /controller\.actions\.clip\.update\(String\(clipId\), \{ title: nextTitle \}\)/u);
	assert.match(videoRow, /controller\.actions\.clip\.update\(clip\.id, \{ title: nextTitle \}\)/u);
	assert.match(properties, /if \(name === 'name'\)[\s\S]*?controller\.actions\.clip\.update\(clip\.id, \{ title \}\)/u);
	// The dialog commits on blur, so an untouched placeholder must not be adopted
	// as a real title; the displayed name falls back to the source's own name.
	assert.match(properties, /const displayedName = clip\?\.title \|\| source\?\.name \|\| copy\.clip;/u);
	assert.match(properties, /value=\{displayedName\}/u);
	assert.match(properties, /clipRenameTitle\(rawValue, displayedName\)/u);
});
