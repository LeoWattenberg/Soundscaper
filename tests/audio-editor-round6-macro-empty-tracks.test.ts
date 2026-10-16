/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService, type MacroCommandProject } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createClipSelectionNavigationService, type ClipSelectionNavigationProject } from '../src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';

for (const params of [
	{ track: 0, trackCount: 2, mode: 'remove' },
	{ track: 0, trackCount: 0, mode: 'set' },
	{ track: 5, trackCount: 1, mode: 'set' },
]) test(`an explicitly empty macro track selection retires native focus: ${JSON.stringify(params)}`, () => {
	const fixture = createFixture();
	fixture.service.runMacroCommand(createMacroCommandStep('SelectTracks', { params }));
	assert.deepEqual(fixture.project().selection?.trackIds, []);
	assert.equal(fixture.state.selectedTrackId, null, 'an empty track command follows native No tracks, rather than retaining an edit fallback');
	assert.equal(fixture.nativeClears(), 1);
	assert.equal(fixture.project().selection?.startFrame, 10);
	assert.equal(fixture.project().selection?.endFrame, 20);
	assert.deepEqual(fixture.project().selection?.frequencyRange, { minimumFrequency: 100, maximumFrequency: 4_000 });
});

test('a nonempty track command preserves ordinary focus and exact range publication', () => {
	const fixture = createFixture();
	fixture.service.runMacroCommand(createMacroCommandStep('SelectTracks', { params: { track: 0, trackCount: 1, mode: 'remove' } }));
	assert.deepEqual(fixture.project().selection?.trackIds, ['b']);
	assert.equal(fixture.state.selectedTrackId, 'a');
	assert.equal(fixture.nativeClears(), 0);
});

test('an unrelated time command with an unscoped selection does not clear ordinary focus', () => {
	const fixture = createFixture([]);
	fixture.service.runMacroCommand(createMacroCommandStep('SelectTime', { params: { start: .01, end: .02 } }));
	assert.equal(fixture.state.selectedTrackId, 'a');
	assert.equal(fixture.nativeClears(), 0);
});

function createFixture(trackIds: readonly string[] = ['a', 'b']) {
	let project: ClipSelectionNavigationProject & MacroCommandProject = {
		schemaVersion: 10, sampleRate: 1_000, clips: [],
		tracks: [{ id: 'a', type: 'audio', clipIds: [] }, { id: 'b', type: 'audio', clipIds: [] }],
		selection: { startFrame: 10, endFrame: 20, trackIds, clipIds: [],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 4_000 } },
	};
	const state = { selectedTrackId: 'a' as string | null, selectedClipId: null, selectedAnnotationId: null };
	const navigation = createClipSelectionNavigationService({ state, getProject: () => project,
		updateSelection: command => { project = { ...project, selection: command }; return project; },
		seek: () => undefined });
	let nativeClears = 0;
	const service = createMacroCommandService({ getProject: () => project, projectSampleRate: () => 1_000,
		timelineDurationFrames: () => 100,
		setExactSelection: (startFrame, endFrame, details = {}) => {
			project = { ...project, selection: { ...project.selection, startFrame, endFrame,
				trackIds: details.trackIds as readonly string[], clipIds: [] } };
			return project;
		},
		getActions: () => ({ timeline: { selectNoTracks: () => { nativeClears++; return navigation.selectNoTracks(); } } }),
	});
	return { service, state, project: () => project, nativeClears: () => nativeClears };
}
