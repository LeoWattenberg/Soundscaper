/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShortcutEditorRow, shortcutEditorDraft } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';

const actionId = 'new-mono-track';

test('Framescaper reports reserved navigation bindings but preserves modified and other-product choices', () => {
	for (const binding of ['j', 'K', 'L', 'Up', 'ArrowDown']) {
		const draft = shortcutEditorDraft({ productId: 'framescaper', shortcuts: {}, preferenceId: actionId, bindings: [binding] });
		assert.deepEqual(draft.conflict?.actionIds, [actionId, 'video-navigation']);
		assert.equal(draft.invalid, false);
	}
	for (const [productId, bindings] of [
		['framescaper', ['Ctrl+J', 'Shift+K', 'Alt+L', 'Meta+Up']],
		['soundscaper', ['J', 'K', 'L', 'Up', 'Down']],
	] as const) {
		const draft = shortcutEditorDraft({ productId, shortcuts: {}, preferenceId: actionId, bindings });
		assert.equal(draft.conflict, null);
		assert.equal(draft.invalid, false);
	}
});

test('a reserved Framescaper shortcut renders its public reason and marks the binding invalid', () => {
	const markup = renderToStaticMarkup(<ShortcutEditorRow productId="framescaper"
		command={{ id: actionId, label: 'New mono track' }} preferences={{ shortcuts: { [actionId]: ['J'] } }}
		controller={{ actions: { preferences: { setShortcut: () => undefined } } }}
		copy={{ shortcutAssign: 'Assign', shortcutConflict: 'Shortcut {binding} conflicts with {action}.', videoNavigation: 'Video navigation' }}
		run={(operation) => operation()} />);
	assert.match(markup, /role="alert"[^>]*>Shortcut J conflicts with Video navigation\./u);
	assert.match(markup, /aria-invalid="true"/u);
});
