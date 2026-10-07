/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createTimelineMenuModel } from '../src/common/editor/ui/timeline/timeline-menu-model.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function removalFixture(context: TestContext, levels: readonly number[], removedIndex: number) {
	const dom = installReactTestDom();
	context.after(() => dom.restore());
	const document = dom.container.ownerDocument;
	const editor = document.createElement('main');
	editor.setAttribute('data-audio-editor', '');
	dom.container.appendChild(editor);
	const rows = levels.map((level, index) => {
		const row = document.createElement('div');
		row.setAttribute('tabindex', '0');
		row.setAttribute('data-track-folder-row', '');
		row.setAttribute('data-folder-id', `folder-${String(index)}`);
		row.setAttribute('aria-level', String(level));
		editor.appendChild(row);
		return row;
	});
	const menu = document.createElement('div');
	menu.setAttribute('class', 'audio-editor-track-folder-menu');
	const item = document.createElement('button');
	menu.appendChild(item);
	editor.appendChild(menu);
	item.focus();
	const frames: FrameRequestCallback[] = [];
	Object.defineProperty(globalThis, 'requestAnimationFrame', {
		configurable: true, value: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; },
	});
	const folderId = `folder-${String(removedIndex)}`;
	const dispositions: string[] = [];
	const model = createTimelineMenuModel({
		controller: { actions: { trackFolders: { remove(id: string, disposition: string) {
			assert.equal(id, folderId); dispositions.push(disposition);
			editor.removeChild(rows[removedIndex]!); editor.removeChild(menu);
		} } } },
		copy: COPY, snapshot: { timeline: {}, capabilities: {} }, state: {
			trackMenu: { folderId }, waveformRulerState: {},
		}, model: { project: { tracks: [], clips: [], trackFolders: [{ id: folderId }], loop: {} }, sampleRate: 48_000 },
		menuActions: { run: (operation: () => unknown) => operation() },
	} as unknown as Parameters<typeof createTimelineMenuModel>[0]);
	const remove = (disposition: 'promote' | 'delete-contents' = 'promote') => {
		const index = disposition === 'promote' ? model.folderMenuItems.length - 2 : model.folderMenuItems.length - 1;
		model.folderMenuItems[index]!.onClick?.();
	};
	return { document, editor, rows, item, frames, dispositions, remove };
}

test('folder removal menu hands lost keyboard focus to its surviving parent', context => {
	const fixture = removalFixture(context, [1, 2, 2], 1);
	fixture.remove();
	fixture.frames.shift()?.(0);
	assert.deepEqual(fixture.dispositions, ['promote']);
	assert.equal(fixture.document.activeElement, fixture.rows[0]);
});

test('removing a root folder continues with the next surviving tree row', context => {
	const fixture = removalFixture(context, [1, 1], 0);
	fixture.remove('delete-contents');
	fixture.frames.shift()?.(0);
	assert.deepEqual(fixture.dispositions, ['delete-contents']);
	assert.equal(fixture.document.activeElement, fixture.rows[1]);
});

test('a folder removal handoff preserves a subsequent deliberate focus change', context => {
	const fixture = removalFixture(context, [1, 2], 1);
	fixture.remove();
	const field = fixture.document.createElement('input');
	fixture.editor.appendChild(field); field.focus();
	fixture.frames.shift()?.(0);
	assert.equal(fixture.document.activeElement, field);
});
