/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createTrackTransformService,
	type TrackTransformServiceDependencies,
} from '../src/common/editor/controller/track-transform-service.ts';
import type {
	ControllerClip,
	ControllerProject,
	ControllerSource,
	ControllerTrack,
	DerivedSourceRecord,
} from '../src/common/editor/controller/track-domain-types.ts';

function projectFixture(overrides: Partial<ControllerProject> = {}): ControllerProject {
	return {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [],
		clips: [],
		sources: [],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] },
		mixer: { groups: [], sends: [], routes: {} },
		...overrides,
	};
}

function trackFixture(overrides: Partial<ControllerTrack> = {}): ControllerTrack {
	return {
		id: 'track',
		name: 'Track',
		type: 'audio',
		clipIds: [],
		effects: [],
		gain: 1,
		pan: 0,
		channelCount: 1,
		...overrides,
	};
}

function clipFixture(id: string, sourceId: string, overrides: Partial<ControllerClip> = {}): ControllerClip {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 100,
		durationFrames: 100,
		...overrides,
	};
}

function sourceFixture(id: string, overrides: Partial<ControllerSource> = {}): ControllerSource {
	return {
		id,
		storageKey: id,
		name: id,
		mimeType: 'audio/wav',
		frameCount: 100,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		...overrides,
	};
}

function createTransformFixture(initialProject: ControllerProject) {
	let project = initialProject;
	let blocked = false;
	let projectCurrent = true;
	let taskCurrent = true;
	let persistenceFailureAt = 0;
	let sequence = 0;
	let persistenceCount = 0;
	const calls = {
		activeAssertions: 0,
		commits: [] as Array<{
			command: AudioEditorCommand;
			selection: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }> | undefined;
		}>,
		finishes: 0,
		persisted: [] as Array<{
			template: ControllerSource;
			channels: Float32Array[];
			name: string;
			prefix: string | undefined;
		}>,
		preflights: [] as number[],
		processing: [] as boolean[],
		publishes: 0,
		renders: [] as unknown[][],
		resamples: [] as unknown[][],
		rollbacks: [] as ReadonlyArray<Pick<DerivedSourceRecord, 'source'>>[],
		statuses: [] as unknown[][],
	};
	const dependencies: TrackTransformServiceDependencies = {
		lifetime: {
			assertActive() { calls.activeAssertions += 1; },
			startTask: (name) => ({
				name,
				generation: 1,
				signal: new AbortController().signal,
				assertCurrent() {
					if (!taskCurrent) throw Object.assign(new Error('Task changed'), { code: 'TASK_CHANGED' });
				},
				finish() { calls.finishes += 1; },
			}),
		},
		copy: {
			v2Required: 'V2 required',
			audioTrackRequired: 'Audio required',
			stereoTrackRequired: 'Stereo required',
			monoTrackRequired: 'Mono required',
			compatibleMonoTrackRequired: 'Partner required',
			resamplingTrack: 'Resampling',
			audacityProcessing: 'Processing',
			rewritingChannels: 'Rewriting',
			done: 'Done',
			channelsSwapped: 'Swapped',
			leftChannel: 'Left',
			rightChannel: 'Right',
			stereo: 'Stereo',
		},
		derivedSources: {
			uniqueClipSources(clips) {
				const ids = new Set(clips.map((clip) => clip.sourceId));
				return project.sources.filter((source) => ids.has(source.id));
			},
			async sourceChannelsForEdit(source) {
				return Array.from({ length: source.channelCount }, (_, channel) => Float32Array.of(
					channel * 10 + 1,
					channel * 10 + 2,
					channel * 10 + 3,
					channel * 10 + 4,
				));
			},
			async persistDerivedSource(template, channels, name, prefix) {
				persistenceCount += 1;
				if (persistenceFailureAt === persistenceCount) throw new Error('Persistence failed');
				calls.persisted.push({ template, channels, name, prefix });
				const id = `${prefix || 'derived'}-${++sequence}`;
				return {
					source: sourceFixture(id, {
						...template,
						id,
						storageKey: id,
						name,
						frameCount: channels[0]?.length ?? 0,
						channelCount: channels.length,
					}),
					buffer: null,
					channels,
				};
			},
			async persistRenderedMixSource() {
				return { source: sourceFixture('mix'), buffer: null, channels: null };
			},
			async rollbackDerivedSources(records) { calls.rollbacks.push(records); },
		},
		getProject: () => project,
		getSelectedTrackId: () => project.tracks[0]?.id ?? null,
		editingBlocked: () => blocked,
		captureProject: () => ({ generation: 1, projectId: project.id }),
		assertProject(token) {
			if (!projectCurrent || token.projectId !== project.id) {
				throw Object.assign(new Error('Project changed'), { code: 'PROJECT_CHANGED' });
			}
		},
		createId: (prefix) => `${prefix}-${++sequence}`,
		commit(command, selection) {
			calls.commits.push({ command, selection });
			return command;
		},
		projectSampleRate: () => project.sampleRate,
		normalizeProjectSampleRate: (value) => Math.max(1, Math.round(Number(value) || project.sampleRate)),
		audioTrackChannelCount: (_value, track) => Number(track.channelCount) || 1,
		async preflightStorage(bytes) { calls.preflights.push(bytes); },
		setProcessing(processing) { calls.processing.push(processing); },
		setStatus(...args) { calls.statuses.push(args); },
		publish() { calls.publishes += 1; },
		resampleChannels(channels, inputSampleRate, outputSampleRate, outputFrames) {
			calls.resamples.push([channels, inputSampleRate, outputSampleRate, outputFrames]);
			return channels.map((_channel, index) => {
				const output = new Float32Array(outputFrames);
				output.fill(index + 1);
				return output;
			});
		},
		async renderDryTrackRange(...args) {
			calls.renders.push(args);
			return [Float32Array.of(0.25, 0.5, 0.75, 1)];
		},
	};
	return {
		service: createTrackTransformService(dependencies),
		calls,
		setBlocked(value: boolean) { blocked = value; },
		setPersistenceFailureAt(value: number) { persistenceFailureAt = value; },
		setProject(value: ControllerProject) { project = value; },
		setProjectCurrent(value: boolean) { projectCurrent = value; },
		setTaskCurrent(value: boolean) { taskCurrent = value; },
	};
}

test('resampling persists one derived source and atomically rewrites clip geometry', async () => {
	const source = sourceFixture('source', { sampleRate: 24_000, originalSampleRate: 0, frameCount: 100 });
	const clip = clipFixture('clip', source.id, {
		sourceStartFrame: 10,
		sourceDurationFrames: 30,
		durationFrames: 30,
		trimStartFrames: 2,
		trimEndFrames: 3,
	});
	const track = trackFixture({ id: 'track', clipIds: [clip.id] });
	const fixture = createTransformFixture(projectFixture({ tracks: [track], clips: [clip], sources: [source] }));

	assert.equal(Object.isFrozen(fixture.service), true);
	assert.equal(await fixture.service.resampleTrack('track', 48_000), 'track');
	assert.deepEqual(fixture.calls.preflights, [800]);
	assert.deepEqual(fixture.calls.processing, [true, false]);
	assert.deepEqual(fixture.calls.statuses, [['Resampling'], ['Done', 'success']]);
	assert.equal(fixture.calls.persisted[0]?.template.sampleRate, 48_000);
	assert.equal(fixture.calls.persisted[0]?.template.originalSampleRate, 24_000);
	const batch = fixture.calls.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') assert.fail('Expected a resample batch.');
	assert.deepEqual(batch.commands.map((command) => command.type), ['source/add', 'clip/remove', 'clip/add']);
	const added = batch.commands[2];
	assert.equal(added?.type, 'clip/add');
	if (added?.type !== 'clip/add') assert.fail('Expected a replacement clip.');
	assert.equal(added.clip.sourceStartFrame, 20);
	assert.equal(added.clip.sourceDurationFrames, 60);
	assert.equal(added.clip.trimStartFrames, 4);
	assert.equal(added.clip.trimEndFrames, 6);
});

test('channel swapping persists reversed stereo data and replaces every matching clip source', async () => {
	const source = sourceFixture('stereo-source', { channelCount: 2 });
	const clip = clipFixture('clip', source.id);
	const track = trackFixture({ id: 'stereo', channelCount: 2, clipIds: [clip.id] });
	const fixture = createTransformFixture(projectFixture({ tracks: [track], clips: [clip], sources: [source] }));

	assert.equal(await fixture.service.swapTrackChannels('stereo'), 'stereo');
	assert.deepEqual(Array.from(fixture.calls.persisted[0]?.channels[0] ?? []), [11, 12, 13, 14]);
	assert.deepEqual(Array.from(fixture.calls.persisted[0]?.channels[1] ?? []), [1, 2, 3, 4]);
	const batch = fixture.calls.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') assert.fail('Expected a swap batch.');
	assert.deepEqual(batch.commands.map((command) => command.type), ['source/add', 'clip/replace-source']);
	assert.deepEqual(fixture.calls.statuses, [['Rewriting'], ['Done', 'success']]);
});

test('stereo splitting creates left and right tracks, sources, clips, and independent effects', async () => {
	const source = sourceFixture('stereo-source', { channelCount: 2 });
	const clip = clipFixture('clip', source.id);
	const track = trackFixture({
		id: 'stereo',
		name: 'Band',
		channelCount: 2,
		clipIds: [clip.id],
		armed: true,
		effects: [{ id: 'effect', type: 'gain', enabled: true, params: {} }],
	});
	const fixture = createTransformFixture(projectFixture({ tracks: [track], clips: [clip], sources: [source] }));

	const result = await fixture.service.splitStereoTrack('stereo');
	assert.equal(result?.leftTrackId, 'stereo');
	assert.match(result?.rightTrackId ?? '', /^track-/u);
	assert.deepEqual(fixture.calls.persisted.map((entry) => entry.prefix), ['left-source', 'right-source']);
	const batch = fixture.calls.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') assert.fail('Expected a split batch.');
	assert.deepEqual(batch.commands.map((command) => command.type), [
		'source/add', 'source/add', 'track/remove', 'track/add', 'track/add', 'clip/add', 'clip/add',
	]);
	const trackAdds = batch.commands.filter((command) => command.type === 'track/add');
	assert.equal(trackAdds[0]?.type, 'track/add');
	assert.equal(trackAdds[1]?.type, 'track/add');
	if (trackAdds[0]?.type !== 'track/add' || trackAdds[1]?.type !== 'track/add') assert.fail('Expected split tracks.');
	assert.equal(trackAdds[0].track.pan, -1);
	assert.equal(trackAdds[1].track.pan, 1);
	assert.equal(trackAdds[1].track.armed, false);
	const rightEffects = trackAdds[1].track.effects as Array<{ id?: unknown }> | undefined;
	assert.notEqual(rightEffects?.[0]?.id, 'effect');
});

test('joining mono tracks renders their shared range and uses a synthetic source template when needed', async () => {
	const leftClip = clipFixture('left-clip', 'missing-left', { timelineStartFrame: 10, durationFrames: 20 });
	const rightClip = clipFixture('right-clip', 'missing-right', { timelineStartFrame: 5, durationFrames: 40 });
	const left = trackFixture({ id: 'left', name: 'Pair', clipIds: [leftClip.id] });
	const right = trackFixture({ id: 'right', clipIds: [rightClip.id] });
	const fixture = createTransformFixture(projectFixture({
		tracks: [left, right],
		clips: [leftClip, rightClip],
		sources: [],
	}));

	assert.equal(await fixture.service.makeStereoTrack('left'), 'left');
	assert.deepEqual(fixture.calls.preflights, [320]);
	assert.deepEqual(fixture.calls.renders, [
		['left', 5, 45, 1],
		['right', 5, 45, 1],
	]);
	assert.equal(fixture.calls.persisted[0]?.template.id, 'stereo-template');
	assert.equal(fixture.calls.persisted[0]?.channels.length, 2);
	const batch = fixture.calls.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') assert.fail('Expected a stereo join batch.');
	assert.deepEqual(batch.commands.map((command) => command.type), [
		'source/add', 'track/remove', 'track/remove', 'track/add', 'clip/add',
	]);
	assert.deepEqual(fixture.calls.commits[0]?.selection, {
		selectTrackId: 'left',
		selectClipId: batch.commands[4]?.type === 'clip/add' ? batch.commands[4].clip.id : null,
	});
});

test('transform guards reject incompatible tracks and return early for blocked or redundant work', async () => {
	const monoSource = sourceFixture('mono');
	const monoClip = clipFixture('mono-clip', monoSource.id);
	const mono = trackFixture({ id: 'mono', clipIds: [monoClip.id] });
	const fixture = createTransformFixture(projectFixture({ tracks: [mono], clips: [monoClip], sources: [monoSource] }));
	fixture.setBlocked(true);
	assert.equal(await fixture.service.resampleTrack('mono', 44_100), null);
	fixture.setBlocked(false);
	assert.equal(await fixture.service.resampleTrack('mono', 48_000), 'mono');
	assert.equal(fixture.calls.commits.length, 0);

	await assert.rejects(fixture.service.swapTrackChannels('mono'), /Stereo required/u);
	const stereo = trackFixture({ id: 'stereo', channelCount: 2 });
	fixture.setProject(projectFixture({ tracks: [stereo] }));
	assert.equal(await fixture.service.swapTrackChannels('stereo'), 'stereo');
	await assert.rejects(fixture.service.makeStereoTrack('stereo'), /Mono required/u);

	fixture.setProject(projectFixture({ tracks: [mono] }));
	await assert.rejects(fixture.service.makeStereoTrack('mono'), /Partner required/u);
	fixture.setProject({
		...projectFixture({ tracks: [mono] }),
		schemaFamily: undefined,
	} as ControllerProject);
	await assert.rejects(fixture.service.resampleTrack('mono'), /V2 required/u);
	fixture.setProject(projectFixture({ tracks: [trackFixture({ id: 'label', type: 'label' })] }));
	await assert.rejects(fixture.service.resampleTrack('label'), /Audio required/u);
});

test('empty mono pairs merge synchronously and split failures roll back partial derived sources', async () => {
	const left = trackFixture({ id: 'left' });
	const right = trackFixture({ id: 'right' });
	const empty = createTransformFixture(projectFixture({ tracks: [left, right] }));
	const merged = await empty.service.makeStereoTrack('left', 'right');
	assert.equal((merged as AudioEditorCommand).type, 'batch');
	assert.deepEqual(empty.calls.commits[0]?.selection, { selectTrackId: 'left' });

	const source = sourceFixture('stereo-source', { channelCount: 2 });
	const clip = clipFixture('clip', source.id);
	const stereo = trackFixture({ id: 'stereo', channelCount: 2, clipIds: [clip.id] });
	const failed = createTransformFixture(projectFixture({ tracks: [stereo], clips: [clip], sources: [source] }));
	failed.setPersistenceFailureAt(2);
	await assert.rejects(failed.service.splitStereoTrack('stereo'), /Persistence failed/u);
	assert.equal(failed.calls.rollbacks.length, 1);
	assert.equal(failed.calls.rollbacks[0]?.length, 1);
	assert.deepEqual(failed.calls.processing, [true, false]);
});
