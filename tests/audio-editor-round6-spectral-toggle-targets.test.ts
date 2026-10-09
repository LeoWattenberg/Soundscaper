/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacitySpectralActionRuntime } from '../src/common/editor/controller/effects/internal/audacity-spectral-action-runtime.ts';
import { createEffectSelectionService, type EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { resolveEditingSelection } from '../src/common/editor/commands/editing-selection-authority.ts';

interface Selection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly frequencyRange: Readonly<{ minimumFrequency: number; maximumFrequency: number }> | null;
}

test('toggling only the spectral band retains its selected recording targets', () => {
	const original: Selection = {
		startFrame: 0, endFrame: 96_000, trackIds: ['audio'], clipIds: ['selected-recording'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
	};
	let selection = original;
	const actions = createAudacitySpectralActionRuntime({
		getProject: () => ({ id: 'project', selection }),
		setSelection: (startFrame, endFrame, details) => {
			// The public selection setter clears omitted clip targets when details
			// are supplied. A frequency-only action must explicitly retain them.
			selection = {
				startFrame, endFrame,
				trackIds: details.trackIds as readonly string[],
				clipIds: (details.clipIds ?? []) as readonly string[],
				frequencyRange: details.frequencyRange as Selection['frequencyRange'],
			};
			return selection;
		},
		spectralActions: { boxSelect: () => null },
		openSurface: () => null,
		getUiFlags: () => ({}),
		setUiFlag: () => false,
	});

	actions.toggleSpectralSelection();
	assert.deepEqual(selection, { ...original, frequencyRange: null });
	actions.toggleSpectralSelection();
	assert.deepEqual(selection, original);
});

test('a clip-authored spectral band retains its exact effect targets through the real selection resolver', () => {
	const fixture = spectralFixture();
	assert.deepEqual(fixture.service.audacityEffectTargets().map(target => target.clipIds), [['selected-recording']]);
	assert.equal(fixture.service.audacityEffectTarget()?.clipId, 'selected-recording');
});

test('ordinary time selections keep their precedence over stale clip targets', () => {
	const fixture = spectralFixture(null);
	assert.deepEqual(fixture.service.audacityEffectTargets().map(target => target.clipIds), [undefined]);
	assert.equal(fixture.service.audacityEffectTarget()?.clipId, undefined);
});

function spectralFixture(frequencyRange: Selection['frequencyRange'] = { minimumFrequency: 100, maximumFrequency: 1000 }) {
	const project: EffectSelectionProject = {
		id: 'project', schemaVersion: 1, sampleRate: 48_000,
		tracks: [{ id: 'audio', type: 'audio', name: 'Recording', clipIds: ['selected-recording', 'neighbor'] }],
		clips: ['selected-recording', 'neighbor'].map(id => ({ id, kind: 'audio' as const, sourceId: id,
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 96_000, durationFrames: 96_000 })),
		selection: { startFrame: 0, endFrame: 96_000, trackIds: ['audio'], clipIds: ['selected-recording'], frequencyRange },
	};
	const service = createEffectSelectionService({
		getProject: () => project, activeSelection: () => project.selection ?? null,
		state: { selectedTrackId: 'audio', selectedClipId: null, audacityEffectType: 'audacity-amplify' },
		copy: { audioTrackRequired: 'Select audio', maximumFrequency: 'Maximum', minimumFrequency: 'Minimum',
			parameterRangeError: 'Invalid range', spectralEffectLengthChanging: 'Invalid band',
			timeSelectionRequired: 'Select time', v2Required: 'Project required' },
		resolveEditingSelection, audacitySelectionChannelCount: () => 1,
		audioTrackChannelCount: () => 1, selectedTracksTimeRange: () => null,
		projectSampleRate: () => 48_000, editingBlocked: () => false,
		setSelection: () => assert.fail('Only target resolution is requested'),
	});
	return { service };
}
