/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperV27FinishingCommand,
	createFramescaperV27FinishingDialogModel,
	exportFramescaperV27CaptionSidecar,
	importFramescaperV27CaptionSidecar,
} from '../src/common/editor/ui/framescaper-v27-finishing-dialog-model.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROJECT = createFramescaperProjectV27(
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
	framescaperV20Options(),
);

test('V27 finishing dialog documents compile to owned atomic commands', () => {
	const color = createFramescaperV27FinishingDialogModel({
		surface: 'color-management', project: PROJECT,
	});
	const colorDraft = JSON.parse(color.documentText) as Record<string, Array<Record<string, unknown>>>;
	colorDraft.videoColorContexts![0]!.outputSpace = 'srgb';
	assert.equal(commandTypes(createFramescaperV27FinishingCommand(
		'color-management', PROJECT, JSON.stringify(colorDraft),
	))[0], 'video-color-context/set');

	const grading = createFramescaperV27FinishingDialogModel({ surface: 'grading-presets', project: PROJECT });
	const gradingDraft = JSON.parse(grading.documentText) as Record<string, unknown[]>;
	gradingDraft.videoFinishingPresets!.push({
		schemaVersion: 1, kind: 'video-finishing-preset', id: 'look-1', name: 'Look',
		template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null },
	});
	assert.deepEqual(commandTypes(createFramescaperV27FinishingCommand(
		'grading-presets', PROJECT, JSON.stringify(gradingDraft),
	)), ['video-finishing-preset/set']);

	const automation = createFramescaperV27FinishingDialogModel({ surface: 'automation', project: PROJECT });
	const automationDraft = JSON.parse(automation.documentText) as unknown[];
	automationDraft.push({ id: 'master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'p1', position: 0, value: 1 }], segments: [] });
	assert.deepEqual(commandTypes(createFramescaperV27FinishingCommand(
		'automation', PROJECT, JSON.stringify(automationDraft),
	)), ['automation-lane/set']);
	assert.throws(() => createFramescaperV27FinishingCommand(
		'automation', PROJECT, automation.documentText,
	), /no.*change/iu);
});

test('caption workflow imports and exports only strict sidecars with sequence binding supplied by V27', () => {
	const imported = importFramescaperV27CaptionSidecar({
		project: PROJECT,
		format: 'srt',
		text: '1\n00:00:00,000 --> 00:00:01,000\nHello V27\n',
		trackId: 'captions-en', sequenceId: 'main-sequence', trackName: 'English', language: 'en',
	});
	assert.equal(imported.command.type, 'video-caption-track/set');
	assert.equal(imported.result.track.sequenceId, 'main-sequence');
	const exported = exportFramescaperV27CaptionSidecar({
		project: { ...PROJECT, videoCaptionTracks: [imported.result.track] },
		trackId: 'captions-en', format: 'webvtt',
	});
	assert.match(exported.text, /^WEBVTT/u);
	assert.equal(exported.format, 'webvtt');
	assert.throws(() => importFramescaperV27CaptionSidecar({
		project: PROJECT, format: 'srt', text: '<script>alert(1)</script>',
		trackId: 'bad', sequenceId: 'main-sequence', trackName: 'Bad', language: 'en',
	}), /timing|cue|SRT/iu);
});

function commandTypes(command: unknown): string[] {
	const value = command as { type: string; commands?: Array<{ type: string }> };
	return value.type === 'batch' ? value.commands!.map(({ type }) => type) : [value.type];
}
