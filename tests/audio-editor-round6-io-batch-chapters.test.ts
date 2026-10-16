/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createDeliveryBatch } from '../src/common/editor/delivery-batch.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { assertEmbeddedChapterRequest } from '../src/common/editor/export-embedded-chapter-encoding.ts';

function fixture() {
	let project = createCurrentAudioEditorProject({ id: 'chapter-batch', sampleRate: 48_000 });
	project = applyEditorCommand(project, { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'audio', storageKey: 'audio', name: 'Interview.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 } },
		{ type: 'track/add', track: { id: 'track', name: 'Interview' } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', kind: 'audio', title: 'Interview', sourceId: 'audio', timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 } },
	] });
	const preset = validateDeliveryPreset({ schemaVersion: 1, id: 'chapters', label: 'Podcast chapters',
		kind: 'audio', format: 'mp3', settings: { embedLabelChapters: true } });
	return { project, preset };
}

test('a chapter preset can deliver stems without its inapplicable single-file option', () => {
	const { project, preset } = fixture();
	const original = structuredClone(preset);
	const batch = createDeliveryBatch(project, { batchId: 'stems', presets: [preset], targets: [{ kind: 'project' }], mode: 'stems' });
	const settings = batch.members[0]!.settings;
	assert.equal(settings.mode, 'stems');
	assert.doesNotThrow(() => assertEmbeddedChapterRequest('mp3', settings));
	assert.notEqual(settings.embedLabelChapters, true);
	assert.deepEqual(preset, original);
});

test('the same chapter preset preserves the explicit option for an ordinary mixed batch', () => {
	const { project, preset } = fixture();
	const batch = createDeliveryBatch(project, { batchId: 'mix', presets: [preset], targets: [{ kind: 'project' }] });
	const settings = batch.members[0]!.settings;
	assert.equal(settings.mode, 'mix');
	assert.equal(settings.embedLabelChapters, true);
	assert.doesNotThrow(() => assertEmbeddedChapterRequest('mp3', settings));
});
