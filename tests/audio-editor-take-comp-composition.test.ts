/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createTakeCompControllerComposition } from '../src/common/editor/controller/take-comp-composition.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import type { DerivedSourceRecord } from '../src/common/editor/controller/track-domain-types.ts';
import {
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17, type AudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const NOW = '2026-08-12T12:00:00.000Z';

test('take and lane audition use an isolated exact-source preview and toggle without document edits', async () => {
	const fixture = compositionFixture();
	const take = await fixture.composition.auditionTake('group-a', 'take-b');
	assert.deepEqual(take, {
		key: 'take:group-a:take-b', groupId: 'group-a', laneId: 'lane-b',
		takeIds: ['take-b'], state: 'playing',
	});
	assert.equal(fixture.playbackStops, 1);
	assert.equal(fixture.previewEngines.length, 1);
	const loaded = fixture.previewEngines[0]!.loaded.at(-1) as AudioEditorProjectV17;
	assert.deepEqual(loaded.sources.map(({ id }) => id), ['source-b']);
	assert.deepEqual(loaded.clips.map((clip) => ({
		sourceId: clip.sourceId,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		durationFrames: clip.durationFrames,
	})), [{
		sourceId: 'source-b', timelineStartFrame: 0, sourceStartFrame: 25, durationFrames: 400,
	}]);
	assert.deepEqual(fixture.commands, [], 'audition never mutates history');

	const paused = await fixture.composition.auditionTake('group-a', 'take-b');
	assert.equal(paused.state, 'paused');
	assert.equal(fixture.previewEngines[0]!.pauseCount, 1);
	const lane = await fixture.composition.auditionLane('group-a', 'lane-a');
	assert.deepEqual(lane.takeIds, ['take-a']);
	assert.equal(lane.state, 'playing');
	assert.equal(fixture.previewEngines[0]!.stopCount, 1);
	await fixture.composition.dispose();
	assert.equal(fixture.previewEngines[0]!.stopCount, 2);
	assert.equal(fixture.previewEngines[0]!.disposeCount, 1);
});

test('a retired take-comp preview engine cannot overwrite its replacement with a late state event', async () => {
	const fixture = compositionFixture();
	await fixture.composition.auditionTake('group-a', 'take-b');
	const retired = fixture.previewEngines[0]!;
	await fixture.composition.dispose();

	await fixture.composition.auditionTake('group-a', 'take-b');
	const replacement = fixture.previewEngines[1]!;
	retired.emit('stopped');
	const paused = await fixture.composition.auditionTake('group-a', 'take-b');

	assert.equal(paused.state, 'paused');
	assert.equal(replacement.pauseCount, 1);
	assert.equal(replacement.playCount, 1);
	assert.equal(replacement.loaded.length, 1);
	await fixture.composition.dispose();
});

test('a rejected take preview stops its engine and the next audition retries playback', async () => {
	const fixture = compositionFixture({ previewPlayFails: true });
	await assert.rejects(
		fixture.composition.auditionTake('group-a', 'take-b'),
		/preview play failed/u,
	);
	await assert.rejects(
		fixture.composition.auditionTake('group-a', 'take-b'),
		/preview play failed/u,
	);

	assert.equal(fixture.previewEngines[0]?.playCount, 2);
	assert.equal(fixture.previewEngines[0]?.pauseCount, 0);
	assert.equal(fixture.previewEngines[0]?.stopCount, 3);
});

test('range promotion supplies exact split identities and boundary edits remain one command each', () => {
	const fixture = compositionFixture();
	fixture.composition.promoteTake('group-a', {
		takeId: 'take-b', startSample: 200, endSample: 300,
	});
	assert.deepEqual(fixture.project().takeGroups[0]?.compRegions.map((region) => ({
		takeId: region.takeId, startSample: region.startSample, endSample: region.endSample,
	})), [
		{ takeId: 'take-a', startSample: 100, endSample: 200 },
		{ takeId: 'take-b', startSample: 200, endSample: 300 },
		{ takeId: 'take-a', startSample: 300, endSample: 500 },
	]);
	const [left, promoted, right] = fixture.project().takeGroups[0]!.compRegions;
	fixture.composition.editSharedCompBoundary('group-a', {
		leftRegionId: left!.id, rightRegionId: promoted!.id, boundarySample: 225,
	});
	fixture.composition.editCompBoundary('group-a', {
		regionId: right!.id, edge: 'start', boundarySample: 325,
	});
	assert.equal(fixture.commands.length, 3);
	assert.deepEqual(fixture.project().takeGroups[0]?.compRegions.map(({ startSample, endSample }) => (
		[startSample, endSample]
	)), [[100, 225], [225, 300], [325, 500]]);
});

test('flatten renders only the comp partition, persists exact media, and publishes once', async () => {
	const fixture = compositionFixture();
	const result = await fixture.composition.flatten('group-a');
	assert.equal(fixture.renderedProjects.length, 1);
	const rendered = fixture.renderedProjects[0]!;
	assert.deepEqual(rendered.clips.map((clip) => ({
		sourceId: clip.sourceId,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		durationFrames: clip.durationFrames,
	})), [{
		sourceId: 'source-a', timelineStartFrame: 100, sourceStartFrame: 0, durationFrames: 400,
	}]);
	assert.deepEqual(fixture.renderRanges, [{
		startFrame: 100, endFrame: 500, includeMaster: false,
		includeTrackPan: false, respectMuteSolo: false,
	}]);
	assert.equal(result.publication.source.frameCount, 400);
	assert.equal(result.publication.clip.timelineStartFrame, 100);
	assert.equal(result.publication.clip.durationFrames, 400);
	assert.deepEqual(fixture.commands.map(({ type }) => type), ['take-comp/flatten']);
	assert.deepEqual(fixture.project().takeGroups, []);
	assert.equal(fixture.project().clips.some(({ id }) => id === result.publication.clip.id), true);
	assert.deepEqual(fixture.rollbacks, []);
});

test('locked and stale flatten attempts fail before publication and roll back persisted media', async () => {
	const locked = compositionFixture({ locked: true });
	await assert.rejects(() => locked.composition.flatten('group-a'), /locked/iu);
	assert.equal(locked.renderedProjects.length, 0);

	let mutateDuringRender = false;
	const stale = compositionFixture({
		onRender: () => {
			if (!mutateDuringRender) return;
			mutateDuringRender = false;
			stale.composition.promoteTake('group-a', {
				takeId: 'take-b', startSample: 200, endSample: 300,
			});
		},
	});
	mutateDuringRender = true;
	await assert.rejects(() => stale.composition.flatten('group-a'), /changed after flatten rendering began/iu);
	assert.equal(stale.commands.filter(({ type }) => type === 'take-comp/flatten').length, 0);
	assert.deepEqual(stale.rollbacks, [['flat-source']]);

	const switched = compositionFixture({ switchProjectAfterPersist: true });
	await assert.rejects(() => switched.composition.flatten('group-a'), /project changed/iu);
	assert.equal(switched.commands.length, 0);
	assert.deepEqual(switched.rollbacks, [['flat-source']]);
});

interface PreviewEngineFixture {
	readonly loaded: unknown[];
	playCount: number;
	pauseCount: number;
	stopCount: number;
	disposeCount: number;
	emit(state: string): void;
}

function compositionFixture(options: Readonly<{
	locked?: boolean;
	onRender?(): void;
	switchProjectAfterPersist?: boolean;
	previewPlayFails?: boolean;
}> = {}) {
	let current = project(options.locked === true);
	const commands: AudioEditorCommand[] = [];
	const previewEngines: PreviewEngineFixture[] = [];
	const renderedProjects: Array<AudioEditorProjectV17> = [];
	const renderRanges: Array<Readonly<Record<string, unknown>>> = [];
	const rollbacks: string[][] = [];
	const ids = new Map<string, number>();
	let playbackStops = 0;
	const lifetime = new EditorControllerLifetime();
	const buffer = audioBuffer(400);
	const composition = createTakeCompControllerComposition({
		lifetime,
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		sourceResolver: null,
		derivedSources: {
			async persistRenderedMixSource(rendered: AudioBufferLike) {
				assert.equal(rendered, buffer);
				const record = {
					source: {
						id: 'flat-source', storageKey: 'flat-source', name: 'Flat source', mimeType: 'audio/wav',
						frameCount: rendered.length, channelCount: rendered.numberOfChannels,
						sampleRate: rendered.sampleRate, originalSampleRate: rendered.sampleRate,
						sampleFormat: 'float32', chunkFrames: 65_536,
					},
					buffer: rendered,
					channels: [rendered.getChannelData(0)],
				};
				if (options.switchProjectAfterPersist) current = { ...current, id: 'other-project' };
				return record;
			},
			async rollbackDerivedSources(records: readonly Pick<DerivedSourceRecord, 'source'>[]) {
				rollbacks.push(records.map(({ source }) => source.id));
			},
		} as never,
		getProject: () => current,
		editingBlocked: () => false,
		commit(command) {
			const next = applyEditorCommand(current, command, { now: NOW }) as AudioEditorProjectV17;
			commands.push(command);
			current = next;
			return current;
		},
		createId(prefix) {
			const count = (ids.get(prefix) ?? 0) + 1;
			ids.set(prefix, count);
			return `${prefix}-${String(count)}`;
		},
		captureProject: () => ({ generation: 1, projectId: current.id }),
		assertProject: (token) => {
			if (token.projectId !== current.id) throw new Error('project changed');
		},
		createPreviewEngine({ onState }) {
			const fixture: PreviewEngineFixture = {
				loaded: [], playCount: 0, pauseCount: 0, stopCount: 0, disposeCount: 0,
				emit: onState,
			};
			previewEngines.push(fixture);
			return {
				loadProject(value) { fixture.loaded.push(value); },
				setSourceResolver: () => undefined,
				async play() {
					fixture.playCount += 1;
					if (options.previewPlayFails) throw new Error('preview play failed');
				},
				pause() { fixture.pauseCount += 1; },
				stop() { fixture.stopCount += 1; },
				async dispose() { fixture.disposeCount += 1; },
			};
		},
		stopPlayback: () => { playbackStops += 1; },
		async renderSnapshot(value, range, _sourceBuffers, _signal, _chunkSources, prepareTimePitchCaches) {
			assert.equal(prepareTimePitchCaches, false, 'the isolated render has no committed cache ownership');
			renderedProjects.push(value as unknown as AudioEditorProjectV17);
			renderRanges.push(range);
			options.onRender?.();
			return buffer;
		},
	});
	return {
		composition, commands, previewEngines, renderedProjects, renderRanges, rollbacks,
		project: () => current,
		get playbackStops() { return playbackStops; },
	};
}

function project(locked: boolean): AudioEditorProjectV17 {
	return createAudioEditorProjectV17({
		id: 'take-ui-project', title: 'Take UI project', now: NOW,
		sources: [
			createAudioSource({
				id: 'source-a', storageKey: 'source-a', name: 'Take A',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSource({
				id: 'source-b', storageKey: 'source-b', name: 'Take B',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrack({
			id: 'track-a', name: 'Vocal', clipIds: [], locked,
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'group-a', sequenceId: 'main-sequence', trackId: 'track-a',
			startSample: 100, endSample: 500,
			laneOrder: ['lane-a', 'lane-b'],
			lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
			takes: [
				{
					id: 'take-a', laneId: 'lane-a', sourceId: 'source-a',
					startSample: 100, endSample: 500, sourceStartSample: 0,
				},
				{
					id: 'take-b', laneId: 'lane-b', sourceId: 'source-b',
					startSample: 100, endSample: 500, sourceStartSample: 25,
				},
			],
			compRegions: [{
				id: 'original', takeId: 'take-a', startSample: 100, endSample: 500,
			}],
		}],
	});
}

function audioBuffer(length: number): AudioBufferLike {
	const channel = new Float32Array(length);
	return {
		length,
		numberOfChannels: 1,
		sampleRate: 48_000,
		getChannelData: () => channel,
	};
}
