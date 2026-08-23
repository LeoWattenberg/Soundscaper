/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import {
	createVideoEditService,
	type VideoEditServiceDependencies,
} from '../src/common/editor/controller/video-edit-service.ts';
import { createVideoRetimeProgramStateResolver } from '../src/common/editor/controller/video-retime-program-state.ts';
import { resolveProgramFrame } from '../src/common/editor/source-monitor-model.ts';
import { resolveSourceTimecodeAtSample } from '../src/common/editor/source-properties-model.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import {
	createVideoRetimeProgramOrdinalBridge,
	type VideoRetimeProgramOrdinalBridge,
} from '../src/common/editor/video-retime-program-ordinal-bridge.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import { applyFramescaperProjectCommandV20 } from '../src/framescaper/editor-project-v20-commands.ts';
import { reconcileFramescaperProjectFeatureRequirementsV20 } from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	createFramescaperVideoRetimeFreezeCommandV20,
	createFramescaperVideoRetimeRampCommandV20,
	createFramescaperVideoRetimeReverseCommandV20,
} from '../src/framescaper/editor-project-v20-retime-command.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	framescaperProjectForCommandConsumersV20,
	framescaperProjectForRuntimeConsumersV20,
} from '../src/framescaper/editor-project-v20-runtime.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;
const SAMPLE_RATE = 48_000;
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

test('match-frame and source timecode consume exact CFR reverse, freeze, and ramp ordinals', () => {
	const cases = [
		{
			name: 'reverse', sample: 0, expected: 9,
			command: createFramescaperVideoRetimeReverseCommandV20({
				clipId: 'video-clip', expectedRetimeMap: null,
			}),
		},
		{
			name: 'freeze', sample: 24_000, expected: 4,
			command: createFramescaperVideoRetimeFreezeCommandV20({
				clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: rational(4),
			}),
		},
		{
			name: 'ramp', sample: 24_000, expected: 2,
			command: createFramescaperVideoRetimeRampCommandV20({
				clipId: 'video-clip', expectedRetimeMap: null, direction: 'forward',
				startVelocity: rational(0), endVelocity: rational(2), sourceStartFrame: rational(0),
			}),
		},
	] as const;
	for (const fixture of cases) {
		const project = applyFramescaperProjectCommandV20(
			PROFILE,
			createFramescaperProjectV20(PROFILE, framescaperV20Options()),
			fixture.command,
			{ now: '2026-08-23T18:00:00.000Z' },
		);
		assertConsumers(project, fixture.sample, fixture.expected, fixture.name);
	}
});

test('match-frame and source timecode retain exact NTSC frame addressing', () => {
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	(options.sources as Record<string, unknown>[])[0] = {
		...source,
		frameRate: NTSC,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: NTSC },
	};
	(options.sequences as Record<string, unknown>[])[0] = {
		...(options.sequences as Record<string, unknown>[])[0],
		rate: NTSC,
	};
	const project = applyFramescaperProjectCommandV20(
		PROFILE,
		createFramescaperProjectV20(PROFILE, options),
		createFramescaperVideoRetimeFreezeCommandV20({
			clipId: 'video-clip', expectedRetimeMap: null, sourceFrame: rational(4),
		}),
		{ now: '2026-08-23T18:01:00.000Z' },
	);
	assertConsumers(
		project,
		videoFrameToSampleFrame(5, NTSC, SAMPLE_RATE, 'point'),
		4,
		'NTSC freeze',
	);
});

test('match-frame and source timecode use the registered exact VFR authority', () => {
	const { project, publication } = vfrReverseProject();
	const source = videoSource(project);
	registerVideoTimingIndex(
		source,
		validateVideoTimingAssetBytes(publication.reference, publication.bytes),
	);
	try {
		assertConsumers(project, 0, 9, 'VFR reverse');
	} finally {
		unregisterVideoTimingIndex(source);
	}
});

test('retimed match-frame and source timecode fail closed without exact VFR timing', () => {
	const { project, publication } = vfrReverseProject();
	const source = videoSource(project);
	unregisterVideoTimingIndex(source);
	const selected = selectedState(project);
	assert.equal(resolveSourceTimecodeAtSample(
		selected.project, 0, 'main-sequence', selected.bridge,
	), null);
	assert.throws(
		() => resolveProgramFrame(
			selected.project,
			{ sample: 0, sequenceId: 'main-sequence' },
			selected.bridge,
		),
		/exact|retime|timing|unavailable/iu,
	);
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	try {
		assertSelectedConsumers(selected, 0, 9, 'registered-after-refusal VFR reverse');
	} finally {
		unregisterVideoTimingIndex(source);
	}
	assert.equal(resolveSourceTimecodeAtSample(
		selected.project, 0, 'main-sequence', selected.bridge,
	), null);
	assert.throws(
		() => resolveProgramFrame(
			selected.project,
			{ sample: 0, sequenceId: 'main-sequence' },
			selected.bridge,
		),
		/exact|retime|timing|unavailable/iu,
	);
});

test('retimed program consumers reject missing, forged, and cross-project authorities', () => {
	const first = reverseProject('2026-08-23T18:03:00.000Z');
	const second = reverseProject('2026-08-23T18:04:00.000Z');
	const selectedFirst = selectedState(first);
	const selectedSecond = selectedState(second);
	assert.equal(resolveSourceTimecodeAtSample(selectedFirst.project, 0, 'main-sequence'), null);
	assert.throws(
		() => resolveProgramFrame(selectedFirst.project, { sample: 0, sequenceId: 'main-sequence' }),
		/exact|retime|unavailable/iu,
	);
	assert.throws(
		() => resolveProgramFrame(
			selectedFirst.project,
			{ sample: 0, sequenceId: 'main-sequence' },
			{ ownerProject: selectedFirst.project } as VideoRetimeProgramOrdinalBridge,
		),
		/authentic/iu,
	);
	assert.throws(
		() => resolveProgramFrame(
			selectedSecond.project,
			{ sample: 0, sequenceId: 'main-sequence' },
			selectedFirst.bridge,
		),
		/another project state/iu,
	);
});

test('selected Match Frame and toolbar timecode share the exact program state', () => {
	const selected = selectedState(reverseProject('2026-08-23T18:05:00.000Z'));
	const videoTrack = records(selected.project.tracks).find(({ type }) => type === 'video');
	assert.ok(videoTrack);
	const opened: Record<string, unknown>[] = [];
	const service = createVideoEditService({
		lifetime: new EditorControllerLifetime(),
		getProject: () => selected.project,
		getSelectedTrackId: () => String(videoTrack.id),
		editingBlocked: () => false,
		commit: () => undefined,
		publishProjectState: () => undefined,
		prepareThreePointEditCommand: () => {
			throw new Error('Match Frame must not author a command.');
		},
		getPositionFrames: () => 0,
		getVideoRetimeProgramState: () => selected,
		sourceMonitor: {
			view: () => ({}),
			openSource: (sourceId: string, options: Record<string, unknown>) => {
				opened.push({ sourceId, ...options });
				return { sourceId, ...options };
			},
			points: () => null,
		} as unknown as VideoEditServiceDependencies['sourceMonitor'],
	});
	const match = service.matchFrame({ sequenceId: 'main-sequence' });
	assert.equal(match.sourceFrame, 9);
	assert.equal(opened[0]?.positionFrame, 9);
	assert.equal(service.sourceTimecodeAtSample(0, 'main-sequence')?.sourceFrame, 9);
});

test('the selected product resolver caches by document identity and absent routes stay inactive', () => {
	let current = reverseProject('2026-08-23T18:06:00.000Z');
	let factoryCalls = 0;
	const projectRuntime = {
		projectForCommandConsumers: (project: unknown) => (
			framescaperProjectForCommandConsumersV20(PROFILE, project)
		),
		projectForRuntimeConsumers: (project: unknown) => (
			framescaperProjectForRuntimeConsumersV20(PROFILE, project)
		),
	};
	const resolve = createVideoRetimeProgramStateResolver({
		getProject: () => current,
		projectRuntime,
		createBridge: (owner, authority) => {
			factoryCalls += 1;
			return createVideoRetimeProgramOrdinalBridge(owner, authority);
		},
	});
	assert.ok(resolve);
	const first = resolve();
	assert.equal(resolve(), first);
	assert.equal(factoryCalls, 1);
	current = reverseProject('2026-08-23T18:07:00.000Z');
	assert.notEqual(resolve(), first);
	assert.equal(factoryCalls, 2);
	assert.equal(createVideoRetimeProgramStateResolver({
		getProject: () => current,
		projectRuntime,
	}), undefined);
});

function assertConsumers(project: unknown, sample: number, expected: number, name: string): void {
	assertSelectedConsumers(selectedState(project), sample, expected, name);
}

function assertSelectedConsumers(
	selected: ReturnType<typeof selectedState>,
	sample: number,
	expected: number,
	name: string,
): void {
	const program = resolveProgramFrame(
		selected.project,
		{ sample, sequenceId: 'main-sequence' },
		selected.bridge,
	);
	const reading = resolveSourceTimecodeAtSample(
		selected.project,
		sample,
		'main-sequence',
		selected.bridge,
	);
	assert.equal(program?.sourceFrame, expected, `${name} match-frame ordinal`);
	assert.equal(reading?.sourceFrame, expected, `${name} source-timecode ordinal`);
}

function selectedState(project: unknown): Readonly<{
	readonly project: Readonly<Record<string, unknown>>;
	readonly bridge: VideoRetimeProgramOrdinalBridge;
}> {
	const commandProject = framescaperProjectForCommandConsumersV20(PROFILE, project);
	const runtimeProject = framescaperProjectForRuntimeConsumersV20(PROFILE, project);
	return Object.freeze({
		project: commandProject,
		bridge: createVideoRetimeProgramOrdinalBridge(commandProject, runtimeProject),
	});
}

function reverseProject(now: string): unknown {
	return applyFramescaperProjectCommandV20(
		PROFILE,
		createFramescaperProjectV20(PROFILE, framescaperV20Options()),
		createFramescaperVideoRetimeReverseCommandV20({
			clipId: 'video-clip', expectedRetimeMap: null,
		}),
		{ now },
	);
}

function vfrReverseProject(): Readonly<{
	readonly project: unknown;
	readonly publication: ReturnType<typeof createVideoTimingAssetPublication>;
}> {
	const canonical = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const reversed = applyFramescaperProjectCommandV20(
		PROFILE,
		canonical,
		createFramescaperVideoRetimeReverseCommandV20({
			clipId: 'video-clip', expectedRetimeMap: null,
		}),
		{ now: '2026-08-23T18:02:00.000Z' },
	);
	const project = structuredClone(reversed) as Record<string, unknown>;
	const source = videoSource(project);
	const publication = createVideoTimingAssetPublication(String(source.contentSha256), {
		timescale: 10,
		presentationTicks: [0n, 2n, 5n, 9n, 14n, 20n, 27n, 35n, 44n, 54n],
		finalFrameDurationTicks: 11n,
	});
	source.frameRate = NTSC;
	source.timingAsset = publication.reference;
	source.timingDecision = { mode: 'exact', rate: NTSC, backend: 'demuxer' };
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	return Object.freeze({ project, publication });
}

function videoSource(projectValue: unknown): Record<string, unknown> {
	const project = projectValue as Record<string, unknown>;
	const source = (project.sources as Record<string, unknown>[]).find(({ kind }) => kind === 'video');
	if (!source) throw new Error('The retime consumer fixture requires a video source.');
	return source;
}

function records(value: unknown): readonly Record<string, unknown>[] {
	return Array.isArray(value) ? value as readonly Record<string, unknown>[] : [];
}

function rational(num: number, den = 1): Readonly<{ readonly num: number; readonly den: number }> {
	return Object.freeze({ num, den });
}
