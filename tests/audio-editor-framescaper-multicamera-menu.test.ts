/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperMulticameraActionsV18,
} from '../src/framescaper/editor-project-v18-multicam-actions.ts';
import {
	createFramescaperMulticameraMenuItems,
} from '../src/common/editor/ui/framescaper-multicamera-menu.ts';
import type { FramescaperProjectCommandV18 } from '../src/framescaper/editor-project-v18-subsequence.ts';

const COPY = Object.freeze({
	multicamera: 'Multicamera',
	createMulticamera: 'Create from video sources',
	switchMulticamera: 'Switch camera',
	nudgeMulticameraEarlier: 'Move active camera one frame earlier',
	nudgeMulticameraLater: 'Move active camera one frame later',
	removeMulticamera: 'Remove multicamera group',
});

test('product actions construct the four exact fenced multicamera command families', () => {
	const commands: FramescaperProjectCommandV18[] = [];
	const actions = createFramescaperMulticameraActionsV18(
		(command: FramescaperProjectCommandV18) => commands.push(command),
	);
	const group = multicameraGroup();
	actions.createMulticamera('project-a', 7, group);
	actions.updateMulticamera('project-a', 8, 'group-a', 'camera-a', {
		...group,
		members: [{ ...group.members[0]!, syncOffsetSamples: -1 }, group.members[1]!],
	});
	actions.switchMulticamera('project-a', 9, 'group-a', 'camera-a', 'camera-b');
	actions.removeMulticamera('project-a', 10, 'group-a', 'camera-b');
	assert.deepEqual(commands.map(({ type }) => type), [
		'multicamera/create', 'multicamera/update', 'multicamera/switch', 'multicamera/remove',
	]);
	assert.deepEqual(commands[0], {
		type: 'multicamera/create', projectId: 'project-a', expectedProjectRevision: 7, group,
	});
	assert.deepEqual(commands[2], {
		type: 'multicamera/switch', projectId: 'project-a', expectedProjectRevision: 9,
		groupId: 'group-a', expectedActiveMemberId: 'camera-a', memberId: 'camera-b',
	});
	assert.ok(commands.every(Object.isFrozen));
	assert.throws(() => actions.createMulticamera('project-a', 7, { ...group, autoSync: true }),
		/unsupported field/iu);
	assert.throws(() => actions.switchMulticamera('project-a', 7, 'group-a', 'camera-a', ''),
		/non-empty/iu);
});

test('the Tracks menu creates one bounded zero-offset group from explicit selected video', () => {
	const commands: FramescaperProjectCommandV18[] = [];
	const menu = createFramescaperMulticameraMenuItems({
		productId: 'framescaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => commands.push(command) });
	assert.equal(menu?.id, 'multicamera');
	assert.equal(menu?.disabled, false);
	assert.deepEqual(menu?.items.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'multicamera-create', disabled: false },
		{ id: 'multicamera-switch', disabled: true },
		{ id: 'multicamera-nudge-earlier', disabled: true },
		{ id: 'multicamera-nudge-later', disabled: true },
		{ id: 'multicamera-remove', disabled: true },
	]);
	menu?.items[0]?.onClick();
	assert.deepEqual(commands, [{
		type: 'multicamera/create', projectId: 'project-a', expectedProjectRevision: 7,
		group: {
			id: 'multicamera-output-clip-1', projectId: 'project-a', sequenceId: 'main',
			outputClipId: 'output-clip', activeMemberId: 'multicamera-output-clip-1-camera-1',
			members: [
				{ id: 'multicamera-output-clip-1-camera-1', groupId: 'multicamera-output-clip-1',
					sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'multicamera-output-clip-1-camera-2', groupId: 'multicamera-output-clip-1',
					sourceId: 'camera-b', syncOffsetSamples: 0 },
			],
		},
	}]);
	assert.equal(Object.isFrozen(commands[0]), true);
	assert.equal(createFramescaperMulticameraMenuItems({
		productId: 'framescaper', project: { ...project(), schemaVersion: 19 }, editingBlocked: false, copy: COPY,
	}, { execute: () => undefined })?.disabled, false);
	assert.equal(createFramescaperMulticameraMenuItems({
		productId: 'framescaper', project: { ...project(), schemaVersion: 20 }, editingBlocked: false, copy: COPY,
	}, { execute: () => undefined })?.disabled, false);
});

test('the Tracks menu switches, frame-nudges, and removes only the selected group', () => {
	const commands: FramescaperProjectCommandV18[] = [];
	const input = project();
	input.multicameraGroups = [multicameraGroup()];
	const menu = createFramescaperMulticameraMenuItems({
		productId: 'framescaper', project: input, editingBlocked: false, copy: COPY,
	}, { execute: (command) => commands.push(command) });
	assert.deepEqual(menu?.items.map(({ disabled }) => disabled), [true, false, false, false, false]);
	for (const item of menu?.items.slice(1) ?? []) item.onClick();
	assert.deepEqual(commands.map(({ type }) => type), [
		'multicamera/switch', 'multicamera/update', 'multicamera/update', 'multicamera/remove',
	]);
	assert.equal((commands[0] as { memberId: string }).memberId, 'camera-b');
	assert.equal(
		(commands[1] as unknown as { group: ReturnType<typeof multicameraGroup> }).group.members[0]
			?.syncOffsetSamples,
		-1_920,
	);
	assert.equal(
		(commands[2] as unknown as { group: ReturnType<typeof multicameraGroup> }).group.members[0]
			?.syncOffsetSamples,
		1_920,
	);
	assert.equal(Object.isFrozen((commands[1] as { group: object }).group), true);
});

test('the Tracks menu offers no nudge where no whole sample count spans one source frame', () => {
	const input = project({ num: 30_000, den: 1_001 });
	input.multicameraGroups = [multicameraGroup()];
	const menu = createFramescaperMulticameraMenuItems({
		productId: 'framescaper', project: input, editingBlocked: false, copy: COPY,
	}, { execute: () => assert.fail('disabled menu executed') });
	assert.deepEqual(menu?.items.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'multicamera-create', disabled: true },
		{ id: 'multicamera-switch', disabled: false },
		{ id: 'multicamera-nudge-earlier', disabled: true },
		{ id: 'multicamera-nudge-later', disabled: true },
		{ id: 'multicamera-remove', disabled: false },
	]);
	for (const item of menu?.items.slice(2, 4) ?? []) item.onClick();
});

test('multicamera menu is Framescaper-only and fail-closed for stale or blocked selections', () => {
	const execute = { execute: () => assert.fail('disabled menu executed') };
	assert.equal(createFramescaperMulticameraMenuItems({
		productId: 'soundscaper', project: project(), editingBlocked: false, copy: COPY,
	}, execute), null);
	for (const candidate of [
		{ ...project(), schemaVersion: 17 },
		{ ...project(), selection: { clipIds: [] } },
	]) {
		const menu = createFramescaperMulticameraMenuItems({
			productId: 'framescaper', project: candidate, editingBlocked: false, copy: COPY,
		}, execute);
		if (menu) assert.equal(menu.disabled, true);
	}
	const blocked = createFramescaperMulticameraMenuItems({
		productId: 'framescaper', project: project(), editingBlocked: true, copy: COPY,
	}, execute);
	assert.equal(blocked?.disabled, true);
});

function multicameraGroup() {
	return {
		id: 'group-a', projectId: 'project-a', sequenceId: 'main', outputClipId: 'output-clip',
		activeMemberId: 'camera-a', members: [
			{ id: 'camera-a', groupId: 'group-a', sourceId: 'camera-a', syncOffsetSamples: 0 },
			{ id: 'camera-b', groupId: 'group-a', sourceId: 'camera-b', syncOffsetSamples: 1_920 },
		],
	};
}

function project(
	rate: Readonly<{ num: number; den: number }> = { num: 25, den: 1 },
): Record<string, unknown> & { multicameraGroups: unknown[] } {
	const timingDecision = { mode: 'conform-cfr-at-ingest', rate };
	return {
		id: 'project-a', revision: 7, schemaVersion: 18, primarySequenceId: 'main', sampleRate: 48_000,
		selection: { clipIds: ['output-clip'] },
		sources: [
			{ id: 'camera-b', kind: 'video', sampleFrameCount: 48_000, frameRate: rate, timingDecision },
			{ id: 'audio', kind: 'audio', sampleFrameCount: 48_000 },
			{ id: 'camera-a', kind: 'video', sampleFrameCount: 48_000, frameRate: rate, timingDecision },
		],
		clips: [{
			id: 'output-clip', kind: 'video', sourceId: 'camera-a', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
		}],
		multicameraGroups: [],
	};
}
