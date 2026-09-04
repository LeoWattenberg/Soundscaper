/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createUnifiedExactLinearPremultipliedFrameV13,
} from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
	UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from
	'../src/framescaper/editor-native-render-plan-authority.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
	FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanFinishing,
} from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanNativeMedia,
} from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import {
	createFramescaperPlaybackProjectServiceRetime,
} from '../src/framescaper/editor-project-playback-retime.ts';
import { createFramescaperPlaybackProjectService } from '../src/framescaper/editor-project-playback.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { applyVideoPresentationLinear } from '../src/framescaper/video-export-visual-linear-finishing.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperVideoExportStrategy } from '../src/framescaper/video-export-strategy.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const DETERMINISTIC_ORDER_MODULES = Object.freeze([
	'../src/framescaper/editor-project-unified-render-plan-finishing.ts',
	'../src/framescaper/editor-project-unified-render-plan-native-media.ts',
	'../src/framescaper/editor-project-sequence-claim-cleanup-repository.ts',
	'../src/framescaper/video-export-strategy-finishing.ts',
	'../src/framescaper/video-export-visual-execution-finishing.ts',
	'../src/framescaper/video-export-visual-linear-finishing.ts',
	'../src/framescaper/editor-project-playback-retime.ts',
	'../src/common/editor/assistance/disfluency.ts',
	'../src/common/editor/assistance/highlight-ranking-v1.ts',
	'../src/common/editor/assistance/owned-audio-cut-transform-results-v1.ts',
	'../src/common/editor/assistance/owned-audio-workflow-transforms-v1.ts',
	'../src/common/editor/assistance/semantic-search-index-v1.ts',
	'../src/common/editor/assistance/visual-indexing-v1.ts',
	'../src/common/editor/assistance/workflow-fence-v1.ts',
	'../src/common/editor/audacity-action-runtime.js',
	'../src/common/editor/aup4-export.js',
	'../src/common/editor/commands/clip-link-runtime.js',
	'../src/common/editor/commands/clip-transform-runtime.js',
	'../src/common/editor/commands/clipboard-runtime.js',
	'../src/common/editor/commands/range-runtime.js',
	'../src/common/editor/commands/shared-runtime.js',
	'../src/common/editor/commands/track-mixer-label-runtime.js',
	'../src/common/editor/controller/direct-compressed-plan.ts',
	'../src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
	'../src/common/editor/controller/local-assistance-guided-fence.ts',
	'../src/common/editor/controller/local-assistance-selected-media.ts',
	'../src/common/editor/controller/local-assistance-semantic-index-custody.ts',
	'../src/common/editor/controller/take-cycle-open-recovery-authority.ts',
	'../src/common/editor/unified-exact-render-plan-v13.ts',
	'../src/common/editor/video-caption-track-v27.ts',
	'../src/common/editor/edl-project-adapter.ts',
	'../src/common/editor/fcpxml-export.ts',
	'../src/common/editor/engine/clip-schedule-plan.ts',
	'../src/common/editor/otio-export.ts',
	'../src/common/editor/project-hierarchy-reconcile.ts',
	'../src/common/editor/ui/framescaper-multicamera-menu.ts',
	'../src/common/editor/ui/local-model-manager-store.ts',
	'../src/common/editor/ui/timeline/TrackOverlapOverlays.jsx',
	'../src/common/editor/ui/workspace/product-video-visual-preview-effect-ledger.ts',
	'../src/common/editor/video-export.js',
	'../src/common/editor/video-timeline.js',
]);

// The one place a shortcut label is collated for a human reader. The Audacity 4
// shortcut import moved it out of the command inventory and into the
// preferences surface that renders the list.
const LOCALIZED_SHORTCUT_INVENTORY =
	'../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';

test('canonical render and export ordering never delegates to host collation', async () => {
	for (const module of DETERMINISTIC_ORDER_MODULES) {
		const source = await readFile(new URL(module, import.meta.url), 'utf8');
		assert.doesNotMatch(source, /\.localeCompare\s*\(/u, module);
	}
	const shortcutSource = await readFile(
		new URL(LOCALIZED_SHORTCUT_INVENTORY, import.meta.url),
		'utf8',
	);
	const localizedLabelCompare = /left\.label\.localeCompare\(right\.label,\s*normalizedLocale\)/u;
	assert.match(shortcutSource, localizedLabelCompare);
	assert.doesNotMatch(
		shortcutSource.replace(localizedLabelCompare, ''),
		/\.localeCompare\s*\(/u,
		LOCALIZED_SHORTCUT_INVENTORY,
	);
});

test('V13 and V14 finishing plans use code-unit audio-track order', () => {
	const options = twoAudioTrackOptions();
	const finishingProject = createFramescaperProjectFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		structuredClone(options),
	);
	const finishingPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		finishingProject,
		{ ...renderAuthority(finishingProject, 10), visualFreshnessByModelId: new Map() },
	);
	assert.deepEqual(finishingAudioTrackIds(finishingPlan), ['Z-track', 'alpha-track']);

	const nativeProject = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		structuredClone(options),
	);
	const nativePlan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		nativeProject,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(nativeProject),
	);
	assert.deepEqual(finishingAudioTrackIds(nativePlan), ['Z-track', 'alpha-track']);
});

test('retime playback and finishing export source closure use code-unit order', () => {
	const retimeOptions = twoVideoSourceOptions();
	retimeOptions.id = 'retime-order';
	retimeOptions.multicameraGroups = [{
		id: 'camera-group', projectId: 'retime-order', sequenceId: 'main-sequence',
		outputClipId: 'video-clip', activeMemberId: 'alpha-member',
		members: [
			{
				id: 'alpha-member', groupId: 'camera-group',
				sourceId: 'alpha-source', syncOffsetSamples: 0,
			},
			{
				id: 'Z-member', groupId: 'camera-group',
				sourceId: 'Z-source', syncOffsetSamples: 0,
			},
		],
	}];
	const retimeProject = createFramescaperProjectRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		retimeOptions,
	);
	const playback = createFramescaperPlaybackProjectServiceRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
	);
	assert.deepEqual(
		playback.projectForActivationAdmission!(retimeProject).requiredVideoSourceIds,
		['Z-source', 'alpha-source'],
	);
	const facadeProject = createFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE, structuredClone(retimeOptions) as never,
	);
	assert.deepEqual(
		createFramescaperPlaybackProjectService(FRAMESCAPER_PROJECT_RUNTIME_PROFILE)
			.projectForActivationAdmission!(facadeProject).requiredVideoSourceIds,
		['Z-source', 'alpha-source'],
	);

	const exportProject = createFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		twoVideoSourceOptions(),
	);
	const strategy = createFramescaperVideoExportStrategy(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const projected = strategy.createExportProject({
		canonicalProject: exportProject,
		delivery: {
			project: exportProject,
			audioRenderedFallback: null,
			videoRenderedFallback: null,
			requiredAudioSourceIds: [],
			requiredVideoSourceIds: [],
		},
	});
	const plan = strategy.createPlan({
		canonicalProject: exportProject,
		exportProject: projected,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: undefined,
	});
	assert.ok(plan);
	assert.deepEqual(strategy.captureTimingSourceIds!(plan), ['Z-source', 'alpha-source']);
});

test('presentation mask resolution uses code-unit order for deterministic refusal', () => {
	const finishing = {
		visualPresentations: [{
			enabled: true,
			owner: { kind: 'clip', id: 'clip' },
			opacity: 1,
			blendMode: 'normal',
			maskMatteIds: ['alpha-mask', 'Z-mask'],
		}],
	};
	assert.throws(() => applyVideoPresentationLinear(
		['clip'],
		createUnifiedExactLinearPremultipliedFrameV13(1, 1),
		1,
		1,
		finishing as never,
		new Map([['clip', 'source']]),
		new Map(),
		new Map(),
		{ backgroundColor: '#000000ff' },
		'srgb',
		new Set(),
	), /Z-mask/u);
});

test('AUP4 overlap lanes and automatic crossfades use code-unit clip order', () => {
	const source = {
		id: 'source', name: 'source', storageKey: 'source', mimeType: 'audio/wav',
		sampleRate: 48_000, originalSampleRate: 48_000, channelCount: 1,
		frameCount: 8, sampleFormat: 'float32',
	};
	const clip = (id: string) => ({
		id, sourceId: source.id, title: id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 6, durationFrames: 6,
		trimStartFrames: 0, trimEndFrames: 0, envelope: [],
	});
	const plan = createAup4ExportPlan({
		id: 'project', title: 'order', sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: 0, trackIds: [] },
		metadata: {}, master: { effects: [] }, sources: [source],
		clips: [clip('alpha-clip'), clip('Z-clip')],
		tracks: [{
			id: 'track', type: 'audio', name: 'track',
			clipIds: ['alpha-clip', 'Z-clip'], effects: [],
		}],
	});
	const orderedProject = plan.project as {
		readonly tracks: readonly Readonly<{ clipIds: readonly string[] }>[];
		readonly clips: readonly Readonly<{ id: string; envelope: unknown }>[];
	};
	assert.deepEqual(orderedProject.tracks.map(({ clipIds }) => clipIds), [
		['Z-clip'], ['alpha-clip'],
	]);
	const byId = new Map(orderedProject.clips.map((item) => [item.id, item] as const));
	assert.deepEqual(byId.get('Z-clip')?.envelope, [
		{ frame: 0, value: 1 }, { frame: 6, value: 0 },
	]);
	assert.deepEqual(byId.get('alpha-clip')?.envelope, [
		{ frame: 0, value: 0 }, { frame: 6, value: 1 },
	]);
});

function twoAudioTrackOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	const sources = options.sources as Record<string, unknown>[];
	const clips = options.clips as Record<string, unknown>[];
	const tracks = options.tracks as Record<string, unknown>[];
	const sequence = (options.sequences as Record<string, unknown>[])[0]!;
	tracks[1]!.id = 'alpha-track';
	(sequence.trackIds as string[])[1] = 'alpha-track';
	sources.push({
		kind: 'audio', id: 'Z-source', name: 'Z', storageKey: 'Z-source',
		mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	clips.push({
		kind: 'audio', id: 'Z-clip', sourceId: 'Z-source', title: 'Z',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		durationFrames: 48_000,
	});
	tracks.push({
		id: 'Z-track', name: 'Z', type: 'audio', clipIds: ['Z-clip'],
		height: 96, collapsed: false,
	});
	(sequence.trackIds as string[]).push('Z-track');
	return options;
}

function twoVideoSourceOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	const sources = options.sources as Record<string, unknown>[];
	const clips = options.clips as Record<string, unknown>[];
	const projectBin = options.projectBin as { clips: Record<string, unknown>[] };
	sources[0]!.id = 'alpha-source';
	clips[0]!.sourceId = 'alpha-source';
	projectBin.clips[0]!.sourceId = 'alpha-source';
	sources.push(createVideoSource({
		id: 'Z-source', name: 'Z', storageKey: 'Z-source', mimeType: 'video/mp4',
		contentSha256: '34'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
		sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
	}));
	return options;
}

function finishingAudioTrackIds(
	plan: UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV14,
): readonly string[] {
	const finishing = plan.nodes.find(
		(node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing',
	);
	assert.ok(finishing);
	return finishing.audioContext.audioTracks.map(({ id }) => id);
}
