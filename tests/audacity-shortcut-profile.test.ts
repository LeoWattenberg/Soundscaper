/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
	AUDACITY_SHORTCUT_DISPOSITION,
	AUDACITY_SHORTCUT_PROFILE,
} from '../src/common/editor/audacity-shortcut-profile.ts';
import {
	AUDACITY_ACTION_DEFINITIONS,
	AUDACITY_ACTION_STATUS,
} from '../src/common/editor/audacity-action-inventory.js';
import {
	AUDACITY_ACTION_MANIFEST,
	audacityActionDefinition,
	resolveAudacityActionId,
} from '../src/common/editor/audacity-action-parity.js';
import { productProfile } from '../src/common/products.js';

const profile = new Map(AUDACITY_SHORTCUT_PROFILE.map((entry) => [entry.upstreamActionId, entry]));

test('the Audacity compatibility profile accounts for every imported shortcut record', () => {
	assert.equal(AUDACITY_SHORTCUT_PROFILE.length, 175);
	assert.equal(
		AUDACITY_SHORTCUT_PROFILE.reduce((total, entry) => total + entry.sequences.length, 0),
		184,
	);
	assert.ok(Object.isFrozen(AUDACITY_SHORTCUT_PROFILE));
	for (const entry of AUDACITY_SHORTCUT_PROFILE) {
		assert.ok(Object.isFrozen(entry), entry.upstreamActionId);
		assert.ok(Object.isFrozen(entry.sequences), entry.upstreamActionId);
		assert.ok(Object.values(AUDACITY_SHORTCUT_DISPOSITION).includes(entry.disposition));
	}
	assert.deepEqual(countBy(AUDACITY_SHORTCUT_PROFILE, 'sourceStatus'), {
		live: 98,
		'metadata-only': 4,
		stale: 73,
	});
	assert.deepEqual(countBy(AUDACITY_SHORTCUT_PROFILE, 'disposition'), {
		action: 131,
		native: 13,
		unavailable: 31,
	});
});

test('every action mapping resolves to an implemented Soundscaper function', () => {
	const definitions = new Map(AUDACITY_ACTION_DEFINITIONS.map((definition) => [definition.id, definition]));
	for (const entry of AUDACITY_SHORTCUT_PROFILE) {
		if (entry.disposition !== AUDACITY_SHORTCUT_DISPOSITION.ACTION) continue;
		const definition = definitions.get(entry.actionId || '');
		assert.equal(definition?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, entry.upstreamActionId);
		assert.equal(typeof definition?.handler, 'string', entry.upstreamActionId);
	}
});

test('the lean runtime bindings exactly project the reviewed compatibility profile', () => {
	const projected: Record<string, string[]> = {};
	for (const entry of AUDACITY_SHORTCUT_PROFILE) {
		if (entry.disposition !== AUDACITY_SHORTCUT_DISPOSITION.ACTION || !entry.actionId) continue;
		const bindings = projected[entry.actionId] ||= [];
		for (const sequence of entry.sequences) {
			if (!bindings.includes(sequence)) bindings.push(sequence);
		}
	}
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION, projected);
});

test('Audacity defaults replace the former approximations and preserve alternate sequences', () => {
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['project-import'], ['Ctrl+Shift+I']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION.split, ['Ctrl+I']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['split-tool'], ['S']);
	assert.equal(profile.get('split-tool')?.behavior, 'tap-hold');
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION.insert, ['Shift+V']);
	assert.equal(Object.hasOwn(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION, 'action://trackedit/paste-insert'), false);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['delete-per-track-ripple'], ['Shift+Del', 'Shift+Backspace']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['delete-all-tracks-ripple'], ['Ctrl+Del', 'Ctrl+Backspace']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['zoom-in'], ['Ctrl+=']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['zoom-out'], ['Ctrl+-']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['zoom-to-fit-project'], ['Ctrl+F']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['action://playback/play'], ['P']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['action://playback/toggle-play-stop'], ['Space']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['cursor-short-jump-left'], [',']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['cursor-long-jump-left'], ['Shift+,']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['play-position-decrease'], ['Left']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['mute-tracks'], ['Ctrl+Alt+U']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['unmute-tracks'], ['Ctrl+Alt+Shift+U']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-pan-left'], ['Alt+Shift+Left']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-pan-right'], ['Alt+Shift+Right']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-gain-inc'], ['Alt+Shift+Up']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-gain-dec'], ['Alt+Shift+Down']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-mute'], ['Shift+U']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-solo'], ['Shift+S']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-move-left'], ['Ctrl+Left']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-move-right'], ['Ctrl+Right']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-extend-left'], ['Shift+Left']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-extend-right'], ['Shift+Right']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-reduce-left'], ['Ctrl+Shift+Left']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-reduce-right'], ['Ctrl+Shift+Right']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-move-up'], ['Ctrl+Up']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-move-down'], ['Ctrl+Down']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['select-tool'], ['F1']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['draw-tool'], ['F3']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['realtime-effect-move-up'], ['Alt+Up']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['realtime-effect-move-down'], ['Alt+Down']);
	assert.equal(Object.hasOwn(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION, 'pitch-up'), false);
	assert.equal(Object.hasOwn(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION, 'pitch-down'), false);
});

test('renamed, contextual, native, and retired records keep explicit dispositions', () => {
	assert.equal(resolveAudacityActionId('action://trackedit/paste-insert'), 'insert');
	assert.equal(audacityActionDefinition('action://trackedit/paste-insert'), AUDACITY_ACTION_MANIFEST.insert);
	assert.equal(profile.get('action://trackedit/paste-insert')?.actionId, 'insert');
	assert.equal(profile.get('timer-record')?.actionId, 'set-up-timed-recording');
	assert.equal(profile.get('contrast-analyser')?.actionId, 'contrast-analyzer');
	assert.equal(profile.get('track-view-item-extend-left')?.actionId, 'track-view-item-extend-left');
	assert.equal(profile.get('sel-ext-left')?.actionId, 'track-view-item-extend-left');
	assert.equal(profile.get('sel-ext-right')?.actionId, 'track-view-item-extend-right');
	assert.equal(profile.get('sel-cntr-right')?.actionId, 'track-view-item-reduce-left');
	assert.equal(profile.get('sel-cntr-left')?.actionId, 'track-view-item-reduce-right');
	assert.equal(profile.get('seek-left-long')?.actionId, 'track-view-item-extend-left');
	assert.equal(profile.get('seek-left-short')?.actionId, 'play-position-decrease');
	assert.equal(profile.get('cursor-short-jump-left')?.actionId, 'cursor-short-jump-left');
	assert.equal(profile.get('cursor-long-jump-left')?.actionId, 'cursor-long-jump-left');
	assert.equal(profile.get('action://record/stop')?.actionId, 'action://playback/toggle-play-stop');
	assert.equal(profile.get('nav-right')?.disposition, AUDACITY_SHORTCUT_DISPOSITION.NATIVE);
	assert.equal(profile.get('select-tool')?.actionId, 'select-tool');
	assert.equal(profile.get('draw-tool')?.actionId, 'draw-tool');
	assert.equal(profile.get('pitch-up')?.actionId, 'realtime-effect-move-up');
	assert.equal(profile.get('realtime-effect-move-up')?.actionId, 'realtime-effect-move-up');
	for (const id of [
		'mute-tracks', 'unmute-tracks', 'track-pan-left', 'track-pan-right',
		'track-gain-inc', 'track-gain-dec', 'track-mute', 'track-solo',
	]) {
		assert.equal(profile.get(id)?.actionId, id);
		assert.equal(productProfile('soundscaper').shortcuts.disabledCommandIds.includes(id), false);
		assert.equal(productProfile('framescaper').shortcuts.disabledCommandIds.includes(id), false);
	}
	assert.equal(profile.get('multi-tool')?.reason, 'unsupported');
});

test('every live Audacity command is mapped or deliberately left to the host platform', () => {
	const unavailable = AUDACITY_SHORTCUT_PROFILE.filter((entry) => (
		entry.sourceStatus === 'live'
		&& entry.disposition === AUDACITY_SHORTCUT_DISPOSITION.UNAVAILABLE
	));
	assert.deepEqual(unavailable.map(({ upstreamActionId, reason }) => ({ upstreamActionId, reason })), [
		{ upstreamActionId: 'quit', reason: 'platform-policy' },
	]);
});

function countBy<Entry, Key extends keyof Entry>(
	entries: readonly Entry[],
	key: Key,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) {
		const value = String(entry[key]);
		counts[value] = (counts[value] || 0) + 1;
	}
	return counts;
}
