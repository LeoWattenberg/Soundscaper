/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createClipResampleService,
	resampledClipCommands,
	type ClipResampleServiceDependencies,
} from '../src/common/editor/controller/clip-resample-service.ts';
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
		automationLanes: [],
		...overrides,
	} as ControllerProject;
}

function trackFixture(overrides: Partial<ControllerTrack> = {}): ControllerTrack {
	return { id: 'track', name: 'Track', type: 'audio', clipIds: [], effects: [], gain: 1, pan: 0, ...overrides };
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

function createResampleFixture(initialProject: ControllerProject) {
	const project = initialProject;
	let blocked = false;
	let sequence = 0;
	let persistenceFails = false;
	const calls = {
		commits: [] as Array<{
			command: AudioEditorCommand;
			selection: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }> | undefined;
		}>,
		finishes: 0,
		persisted: [] as ControllerSource[],
		preflights: [] as number[],
		processing: [] as boolean[],
		resamples: [] as unknown[][],
		rollbacks: [] as ReadonlyArray<Pick<DerivedSourceRecord, 'source'>>[],
		statuses: [] as unknown[][],
	};
	const dependencies: ClipResampleServiceDependencies = {
		lifetime: {
			assertActive() { /* always active in this fixture */ },
			startTask: (name) => ({
				name,
				generation: 1,
				signal: new AbortController().signal,
				assertCurrent() { /* always current in this fixture */ },
				finish() { calls.finishes += 1; },
			}),
		},
		copy: {
			v2Required: 'V2 required',
			audioClipNotFound: 'Clip missing',
			unsupportedSampleFormat: 'Unsupported format',
			resamplingClip: 'Resampling clip',
			audacityProcessing: 'Processing',
			done: 'Done',
		},
		derivedSources: {
			uniqueClipSources: (clips) => project.sources.filter(
				(source) => clips.some((clip) => clip.sourceId === source.id),
			),
			async sourceChannelsForEdit(source) {
				return Array.from({ length: source.channelCount }, () => Float32Array.of(1, 2, 3, 4));
			},
			async persistDerivedSource(template, channels, name, prefix) {
				if (persistenceFails) throw new Error('Persistence failed');
				const id = `${prefix || 'derived'}-${++sequence}`;
				const source = sourceFixture(id, {
					...template,
					id,
					storageKey: id,
					name,
					frameCount: channels[0]?.length ?? 0,
					channelCount: channels.length,
				});
				calls.persisted.push(source);
				return { source, buffer: null, channels };
			},
			async persistRenderedMixSource() {
				return { source: sourceFixture('mix'), buffer: null, channels: null };
			},
			async rollbackDerivedSources(records) { calls.rollbacks.push(records); },
		},
		getProject: () => project,
		getSelectedClipId: () => project.clips[0]?.id ?? null,
		editingBlocked: () => blocked,
		captureProject: () => ({ generation: 1, projectId: project.id }),
		assertProject(token) {
			if (token.projectId !== project.id) throw new Error('Project changed');
		},
		commit(command, selection) {
			calls.commits.push({ command, selection });
			return command;
		},
		normalizeProjectSampleRate: (value) => Math.max(1, Math.round(Number(value) || project.sampleRate)),
		async preflightStorage(bytes) { calls.preflights.push(bytes); },
		setProcessing(processing) { calls.processing.push(processing); },
		setStatus(...args) { calls.statuses.push(args); },
		publish() { /* snapshot publication is observed through commits */ },
		resampleChannels(channels, inputSampleRate, outputSampleRate, outputFrames) {
			calls.resamples.push([channels.length, inputSampleRate, outputSampleRate, outputFrames]);
			return channels.map(() => new Float32Array(outputFrames));
		},
	};
	return {
		service: createClipResampleService(dependencies),
		calls,
		setBlocked(value: boolean) { blocked = value; },
		setPersistenceFails(value: boolean) { persistenceFails = value; },
	};
}

test('resampling one clip repoints only that clip and leaves its source for the others', async () => {
	const source = sourceFixture('source', { sampleRate: 24_000, frameCount: 100 });
	const clip = clipFixture('clip', source.id, {
		sourceStartFrame: 10,
		sourceDurationFrames: 30,
		durationFrames: 30,
		trimStartFrames: 2,
		trimEndFrames: 3,
	});
	const sibling = clipFixture('sibling', source.id);
	const track = trackFixture({ clipIds: [clip.id, sibling.id] });
	const fixture = createResampleFixture(projectFixture({
		tracks: [track], clips: [clip, sibling], sources: [source],
	}));

	assert.equal(Object.isFrozen(fixture.service), true);
	assert.equal(await fixture.service.resampleClip('clip', { sampleRate: 48_000 }), 'clip');
	assert.deepEqual(fixture.calls.preflights, [800]);
	assert.deepEqual(fixture.calls.resamples, [[1, 24_000, 48_000, 200]]);
	assert.deepEqual(fixture.calls.processing, [true, false]);
	assert.equal(fixture.calls.finishes, 1);

	assert.equal(fixture.calls.commits.length, 1);
	const [{ command, selection }] = fixture.calls.commits;
	assert.deepEqual(selection, { selectTrackId: 'track', selectClipId: 'clip' });
	const commands = (command as { type: string; commands: AudioEditorCommand[] }).commands;
	assert.equal(command.type, 'batch');
	assert.deepEqual(commands.map((entry) => entry.type), ['source/add', 'clip/remove', 'clip/add']);

	// Only the resampled clip moves; the sibling keeps the source it shares.
	const added = commands[2] as { clip: Record<string, unknown> };
	assert.equal(added.clip.id, 'clip');
	assert.equal(added.clip.sourceId, fixture.calls.persisted[0]?.id);
	assert.equal(commands.some((entry) => (entry as { clipId?: string }).clipId === 'sibling'), false);

	// The frame grid doubled, so every source-frame field doubles with it.
	assert.equal(added.clip.sourceStartFrame, 20);
	assert.equal(added.clip.sourceDurationFrames, 60);
	assert.equal(added.clip.trimStartFrames, 4);
	assert.equal(added.clip.trimEndFrames, 6);
});

test('the resampled source carries the requested format and the original rate', async () => {
	const source = sourceFixture('source', { sampleRate: 96_000, originalSampleRate: 0, frameCount: 100 });
	const clip = clipFixture('clip', source.id);
	const fixture = createResampleFixture(projectFixture({
		tracks: [trackFixture({ clipIds: [clip.id] })], clips: [clip], sources: [source],
	}));

	await fixture.service.resampleClip('clip', { sampleRate: 48_000, sampleFormat: 'int24' });
	const [persisted] = fixture.calls.persisted;
	assert.equal(persisted?.sampleRate, 48_000);
	assert.equal(persisted?.sampleFormat, 'int24');
	assert.equal(persisted?.originalSampleRate, 96_000);
	assert.match(String(persisted?.name), /48000 Hz/u);
});

test('a format change at the same rate relabels the source instead of copying it', async () => {
	const source = sourceFixture('source');
	const clip = clipFixture('clip', source.id);
	const fixture = createResampleFixture(projectFixture({
		tracks: [trackFixture({ clipIds: [clip.id] })], clips: [clip], sources: [source],
	}));

	assert.equal(await fixture.service.resampleClip('clip', { sampleRate: 48_000, sampleFormat: 'int16' }), 'clip');
	assert.deepEqual(fixture.calls.persisted, []);
	assert.deepEqual(fixture.calls.preflights, []);
	assert.deepEqual(fixture.calls.commits.map(({ command }) => command), [
		{ type: 'source/update', sourceId: 'source', changes: { sampleFormat: 'int16' } },
	]);
});

test('a request that changes nothing commits nothing', async () => {
	const source = sourceFixture('source');
	const clip = clipFixture('clip', source.id);
	const fixture = createResampleFixture(projectFixture({
		tracks: [trackFixture({ clipIds: [clip.id] })], clips: [clip], sources: [source],
	}));

	assert.equal(await fixture.service.resampleClip('clip', { sampleRate: 48_000, sampleFormat: 'float32' }), 'clip');
	assert.equal(await fixture.service.resampleClip('clip'), 'clip');
	assert.deepEqual(fixture.calls.commits, []);
});

test('an unsupported format, a missing clip, and a blocked project all refuse', async () => {
	const source = sourceFixture('source');
	const clip = clipFixture('clip', source.id);
	const fixture = createResampleFixture(projectFixture({
		tracks: [trackFixture({ clipIds: [clip.id] })], clips: [clip], sources: [source],
	}));

	await assert.rejects(
		() => fixture.service.resampleClip('clip', { sampleFormat: 'int12' }),
		/Unsupported format/u,
	);
	await assert.rejects(() => fixture.service.resampleClip('absent'), /Clip missing/u);
	fixture.setBlocked(true);
	assert.equal(await fixture.service.resampleClip('clip', { sampleRate: 96_000 }), null);
	assert.deepEqual(fixture.calls.commits, []);
});

test('a failed persistence rolls the derived source back and reports the failure', async () => {
	const source = sourceFixture('source', { sampleRate: 24_000 });
	const clip = clipFixture('clip', source.id);
	const fixture = createResampleFixture(projectFixture({
		tracks: [trackFixture({ clipIds: [clip.id] })], clips: [clip], sources: [source],
	}));
	fixture.setPersistenceFails(true);

	await assert.rejects(() => fixture.service.resampleClip('clip', { sampleRate: 48_000 }), /Persistence failed/u);
	assert.deepEqual(fixture.calls.commits, []);
	assert.deepEqual(fixture.calls.processing, [true, false]);
	assert.equal(fixture.calls.finishes, 1);
});

test('resampled clip geometry never leaves the replacement source', () => {
	const original = sourceFixture('original', { sampleRate: 48_000, frameCount: 100 });
	const replacement = sourceFixture('replacement', { sampleRate: 24_000, frameCount: 50 });
	const clip = clipFixture('clip', original.id, {
		sourceStartFrame: 90,
		sourceDurationFrames: 10,
		durationFrames: 10,
		trimStartFrames: 80,
		trimEndFrames: 40,
	});

	const [remove, add] = resampledClipCommands('track', clip, original, replacement, 24_000);
	assert.deepEqual(remove, { type: 'clip/remove', clipId: 'clip' });
	const added = (add as { clip: Record<string, number> }).clip;
	assert.equal(added.sourceStartFrame, 45);
	assert.equal(added.sourceDurationFrames, 5);
	assert.ok(added.sourceStartFrame + added.sourceDurationFrames <= replacement.frameCount);
	assert.ok(added.trimStartFrames <= added.sourceStartFrame);
	assert.ok(
		added.trimEndFrames <= replacement.frameCount - added.sourceStartFrame - added.sourceDurationFrames,
	);
});
