/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { effectsPanelAutoFocusOnMount } from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('a docked effects rack claims focus on a fresh open but not when it follows a dock move', () => {
	assert.equal(effectsPanelAutoFocusOnMount(null, 'right'), true, 'first open');
	assert.equal(effectsPanelAutoFocusOnMount('right', 'right'), true, 'the same host re-rendering');
	assert.equal(effectsPanelAutoFocusOnMount('right', 'left'), false, 'moved to another dock');
	assert.equal(effectsPanelAutoFocusOnMount('left', 'floating'), false, 'floated from a dock');
});

test('the autofocus opt-out reaches the vendored panel from every docked host', async () => {
	const panel = await source('vendor/audacity-design-system/components/src/EffectsPanel/EffectsPanel.tsx');
	assert.match(panel, /autoFocusOnOpen\?: boolean;/u, 'the vendored panel declares the prop');
	assert.match(panel, /autoFocusOnOpen = true,/u, 'the prop defaults to upstream behaviour');
	assert.match(panel, /if \(isOpen && autoFocusOnOpen && panelRef\.current && !hasAutoFocused\.current\)/u, 'the open-time focus honours it');
	const overlay = await source('src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx');
	assert.match(overlay, /autoFocusOnOpen=\{autoFocusOnOpen\}/u, 'the overlay forwards it');
	const content = await source('src/common/editor/ui/workspace/WorkspacePanelContent.jsx');
	assert.match(content, /<DockedEffectsPanel\s+host=\{dock\}/u, 'the docked rack is keyed by its host');
	for (const [host, expected] of [['WorkspacePanelDock.jsx', /dock=\{dock\}/u], ['VideoEditorWorkspacePanels.jsx', /dock="video-editor"/u]]) {
		assert.match(await source(`src/common/editor/ui/workspace/${host}`), expected, `${host} names its host`);
	}
	const readme = await source('vendor/audacity-design-system/README.md');
	assert.match(readme, /`EffectsPanel\.tsx` accepts an `autoFocusOnOpen` prop/u, 'the deviation is recorded');
});
