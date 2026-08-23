/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { defaultVideoSourceColorInterpretationV1 } from '../src/common/editor/video-color-management-v27.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	loadFramescaperProjectV27,
	reimportFramescaperProjectV27,
	validateFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import { createFramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import {
	FRAMESCAPER_V27_COMPATIBILITY_CONTRACT,
	framescaperDesktopProjectTransportV27,
} from '../src/framescaper/desktop-project-transport-v27.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);

test('selected V27 freezes the V18/SQLite20/v18 identity without M5 authority', () => {
	const runtime = editorProjectRuntimeProfileDefinition(PROFILE);
	assert.deepEqual(editorProjectRuntimeProfilePrerequisiteDefinition(runtime.prerequisite), {
		owner: 'framescaper',
		projectSchemaVersion: 27,
		storageProfile: editorProjectRuntimeProfilePrerequisiteDefinition(runtime.prerequisite).storageProfile,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 18,
		desktopProjectSchemaVersion: 27,
		desktopDatabaseUserVersion: 20,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v18'],
	});
	const registrations = editorProjectFeatureCapabilityProfileDefinition(runtime.capabilityProfile).registrations;
	for (const key of [
		'audioAutomation', 'audioEffects', 'audioMixerGraph', 'videoCaptions',
		'videoColorManagement', 'videoDenoise', 'videoGrading', 'videoMotionTracking',
		'videoRetime', 'videoStabilization', 'videoTransitionDissolve', 'videoTransitions',
	]) assert.equal(registrations.find((row) => row.key === key)?.available, true, key);
	for (const key of ['audioMacros', 'audioRecording', 'audioTrackFreeze', 'ofxEffects']) {
		assert.equal(registrations.find((row) => row.key === key)?.available, false, key);
	}
});

test('selected V27 transport binds clipboard V11 and exact render plan V13', () => {
	assert.deepEqual(FRAMESCAPER_V27_COMPATIBILITY_CONTRACT, {
		projectSchemaVersion: 27,
		desktopLibrarySchemaVersion: 18,
		desktopDatabaseUserVersion: 20,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v18'],
		clipboardSchemaVersion: 11,
		renderPlanVersion: 13,
		activation: 'selected',
	});
	const project = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	const transport = framescaperDesktopProjectTransportV27(PROFILE);
	assert.deepEqual(transport.decode(transport.encode(project)), project);
	assert.notStrictEqual(transport.encode(project), project);
});

test('V27 persists color, presentations, processors, analyses, captions, automation, and mixer state', () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			colorContexts: [colorContext()],
			sourceColorInterpretations: [defaultVideoSourceColorInterpretationV1('video', 'video-source')],
			visualPresentations: [presentation()],
			processorStacks: [processorStack()],
			motionAnalyses: [motionAnalysis()],
			finishingPresets: [finishingPreset()],
			captionTracks: [captionTrack()],
			automationLanes: [masterGainLane()],
		},
	});
	assert.equal(validateFramescaperProjectV27(PROFILE, project), true);
	assert.equal(project.schemaVersion, 27);
	assert.equal(project.videoColorContexts.length, 1);
	assert.equal(project.videoVisualPresentations[0]?.processorStackId, 'stack-1');
	assert.equal(project.videoMotionAnalyses[0]?.sha256, SHA_B);
	assert.equal(project.videoCaptionTracks[0]?.sequenceId, 'main-sequence');
	assert.equal(project.automationLanes[0]?.address.kind, 'strip');
	assert.equal(project.mixer.outputs[0]?.role, 'main');
	const clone = cloneFramescaperProjectV27(PROFILE, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone.videoCaptionTracks, project.videoCaptionTracks);

	const stale = structuredClone(project) as unknown as Record<string, unknown>;
	((stale.videoMotionAnalyses as Array<Record<string, unknown>>)[0]!).sourceId = 'missing-source';
	assert.throws(() => validateFramescaperProjectV27(PROFILE, stale), /motion.*source|missing-source/iu);
	const dormant = structuredClone(project) as unknown as Record<string, unknown>;
	dormant.nativeVideoSources = [];
	assert.throws(() => validateFramescaperProjectV27(PROFILE, dormant), /nativeVideoSources|unsupported.*V27|native.*state/iu);
});

test('new projects disclose source assumptions while explicit old-project reimport marks legacy media', () => {
	const created = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	assert.deepEqual(created.videoSourceColorInterpretations.map(({ sourceId, provenance }) => ({
		sourceId, provenance,
	})), [{ sourceId: 'video-source', provenance: 'default-video-bt709-limited' }]);

	const v20 = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, framescaperV20Options());
	const imported = reimportFramescaperProjectV27(PROFILE, v20);
	assert.equal(imported.schemaVersion, 27);
	assert.equal(imported.videoSourceColorInterpretations[0]?.provenance, 'legacy-unmanaged-encoded');
	assert.equal((imported.clips as readonly Readonly<Record<string, unknown>>[])
		.find(({ id }) => id === 'video-clip')?.id, 'video-clip');
	assert.throws(() => loadFramescaperProjectV27(PROFILE, v20), /explicit.*reimport|re-import/iu);

	const v24 = createFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	});
	assert.equal(reimportFramescaperProjectV27(PROFILE, v24).schemaVersion, 27);
});

test('dormant V25/V26 remain opaque read-only custody and are never interpreted as V27', () => {
	for (const schemaVersion of [25, 26]) {
		const opaque = { schemaVersion, id: `opaque-${String(schemaVersion)}`, nativeVideoSources: [{ secret: true }] };
		const loaded = loadFramescaperProjectV27(PROFILE, opaque);
		assert.deepEqual(loaded, {
			project: opaque,
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'known-dormant-custody',
		});
		assert.throws(() => reimportFramescaperProjectV27(PROFILE, opaque), /V25|V26|dormant|custody/iu);
	}
});

function colorContext() {
	return {
		schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
		outputSpace: 'rec709', alphaMode: 'straight-authored-premultiplied-working',
		toneMapping: 'none',
	};
}

function presentation() {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: 'stack-1', maskMatteIds: [],
	};
}

function processorStack() {
	return {
		schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors: [{
			schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
			maximumFeatures: 128, quality: 0.05, minimumDistance: 3,
			windowRadius: 3, pyramidLevels: 3,
		}],
	};
}

function motionAnalysis() {
	return {
		schemaVersion: 1, id: 'analysis-1', sourceId: 'video-source',
		processorStackId: 'stack-1', inputSha256: SHA_A, settingsSha256: SHA_B,
		storageKey: `motion-sha256:${SHA_B}`, sha256: SHA_B, byteLength: 4_096,
		startFrame: 0, endFrame: 10,
	};
}

function finishingPreset() {
	return {
		schemaVersion: 1, kind: 'video-finishing-preset', id: 'preset-1', name: 'Look',
		template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null },
	};
}

function captionTrack() {
	return {
		schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence', name: 'English',
		language: 'en', styles: [], regions: [], speakers: [], cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000,
			text: 'Caption', styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
}

function masterGainLane() {
	return {
		id: 'automation-master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [{ id: 'point-1', position: 0, value: 1 }],
		segments: [],
	};
}
