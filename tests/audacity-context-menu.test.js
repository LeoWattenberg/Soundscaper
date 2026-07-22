import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_CLIP_CONTEXT_ACTION_IDS,
	AUDACITY_TRACK_CONTEXT_ACTION_IDS,
	audacityContextMenuAction,
} from '../src/common/editor/audacity-context-menu.js';
import { audacityActionDefinition } from '../src/common/editor/audacity-action-parity.js';

test('track and clip context mappings use canonical manifest IDs or explicit supplemental IDs', () => {
	for (const actionId of [
		...Object.values(AUDACITY_TRACK_CONTEXT_ACTION_IDS),
		...Object.values(AUDACITY_CLIP_CONTEXT_ACTION_IDS),
	]) {
		const action = audacityContextMenuAction(actionId);
		assert.equal(action.actionId, actionId);
		if (actionId.startsWith('local://')) {
			assert.equal(action.parityStatus, 'supplemental');
			assert.equal(action.origin, 'local');
		} else {
			assert.ok(audacityActionDefinition(actionId), actionId);
			assert.equal(action.parityStatus, 'implemented');
		}
	}
});

test('context metadata preserves localized labels and consumes manifest shortcuts and state', () => {
	const split = audacityContextMenuAction(AUDACITY_CLIP_CONTEXT_ACTION_IDS.split, {
		locale: 'de',
		label: 'An Abspielposition teilen',
	});
	assert.equal(split.label, 'An Abspielposition teilen');
	assert.equal(split.shortcut, 'S');
	assert.equal(split.enableWhen, 'editable-selection-or-clip');
	assert.equal(split.disabled, false);

	const unavailable = audacityContextMenuAction(AUDACITY_CLIP_CONTEXT_ACTION_IDS.renderPitchSpeed, {
		disabled: true,
		disabledReason: 'nicht verfügbar',
	});
	assert.equal(unavailable.disabled, true);
	assert.equal(unavailable.disabledReason, 'nicht verfügbar');

	const supplemental = audacityContextMenuAction(AUDACITY_CLIP_CONTEXT_ACTION_IDS.reverse, {
		label: 'Reverse',
	});
	assert.equal(supplemental.label, 'Reverse');
	assert.equal(supplemental.parityStatus, 'supplemental');
});

test('disabled-upstream and excluded manifest statuses override context handlers truthfully', () => {
	const disabled = audacityContextMenuAction('spectral-brush', { locale: 'de' });
	assert.equal(disabled.parityStatus, 'disabled-upstream');
	assert.equal(disabled.disabled, true);
	assert.match(disabled.disabledReason, /Audacity 4/);

	const excluded = audacityContextMenuAction('plugin-manager');
	assert.equal(excluded.parityStatus, 'excluded');
	assert.equal(excluded.hidden, true);
	assert.equal(excluded.disabled, true);
	assert.match(excluded.disabledReason, /plugin/i);
	assert.throws(() => audacityContextMenuAction('typo-command'), /Unknown Audacity context-menu action/);
});
