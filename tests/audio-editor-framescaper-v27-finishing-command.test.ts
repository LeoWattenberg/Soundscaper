/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyFramescaperOwnedFinishingCommandV27,
	snapshotFramescaperOwnedFinishingCommandV27,
} from '../src/framescaper/editor-project-v27-finishing-command.ts';
import {
	applyFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-commands.ts';
import {
	createFramescaperProjectHistoryV27,
	executeFramescaperProjectCommandV27,
	redoFramescaperProjectCommandV27,
	undoFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-history.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV27,
} from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	createFramescaperProjectV27,
	validateFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import {
	normalizeFramescaperProjectFinishingStateV27,
} from '../src/framescaper/editor-project-v27-validation.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);

test('V27 finishing commands replace every owned state family through stale-safe snapshots', () => {
	const project = projectFixture();
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const commands = finishingCommands(project);
	for (const command of commands) {
		const snapshot = snapshotFramescaperOwnedFinishingCommandV27(command);
		assert.notStrictEqual(snapshot, command);
		applyFramescaperOwnedFinishingCommandV27(draft, snapshot);
	}
	normalizeFramescaperProjectFinishingStateV27(draft);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, draft);
	assert.equal(validateFramescaperProjectV27(PROFILE, draft), true);
	assert.equal((draft.videoColorContexts as Array<{ outputSpace: string }>)[0]?.outputSpace, 'srgb');
	assert.equal((draft.videoSourceColorInterpretations as Array<{ provenance: string }>)[0]?.provenance, 'user-override');
	assert.equal((draft.videoVisualPresentations as Array<{ opacity: number }>)[0]?.opacity, 0.5);
	assert.equal((draft.videoProcessorStacks as Array<{ processors: Array<{ enabled: boolean }> }>)[0]
		?.processors[0]?.enabled, false);
	assert.equal((draft.videoCaptionTracks as Array<{ name: string }>)[0]?.name, 'Deutsch');
	assert.equal((draft.automationLanes as Array<{ points: Array<{ value: number }> }>)[0]
		?.points[0]?.value, 0.5);
	assert.equal(((draft.mixer as { outputs: Array<{ name: string }> }).outputs[0]?.name), 'Programme');
});

test('V27 finishing commands reject stale state, identity changes, extra keys, and no-ops', () => {
	const project = projectFixture();
	const command = finishingCommands(project)[2]!;
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyFramescaperOwnedFinishingCommandV27(draft, command);
	assert.throws(() => applyFramescaperOwnedFinishingCommandV27(draft, command), /stale/iu);
	assert.throws(() => snapshotFramescaperOwnedFinishingCommandV27({
		...command, presentationId: 'changed-id',
	}), /identity/iu);
	assert.throws(() => snapshotFramescaperOwnedFinishingCommandV27({
		...command, surprise: true,
	}), /exact|unsupported/iu);
	assert.throws(() => snapshotFramescaperOwnedFinishingCommandV27({
		...command, presentation: command.expectedPresentation,
	}), /mutate|no-op/iu);
});

test('V27 applies owned finishing commands through the selected project command authority', () => {
	const project = projectFixture();
	const applied = applyFramescaperProjectCommandV27(
		PROFILE, project, finishingCommands(project)[2], { now: '2026-08-23T10:00:00.000Z' },
	);
	assert.equal(applied.revision, Number(project.revision) + 1);
	assert.equal(applied.updatedAt, '2026-08-23T10:00:00.000Z');
	assert.equal(applied.videoVisualPresentations[0]?.opacity, 0.5);
	assert.equal(project.videoVisualPresentations[0]?.opacity, 1);
});

test('V27 finishing batches are atomic and advance project bookkeeping once', () => {
	const project = projectFixture();
	const commands = finishingCommands(project);
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'batch', commands: [commands[0], commands[6]],
	}, { now: '2026-08-23T10:05:00.000Z' });
	assert.equal(applied.revision, Number(project.revision) + 1);
	assert.equal(applied.videoColorContexts[0]?.outputSpace, 'srgb');
	assert.equal(applied.videoCaptionTracks[0]?.language, 'de');
	assert.throws(() => applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'batch', commands: [commands[0], commands[0]],
	}), /stale/iu);
	assert.equal(project.videoColorContexts[0]?.outputSpace, 'rec709');
});

test('owned V27 batches validate cross-collection changes only after the final draft', () => {
	for (const commands of [dependentRemovalCommands(projectFixture()),
		[...dependentRemovalCommands(projectFixture())].reverse()]) {
		const project = projectFixture();
		const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
			type: 'batch', commands,
		});
		assert.equal(applied.videoVisualPresentations[0]?.processorStackId, null);
		assert.deepEqual(applied.videoProcessorStacks, []);
		assert.deepEqual(applied.videoMotionAnalyses, []);
		assert.equal(applied.revision, Number(project.revision) + 1);
	}
});

test('an invalid owned V27 batch leaves the original exact state untouched', () => {
	const project = projectFixture();
	const original = structuredClone(project);
	const stack = project.videoProcessorStacks[0]!;
	assert.throws(() => applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'batch', commands: [{
			type: 'video-processor-stack/set', processorStackId: stack.id,
			expectedProcessorStack: stack, processorStack: null,
		}],
	}), /processor stack|motion analysis|visual presentation|missing/iu);
	assert.deepEqual(project, original);
});

test('a cross-collection owned batch remains one-step undoable and redoable', () => {
	const project = projectFixture();
	const executed = executeFramescaperProjectCommandV27(
		PROFILE,
		createFramescaperProjectHistoryV27(PROFILE, project),
		{ type: 'batch', commands: dependentRemovalCommands(project) },
	);
	assert.deepEqual(executed.present.videoMotionAnalyses, []);
	const undone = undoFramescaperProjectCommandV27(PROFILE, executed);
	assert.deepEqual(undone.present.videoMotionAnalyses, project.videoMotionAnalyses);
	assert.deepEqual(undone.present.videoProcessorStacks, project.videoProcessorStacks);
	const redone = redoFramescaperProjectCommandV27(PROFILE, undone);
	assert.deepEqual(redone.present.videoMotionAnalyses, []);
	assert.deepEqual(redone.present.videoProcessorStacks, []);
});

test('V27 history restores owned finishing commands with one-step undo and redo', () => {
	const project = projectFixture();
	const command = finishingCommands(project)[7];
	const history = executeFramescaperProjectCommandV27(
		PROFILE, createFramescaperProjectHistoryV27(PROFILE, project), command,
		{ now: '2026-08-23T10:10:00.000Z' },
	);
	assert.equal(history.present.automationLanes[0]?.points[0]?.value, 0.5);
	const undone = undoFramescaperProjectCommandV27(
		PROFILE, history, { now: '2026-08-23T10:11:00.000Z' },
	);
	assert.equal(undone.present.automationLanes[0]?.points[0]?.value, 1);
	const redone = redoFramescaperProjectCommandV27(
		PROFILE, undone, { now: '2026-08-23T10:12:00.000Z' },
	);
	assert.equal(redone.present.automationLanes[0]?.points[0]?.value, 0.5);
});

function projectFixture() {
	return createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			visualPresentations: [presentation()], processorStacks: [processorStack()],
			motionAnalyses: [motionAnalysis()], finishingPresets: [finishingPreset()],
			captionTracks: [captionTrack()], automationLanes: [masterGainLane()],
		},
	});
}

function finishingCommands(project: ReturnType<typeof projectFixture>) {
	const context = project.videoColorContexts[0]!;
	const interpretation = project.videoSourceColorInterpretations[0]!;
	const presentationValue = project.videoVisualPresentations[0]!;
	const stack = project.videoProcessorStacks[0]!;
	const analysis = project.videoMotionAnalyses[0]!;
	const preset = project.videoFinishingPresets[0]!;
	const captions = project.videoCaptionTracks[0]!;
	const lane = project.automationLanes[0]!;
	return [
		{ type: 'video-color-context/set', sequenceId: context.sequenceId,
			expectedContext: context, context: { ...context, outputSpace: 'srgb' } },
		{ type: 'video-source-color-interpretation/set', sourceId: interpretation.sourceId,
			expectedInterpretation: interpretation,
			interpretation: { ...interpretation, range: 'full', provenance: 'user-override' } },
		{ type: 'video-visual-presentation/set', presentationId: presentationValue.id,
			expectedPresentation: presentationValue, presentation: { ...presentationValue, opacity: 0.5 } },
		{ type: 'video-processor-stack/set', processorStackId: stack.id,
			expectedProcessorStack: stack, processorStack: { ...stack,
				processors: [{ ...stack.processors[0]!, enabled: false }] } },
		{ type: 'video-motion-analysis/set', motionAnalysisId: analysis.id,
			expectedMotionAnalysis: analysis, motionAnalysis: { ...analysis, byteLength: 8_192 } },
		{ type: 'video-finishing-preset/set', finishingPresetId: preset.id,
			expectedFinishingPreset: preset, finishingPreset: { ...preset, name: 'Cool look' } },
		{ type: 'video-caption-track/set', captionTrackId: captions.id,
			expectedCaptionTrack: captions, captionTrack: { ...captions, name: 'Deutsch', language: 'de' } },
		{ type: 'automation-lane/set', laneId: lane.id,
			expected: lane, lane: { ...lane,
				points: [{ ...lane.points[0]!, value: 0.5 }] } },
		{ type: 'mixer-graph/set', expected: project.mixer,
			mixer: { ...project.mixer, outputs: [{ ...project.mixer.outputs[0]!, name: 'Programme' }] } },
	] as const;
}

function dependentRemovalCommands(project: ReturnType<typeof projectFixture>) {
	const presentationValue = project.videoVisualPresentations[0]!;
	const stack = project.videoProcessorStacks[0]!;
	const analysis = project.videoMotionAnalyses[0]!;
	return [{
		type: 'video-processor-stack/set' as const,
		processorStackId: stack.id,
		expectedProcessorStack: stack,
		processorStack: null,
	}, {
		type: 'video-motion-analysis/set' as const,
		motionAnalysisId: analysis.id,
		expectedMotionAnalysis: analysis,
		motionAnalysis: null,
	}, {
		type: 'video-visual-presentation/set' as const,
		presentationId: presentationValue.id,
		expectedPresentation: presentationValue,
		presentation: { ...presentationValue, processorStackId: null },
	}] as const;
}

function presentation() {
	return { schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: 'stack-1', maskMatteIds: [] };
}

function processorStack() {
	return { schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors: [{
		schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
		maximumFeatures: 128, quality: 0.05, minimumDistance: 3,
		windowRadius: 3, pyramidLevels: 3,
	}] };
}

function motionAnalysis() {
	return { schemaVersion: 1, id: 'analysis-1', sourceId: 'video-source',
		processorStackId: 'stack-1', inputSha256: SHA_A, settingsSha256: SHA_B,
		storageKey: `motion-sha256:${SHA_B}`, sha256: SHA_B, byteLength: 4_096,
		startFrame: 0, endFrame: 10 };
}

function finishingPreset() {
	return { schemaVersion: 1, kind: 'video-finishing-preset', id: 'preset-1', name: 'Look',
		template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null } };
}

function captionTrack() {
	return { schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence', name: 'English',
		language: 'en', styles: [], regions: [], speakers: [], cues: [{ schemaVersion: 1,
			id: 'cue-1', startFrame: 0, endFrame: 48_000, text: 'Caption', styleId: null,
			regionId: null, speakerId: null, words: [] }] };
}

function masterGainLane() {
	return { id: 'automation-master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'point-1', position: 0, value: 1 }],
		segments: [] };
}
