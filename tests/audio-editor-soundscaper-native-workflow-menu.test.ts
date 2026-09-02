/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperWorkflowApplicationMenuItems,
} from '../src/common/editor/ui/soundscaper-workflow-application-menu.ts';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';

const BASE_PROJECT = createSoundscaperProject({
	id: 'project', title: 'Project', now: '2026-09-01T00:00:00.000Z', revision: 0,
	tracks: [{ type: 'audio', id: 'voice', name: 'Voice' }],
} as never);
const PROJECT = Object.freeze({
	...BASE_PROJECT,
	tracks: Object.freeze([Object.freeze({
		...BASE_PROJECT.tracks[0],
		clipIds: Object.freeze(['clip']),
		effects: Object.freeze([Object.freeze({ id: 'effect', enabled: true })]),
	})]),
});

test('Soundscaper workflow menus retain freeze and standalone mastering only', () => {
	const calls: unknown[] = [];
	const items = createSoundscaperWorkflowApplicationMenuItems({
		productId: 'soundscaper',
		capabilities: { audioTrackFreeze: true, masteringSequences: true },
		project: PROJECT,
		selectedTrackId: 'voice',
		freezeStatus: 'none',
		freezeActionsAvailable: true,
		editingBlocked: false,
		readOnly: false,
		copy: new Proxy({}, { get: (_target, property) => String(property) }),
	}, {
		openMasteringSequences: () => { calls.push('mastering-sequences'); },
		freeze: (operation, trackId) => { calls.push([operation, trackId]); },
	});

	assert.deepEqual(items.mixer, []);
	assert.deepEqual(items.effect, []);
	assert.deepEqual(items.analyze, []);
	assert.equal(items.tracks[0]?.id, 'soundscaper-freeze');
	assert.equal(items.tools[0]?.id, 'soundscaper-mastering-sequences');
	items.tools[0]?.onClick?.();
	assert.deepEqual(calls, ['mastering-sequences']);
});

test('Soundscaper workflow menus never leak into Framescaper', () => {
	const items = createSoundscaperWorkflowApplicationMenuItems({
		productId: 'framescaper',
		capabilities: { audioTrackFreeze: true, masteringSequences: true },
		project: PROJECT,
		selectedTrackId: 'voice',
		editingBlocked: false,
	}, {
		openMasteringSequences: () => undefined,
		freeze: () => undefined,
	});
	assert.deepEqual(items, { tracks: [], mixer: [], effect: [], analyze: [], tools: [] });
});

test('Reviewed Utility Gain belongs to the canonical Special Effects group', () => {
	const special = EFFECT_MENU_GROUPS.find(([copyKey]) => copyKey === 'specialEffects');
	assert.ok(special);
	assert.ok(special[1].includes('reviewed-utility-gain'));
});
