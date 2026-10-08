/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing as apply, snapshotFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing as modelFor } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing as prepare } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';

type Project = ReturnType<typeof createFramescaperProjectFinishing>;
type Clip = Readonly<{ id: string; videoEffects: readonly Readonly<{ id: string; params: Readonly<{ brightness: number }> }>[] }>;
const store = {} as AudioEditorProjectStore;

test('a replayed split preserves adjustment membership and selected brightness', async () => {
	const adjusted = await adjustedProject();
	const split = splitProject(adjusted);
	assert.equal(model(split, 'right').adjustmentBrightness, 0.5);
	assert.equal(model(split, 'video-clip').adjustmentBrightness, 0.5);
	assert.deepEqual(split.videoAdjustmentLayers[0]?.effectIds, [effect(adjusted, 'video-clip').id, 'right-effect']);
	assert.deepEqual(split, splitProject(adjusted), 'the same closed command replays without allocating identities');
});

test('updating and removing the right member preserve the left adjustment', async () => {
	const original = await adjustedProject();
	const split = splitProject(original);
	const left = structuredClone(effect(split, 'video-clip'));
	const updated = await author(split, 'right', 'apply', 0.75);
	assert.deepEqual(effect(updated, 'video-clip'), left);
	assert.equal(effect(updated, 'right').params.brightness, 0.75);
	const removed = await author(updated, 'right', 'remove');
	assert.deepEqual(effect(removed, 'video-clip'), left);
	assert.deepEqual(clip(removed, 'right').videoEffects, []);
	assert.equal(model(removed, 'right').adjustmentLayerId, null);
	assert.equal(model(removed, 'video-clip').adjustmentBrightness, 0.5);
	assert.deepEqual(removed.videoAdjustmentLayers[0]?.effectIds, [left.id]);
	const cleared = await author(removed, 'video-clip', 'remove');
	assert.deepEqual(cleared.videoAdjustmentLayers, []);
});

test('a second split and an audio-led linked split preserve exact effect membership', async () => {
	const adjusted = await adjustedProject();
	const once = splitProject(adjusted);
	const twice = apply(PROFILE, once, {
		type: 'clip/split', clipId: 'right', atFrame: 38_400, rightClipId: 'third', rightVideoEffectIds: ['third-effect'],
	});
	assert.equal(model(twice, 'third').adjustmentBrightness, 0.5);
	assert.deepEqual(twice.videoAdjustmentLayers[0]?.effectIds, [effect(adjusted, 'video-clip').id, 'right-effect', 'third-effect']);
	const linked = structuredClone(adjusted) as Project & { clips: Record<string, unknown>[]; tracks: Record<string, unknown>[] };
	for (const value of linked.clips) value.avLinkId = 'link';
	for (const value of linked.tracks) value.laneGroupId = 'lanes';
	const audioLed = apply(PROFILE, linked, {
		type: 'clip/split', clipId: 'audio-clip', atFrame: 24_000,
		rightClipId: 'audio-right', linkedRightClipId: 'right', rightAvLinkId: 'right-link',
		linkedRightVideoEffectIds: ['right-effect'],
	});
	assert.equal(model(audioLed, 'right').adjustmentBrightness, 0.5);
});

async function adjustedProject(): Promise<Project> {
	return author(createFramescaperProjectFinishing(PROFILE, framescaperV20Options() as never), 'video-clip', 'apply', 0.5);
}

function splitProject(project: Project): Project {
	const command = snapshotFramescaperProjectCommandFinishing({
		type: 'clip/split', clipId: 'video-clip', atFrame: 24_000, rightClipId: 'right', rightVideoEffectIds: ['right-effect'],
	});
	return apply(PROFILE, project, command, { now: '2026-10-08T12:00:00.000Z' });
}

function model(project: Project, selectedClipId: string) {
	return modelFor({ surface: 'video-adjustment-layer', project, selectedClipId, playheadSample: 0 });
}

async function author(project: Project, selectedClipId: string, operation: string, brightness?: number): Promise<Project> {
	const current = model(project, selectedClipId);
	const { command } = await prepare({ surface: 'video-adjustment-layer', project, store, request: {
		fence: current.fence, clipId: selectedClipId, adjustmentLayerId: current.adjustmentLayerId,
		operation, brightness,
	} });
	return apply(PROFILE, project, command);
}

function clip(project: Project, id: string): Clip {
	const value = (project.clips as unknown as Clip[]).find((candidate) => candidate.id === id);
	assert.ok(value);
	return value;
}

function effect(project: Project, id: string): Clip['videoEffects'][number] {
	const value = clip(project, id).videoEffects[0];
	assert.ok(value);
	return value;
}
