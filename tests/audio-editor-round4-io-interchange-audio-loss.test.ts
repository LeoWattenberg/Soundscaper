/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';

function fixture(gain = 0.5) {
	return applyEditorCommand(createCurrentAudioEditorProject({ id: 'mix', sampleRate: 48_000 }), {
		type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'voice', storageKey: 'voice', name: 'Voice.wav', sampleRate: 48_000,
				frameCount: 48_000, channelCount: 1 } },
			{ type: 'track/add', track: { id: 'dialogue', name: 'Dialogue' } },
			{ type: 'clip/add', trackId: 'dialogue', clip: { id: 'take', sourceId: 'voice', gain,
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 } },
		],
	});
}

for (const [profile, action] of [['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
	test(`${profile} warns about omitted clip gain and preserves the original editable programme`, async () => {
		const project = fixture();
		const original = structuredClone(project);
		const state: { deliveryReport?: unknown } = {};
		const result = await action({ getProject: () => project, state });
		assert.ok(result);
		const warning = result.report.items.find(item => item.code === `${profile}.audio-processing-omitted`);
		assert.ok(warning, 'a cut-only edit file must disclose the authored gain it loses');
		assert.equal(warning.severity, 'warning');
		assert.equal(warning.disposition, 'omitted');
		assert.deepEqual(warning.scope, { kind: 'clip', id: 'take' });
		assert.deepEqual(warning.data, { gain: 0.5 });
		assert.equal(state.deliveryReport, result.report);
		assert.deepEqual(project, original);
		assert.match(result.text, /(?:Clip\.1|asset-clip)/u);
	});

	test(`${profile} inventories active authored processing and excludes tracks already silenced`, async () => {
		const project = applyEditorCommand(fixture(1), { type: 'batch', commands: [
			{ type: 'clip/update', clipId: 'take', changes: { inverted: true, fadeInFrames: 1200 } },
			{ type: 'track/update', trackId: 'dialogue', changes: { gain: 0.75, pan: 0.25 } },
			{ type: 'effect/add', scope: 'track', trackId: 'dialogue', effect: { id: 'echo', type: 'delay',
				params: { time: 0.25, feedback: 0.4, mix: 0.3 } } },
		] });
		const result = await action({ getProject: () => project, state: {} });
		assert.ok(result);
		const omissions = result.report.items.filter(item => item.code.endsWith('audio-processing-omitted'));
		assert.deepEqual(omissions.map(item => ({ scope: item.scope, data: item.data })), [
			{ scope: { kind: 'clip', id: 'take' }, data: { fadeInFrames: 1200, inverted: true } },
			{ scope: { kind: 'track', id: 'dialogue' }, data: { gain: 0.75, pan: 0.25, effects: ['delay'] } },
		]);
		const muted = applyEditorCommand(project, { type: 'track/update', trackId: 'dialogue', changes: { mute: true } });
		const mutedResult = await action({ getProject: () => muted, state: {} });
		assert.ok(mutedResult);
		assert.equal(mutedResult.report.items.filter(item => item.code.endsWith('audio-processing-omitted')).length, 0);
		assert.ok(mutedResult.report.items.some(item => item.code === `${profile}.track-silent-omitted`));
	});

	test(`${profile} keeps a neutral clip's existing report free of processing warnings`, async () => {
		const result = await action({ getProject: () => fixture(1), state: {} });
		assert.ok(result);
		assert.equal(result.report.items.filter(item => item.code.endsWith('audio-processing-omitted')).length, 0);
	});
}
