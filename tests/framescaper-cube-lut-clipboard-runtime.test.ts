/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectForEditClipboardConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { createClipboardDescriptorV7, preparePasteCommandV7, pasteClipboardV7 } from '../src/common/editor/commands/clipboard-runtime-v7.ts';
import { createEditorCommandMutationTransactionForFrameV2 } from '../src/common/editor/commands/mutation-transaction.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function project(withTakes = false) {
	const options = framescaperV20Options();
	return createFramescaperProject(PROFILE, { ...options, clips: (options.clips as readonly Record<string, unknown>[])
		.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [
			{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 0.5 } },
			{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: REF } },
		] } : clip), ...(withTakes ? { takeGroups: [{
			id: 'group-a', sequenceId: 'main-sequence', trackId: 'audio-track', startSample: 0, endSample: 24_000,
			laneOrder: ['lane-a'], lanes: [{ id: 'lane-a' }], takes: [{ id: 'take-a', laneId: 'lane-a', sourceId: 'audio-source',
				startSample: 0, endSample: 24_000, sourceStartSample: 0 }], compRegions: [{ id: 'region-a', takeId: 'take-a', startSample: 0, endSample: 24_000 }],
		}] } : {}) });
}
const range = { startFrame: 0, endFrame: 24_000, trackIds: ['video-track'] };

test('current Frame clipboard capture retains exact authored resource order and trimmed discrete context', () => {
	const value = project(), current = framescaperProjectForEditClipboardConsumers(PROFILE, value);
	const clipboard = createClipboardDescriptorV7(current, range);
	assert.equal(clipboard.schemaVersion, 7);
	const clip = clipboard.tracks[0]!.clips[0]!;
	assert.equal(clip.durationFrames, 24_000);
	assert.deepEqual((clip.videoEffects as readonly { id: string }[]).map(effect => effect.id), ['tone', 'cube']);
	assert.deepEqual((clip.videoEffects as readonly { params: unknown }[])[1]!.params, { lut: REF });
	assert.throws(() => createClipboardDescriptor(current, range), /cube|unsupported|resource/iu);
	assert.throws(() => createClipboardDescriptorV7({ ...current }, range), /current Frame|admitted/iu);
});

test('current descriptor7 keeps take and annotation capability admission instead of silently dropping their graph', () => {
	const current = framescaperProjectForEditClipboardConsumers(PROFILE, project(true));
	const clipboard = createClipboardDescriptorV7(current, { ...range, trackIds: ['video-track', 'audio-track'] });
	assert.equal(clipboard.takeGroups!.length, 1);
	let id = 0;
	const command = preparePasteCommandV7(clipboard, { project: current, atFrame: 48_000 }, prefix => `${prefix}-${String(++id)}`);
	assert.equal(Object.keys(command.takeGroupIds!).length, 1);
	const draft = structuredClone(current);
	createEditorCommandMutationTransactionForFrameV2(project(true), current).mutate(draft, command);
	const groups = draft.takeGroups as readonly { id: string; startSample: number; takes: readonly { id: string; sourceId: string }[] }[];
	assert.equal(groups.length, 2);
	assert.equal(groups[1]!.id, command.takeGroupIds!['group-a']);
	assert.equal(groups[1]!.startSample, 48_000);
	assert.equal(groups[1]!.takes[0]!.sourceId, 'audio-source');
});

test('current paste preparation admits descriptor7, allocates all effect IDs once and detaches references', () => {
	const current = framescaperProjectForEditClipboardConsumers(PROFILE, project());
	const clipboard = createClipboardDescriptorV7(current, range);
	let id = 0;
	const command = preparePasteCommandV7(clipboard, { project: current, atFrame: 48_000 }, prefix => `${prefix}-${String(++id)}`);
	const key = clipboard.tracks[0]!.clips[0]!.key as string;
	assert.equal(command.clipboard.schemaVersion, 7);
	assert.equal(command.videoEffectIds![key]!.length, 2);
	assert.equal(new Set(command.videoEffectIds![key]).size, 2);
	assert.deepEqual(command.clipboard.tracks[0]!.clips[0]!.videoEffects, clipboard.tracks[0]!.clips[0]!.videoEffects);
	assert.notEqual(command.clipboard, clipboard);
	assert.throws(() => preparePasteCommand(clipboard), /Unsupported clipboard schema/u);
});

test('current paste executes admitted resource leaves with new independent IDs through the scoped Frame projection', () => {
	const value = project(), original = structuredClone(value);
	const current = framescaperProjectForEditClipboardConsumers(PROFILE, value);
	const clipboard = createClipboardDescriptorV7(current, range);
	let id = 0;
	const command = preparePasteCommandV7(clipboard, { project: current, atFrame: 48_000 }, prefix => `${prefix}-${String(++id)}`);
	pasteClipboardV7(current, command);
	const clips = current.clips as readonly { id: string; timelineStartFrame: number; videoEffects?: readonly { id: string; params: unknown }[] }[];
	const added = clips.find(clip => clip.timelineStartFrame === 48_000)!;
	assert.ok(added);
	assert.deepEqual(added.videoEffects!.map(effect => effect.id), command.videoEffectIds![clipboard.tracks[0]!.clips[0]!.key as string]);
	assert.deepEqual(added.videoEffects![1]!.params, { lut: REF });
	assert.deepEqual(value, original);
});
