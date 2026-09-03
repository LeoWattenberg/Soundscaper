/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	prepareMixRenderOperationCommit,
	type MixRenderOperationCommit,
} from '../src/common/editor/controller/mix-render-commit.ts';
import {
	createMixRenderSnapshot,
	mixRenderTailFrames,
	v21StripLaneRemovalCommands,
} from '../src/common/editor/controller/mix-render-model.ts';
import { normalizeMixRenderOptions } from '../src/common/editor/controller/mix-render-options.ts';
import { preserveProductionMixRenderRouting } from '../src/common/editor/controller/mix-render-routing.ts';
import type {
	ControllerProject,
	ControllerSource,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-09-03T00:00:00.000Z';

test('individual V21 prints retain their rack sidechain but exclude downstream buses and effect lanes when dry', () => {
	const project = routedProductionProject();
	const voice = project.tracks.find(({ id }) => id === 'voice')! as unknown as ControllerTrack;
	const individual = createMixRenderSnapshot(
		project as unknown as ControllerProject,
		[voice],
		{ mixDown: false, renderEffects: true },
	) as unknown as typeof project;
	assert.deepEqual(individual.tracks.map(({ id }) => id), ['voice', 'control']);
	assert.deepEqual(individual.mixer.groups, []);
	assert.deepEqual(individual.mixer.sends, []);
	assert.equal(individual.mixer.edges.some(({ id }) => id === 'control-voice-duck'), true);
	assert.equal(individual.mixer.edges.some(({ id }) => id === 'voice-relevant'), false);

	const combined = createMixRenderSnapshot(
		project as unknown as ControllerProject,
		[voice],
		{ mixDown: true, renderEffects: true },
	) as unknown as typeof project;
	assert.deepEqual(combined.mixer.groups.map(({ id }) => id), ['relevant']);
	assert.equal(combined.mixer.edges.some(({ id }) => id === 'control-voice-duck'), true);
	assert.equal(mixRenderTailFrames(
		[voice], combined as unknown as ControllerProject, 48_000,
		(effects) => effects.some(({ type }) => type === 'reverb') ? 200 : 0,
		{ includeBuses: true, renderEffects: true },
	), 0);

	const dry = createMixRenderSnapshot(
		project as unknown as ControllerProject,
		[voice],
		{ mixDown: false, renderEffects: false },
	) as unknown as typeof project;
	assert.deepEqual(dry.tracks.map(({ id }) => id), ['voice']);
	assert.deepEqual(dry.automationLanes.map(({ id }) => id), ['voice-gain']);
	assert.deepEqual(v21StripLaneRemovalCommands(project as unknown as ControllerProject, 'voice')
		.map((command) => command.type === 'automation-lane/set' ? command.laneId : null), [
		'voice-gain', 'voice-filter-frequency',
	]);
});

test('a frozen production track is atomically unfrozen and neutralized by an in-place individual print', () => {
	const project = frozenProductionProject();
	const voice = project.tracks[0]! as unknown as ControllerTrack;
	let sequence = 0;
	const prepared = prepareMixRenderOperationCommit(
		project as unknown as ControllerProject,
		[{ targetTracks: [voice], source: renderedSource('printed', 2), startFrame: 0, name: 'Voice' }],
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals: true }),
		{ createId: (prefix) => `${prefix}-${++sequence}` },
	);
	const removeFreeze = prepared.command.commands.find(({ type }) => type === 'audio-freeze/remove');
	assert.equal(removeFreeze?.type, 'audio-freeze/remove');
	if (removeFreeze?.type !== 'audio-freeze/remove') assert.fail('Expected an exact freeze removal.');
	assert.deepEqual(removeFreeze.expectedFreeze, voice.audioFreeze);

	const applied = applySoundscaperProjectCommand(project, prepared.command, { now: NOW });
	const printed = applied.tracks.find(({ id }) => id === 'voice')!;
	assert.equal(Object.hasOwn(printed, 'audioFreeze'), false);
	assert.deepEqual(printed.clipIds, [prepared.results[0]!.clipId]);
	assert.deepEqual(printed.effects, []);
	assert.deepEqual(applied.automationLanes, []);
	assert.deepEqual(
		{ gain: printed.gain, pan: printed.pan, mute: printed.mute, solo: printed.solo, armed: printed.armed },
		{ gain: 1, pan: 0, mute: false, solo: false, armed: false },
	);
	const sibling = prepareMixRenderOperationCommit(
		project as unknown as ControllerProject,
		[{ targetTracks: [voice], source: renderedSource('sibling-print', 2), startFrame: 0,
			name: 'Voice — Rendered' }],
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals: false }),
		{ createId: (prefix) => `${prefix}-${++sequence}` },
	).command.commands.find(({ type }) => type === 'track/add');
	assert.equal(sibling?.type, 'track/add');
	if (sibling?.type === 'track/add') assert.equal(Object.hasOwn(sibling.track, 'audioFreeze'), false);
});

test('two individual siblings execute immediately after their originals in one folder', () => {
	const project = folderedCurrentProject();
	const targets = project.tracks.filter(({ id }) => id === 'first' || id === 'second') as ControllerTrack[];
	let sequence = 0;
	const prepared = prepareMixRenderOperationCommit(
		project as unknown as ControllerProject,
		targets.map((target) => ({
			targetTracks: [target], source: renderedSource(`${target.id}-print`, 1),
			startFrame: 0, name: `${target.name} — Rendered`,
		})),
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals: false }),
		{ createId: (prefix) => `${prefix}-${++sequence}` },
	);
	const applied = applyEditorCommand(project, prepared.command as AudioEditorCommand, { now: NOW });
	assert.deepEqual(applied.tracks.map(({ id }) => id), [
		'first', prepared.results[0]!.trackId, 'second', prepared.results[1]!.trackId, 'outside',
	]);
	const nodes = applied.sequences[0]!.trackNodes;
	assert.deepEqual(nodes.map(({ id, parentFolderId }) => ({ id, parentFolderId })), [
		{ id: 'folder', parentFolderId: null },
		{ id: 'first', parentFolderId: 'folder' },
		{ id: prepared.results[0]!.trackId, parentFolderId: 'folder' },
		{ id: 'second', parentFolderId: 'folder' },
		{ id: prepared.results[1]!.trackId, parentFolderId: 'folder' },
		{ id: 'outside', parentFolderId: null },
	]);
});

test('combined folder renders are rehomed after the folder and route only to master', () => {
	for (const replaceOriginals of [false, true]) {
		const project = folderedProductionProject();
		const targets = project.tracks as unknown as ControllerTrack[];
		let sequence = 0;
		let prepared = prepareMixRenderOperationCommit(
			project as unknown as ControllerProject,
			[{ targetTracks: targets, source: renderedSource(`folder-mix-${String(replaceOriginals)}`, 2),
				startFrame: 0, name: 'Mix' }],
			normalizeMixRenderOptions({ mixDown: true, renderEffects: true, replaceOriginals }),
			{ createId: (prefix) => `${prefix}-${++sequence}` },
		);
		prepared = routedCommit(project, prepared, () => ++sequence);
		const applied = applySoundscaperProjectCommand(project, prepared.command, { now: NOW });
		const trackId = prepared.results[0]!.trackId;
		assert.deepEqual(applied.sequences[0]!.trackNodes.map(({ id, parentFolderId }) => ({
			id, parentFolderId,
		})), [
			{ id: 'folder', parentFolderId: null },
			...(replaceOriginals ? [] : [
				{ id: 'first', parentFolderId: 'folder' },
				{ id: 'second', parentFolderId: 'folder' },
			]),
			{ id: trackId, parentFolderId: null },
		]);
		assertDirectOnly(applied, trackId);
	}
});

test('a destructive single combined folder print moves its compatible identity to the root', () => {
	const project = folderedProductionProject();
	const target = project.tracks[0]! as unknown as ControllerTrack;
	let sequence = 0;
	let prepared = prepareMixRenderOperationCommit(
		project as unknown as ControllerProject,
		[{ targetTracks: [target], source: renderedSource('single-folder-mix', 2),
			startFrame: 0, name: target.name }],
		normalizeMixRenderOptions({ mixDown: true, renderEffects: true, replaceOriginals: true }),
		{ createId: (prefix) => `${prefix}-${++sequence}` },
	);
	prepared = routedCommit(project, prepared, () => ++sequence);
	const applied = applySoundscaperProjectCommand(project, prepared.command, { now: NOW });
	assert.equal(prepared.results[0]!.trackId, 'first');
	assert.deepEqual(applied.sequences[0]!.trackNodes.map(({ id, parentFolderId }) => ({
		id, parentFolderId,
	})), [
		{ id: 'folder', parentFolderId: null },
		{ id: 'second', parentFolderId: 'folder' },
		{ id: 'first', parentFolderId: null },
	]);
	assertDirectOnly(applied, 'first');
});

test('production route restatement removes combined sidechains and widens individual sibling maps', () => {
	const project = widthChangingProductionProject();
	const target = project.tracks.find(({ id }) => id === 'voice')! as unknown as ControllerTrack;
	let sequence = 0;
	const stage = (mixDown: boolean, replaceOriginals: boolean) => {
		let prepared = prepareMixRenderOperationCommit(
			project as unknown as ControllerProject,
			[{ targetTracks: [target], source: renderedSource('stereo-print', 2), startFrame: 0,
				name: mixDown ? 'Voice' : 'Voice — Rendered' }],
			normalizeMixRenderOptions({ mixDown, renderEffects: true, replaceOriginals }),
			{ createId: (prefix) => `${prefix}-${++sequence}` },
		);
		prepared = preserveProductionMixRenderRouting(
			project as unknown as ControllerProject,
			prepared,
			(candidate, command) => applySoundscaperProjectCommand(candidate, command, { now: NOW }) as never,
			(prefix) => `${prefix}-${++sequence}`,
		);
		return { prepared, applied: applySoundscaperProjectCommand(project, prepared.command, { now: NOW }) };
	};
	const combined = stage(true, true);
	const combinedOutgoing = combined.applied.mixer.edges.filter((edge) => edge.source.kind === 'track'
		&& edge.source.id === 'voice');
	assert.equal(combinedOutgoing.length, 1);
	assert.equal(combinedOutgoing[0]?.destination.kind, 'master');

	const individual = stage(false, false);
	const siblingId = individual.prepared.results[0]!.trackId;
	const siblingRoutes = individual.applied.mixer.edges.filter((edge) => edge.source.kind === 'track'
		&& edge.source.id === siblingId);
	assert.equal(siblingRoutes.some(({ destination }) => destination.kind === 'effect-sidechain'), true);
	assert.equal(siblingRoutes.find(({ destination }) => destination.kind === 'master')?.id,
		`assignment:track:${siblingId}:master`);
	assert.deepEqual(siblingRoutes.map(({ channelMap }) => [...channelMap]), [[0, 1], [0, 1]]);
});

function routedProductionProject() {
	const tracks = [
		createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [
			{ id: 'voice-filter', type: 'highpass', enabled: true, params: { frequency: 200, q: 1 } },
			{ id: 'voice-duck', type: 'audacity-auto-duck', enabled: true, params: {},
				context: { controlTrackId: 'control' } },
		] }),
		createAudioTrack({ id: 'control', name: 'Control', clipIds: ['control-clip'] }),
		createAudioTrack({ id: 'other', name: 'Other', clipIds: ['other-clip'] }),
	];
	return createSoundscaperProject({
		id: 'routed', title: 'Routed', now: NOW,
		sources: tracks.map(({ id }) => mediaSource(`${id}-source`)),
		clips: tracks.map(({ id }) => mediaClip(`${id}-clip`, `${id}-source`)), tracks,
		sequences: [{ id: 'main-sequence', trackIds: tracks.map(({ id }) => id) }],
		primarySequenceId: 'main-sequence',
		mixer: graph(tracks, [strip('relevant', []), strip('irrelevant', [
			{ id: 'irrelevant-reverb', type: 'reverb', enabled: true, params: {} },
		])], [
			edge('voice-relevant', 'assignment', terminal('track', 'voice'), terminal('mixer-node', 'relevant')),
			edge('relevant-master', 'assignment', terminal('mixer-node', 'relevant'), { kind: 'master' }),
			edge('other-irrelevant', 'assignment', terminal('track', 'other'), terminal('mixer-node', 'irrelevant')),
			edge('irrelevant-master', 'assignment', terminal('mixer-node', 'irrelevant'), { kind: 'master' }),
			edge('control-master', 'assignment', terminal('track', 'control'), { kind: 'master' }),
			edge('control-voice-duck', 'sidechain', terminal('track', 'control'), {
				kind: 'effect-sidechain', strip: terminal('track', 'voice'), effectId: 'voice-duck',
			}),
		]),
		automationLanes: [
			lane('voice-gain', { kind: 'strip', strip: terminal('track', 'voice'), parameterId: 'gain' }),
			lane('voice-filter-frequency', { kind: 'effect', strip: terminal('track', 'voice'),
				effectId: 'voice-filter', parameterId: 'frequency' }, 200),
		],
	});
}

function frozenProductionProject() {
	const digest = 'ab'.repeat(32);
	const live = mediaSource('voice-source', 1, digest);
	const frozen = mediaSource('voice-freeze', 1, digest);
	const clip = mediaClip('voice-clip', live.id);
	const track = createAudioTrack({
		id: 'voice', name: 'Voice', clipIds: [clip.id],
		effects: [{ id: 'voice-filter', type: 'highpass', enabled: true,
			params: { frequency: 200, q: 1 } }],
		audioFreeze: {
			schemaVersion: 1, derivedSourceId: frozen.id, inputDigestSha256: digest,
			rackDigestSha256: digest, automationDigestSha256: digest, freshnessDigestSha256: digest,
			renderStartFrame: 0, renderFrameCount: 4, capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProject({
		id: 'frozen', title: 'Frozen', now: NOW, sources: [live, frozen], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }], primarySequenceId: 'main-sequence',
		automationLanes: [
			lane('voice-gain', { kind: 'strip', strip: terminal('track', 'voice'), parameterId: 'gain' }),
			lane('voice-filter-frequency', { kind: 'effect', strip: terminal('track', 'voice'),
				effectId: 'voice-filter', parameterId: 'frequency' }, 200),
		],
	});
}

function folderedCurrentProject() {
	return createCurrentAudioEditorProject({
		id: 'foldered-current', title: 'Foldered current', now: NOW,
		sources: ['first', 'second', 'outside'].map((id) => mediaSource(`${id}-source`)),
		clips: ['first', 'second', 'outside'].map((id) => mediaClip(`${id}-clip`, `${id}-source`)),
		tracks: ['first', 'second', 'outside'].map((id) => createAudioTrack({
			id, name: id, clipIds: [`${id}-clip`],
		})),
		trackFolders: [{ id: 'folder', name: 'Folder' }],
		sequences: [{ id: 'main-sequence', trackNodes: [
			{ kind: 'folder', id: 'folder', parentFolderId: null },
			{ kind: 'track', id: 'first', parentFolderId: 'folder' },
			{ kind: 'track', id: 'second', parentFolderId: 'folder' },
			{ kind: 'track', id: 'outside', parentFolderId: null },
		] }], primarySequenceId: 'main-sequence',
	});
}

function folderedProductionProject() {
	const sources = ['first', 'second'].map((id) => mediaSource(`${id}-source`));
	const clips = ['first', 'second'].map((id) => mediaClip(`${id}-clip`, `${id}-source`));
	const tracks = ['first', 'second'].map((id) => createAudioTrack({
		id, name: id, clipIds: [`${id}-clip`],
	}));
	return createSoundscaperProject({
		id: 'foldered-production', title: 'Foldered production', now: NOW,
		sources, clips, tracks,
		trackFolders: [{ id: 'folder', name: 'Folder' }],
		sequences: [{ id: 'main-sequence', trackNodes: [
			{ kind: 'folder', id: 'folder', parentFolderId: null },
			{ kind: 'track', id: 'first', parentFolderId: 'folder' },
			{ kind: 'track', id: 'second', parentFolderId: 'folder' },
		] }], primarySequenceId: 'main-sequence',
	});
}

function widthChangingProductionProject() {
	const voice = createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], pan: 0.5 });
	const host = createAudioTrack({ id: 'host', name: 'Host', clipIds: ['host-clip'], effects: [{
		id: 'host-duck', type: 'audacity-auto-duck', enabled: true, params: {},
		context: { controlTrackId: 'voice' },
	}] });
	return createSoundscaperProject({
		id: 'width-changing', title: 'Width changing', now: NOW,
		sources: [mediaSource('voice-source'), mediaSource('host-source', 2)],
		clips: [mediaClip('voice-clip', 'voice-source'), mediaClip('host-clip', 'host-source')],
		tracks: [voice, host], sequences: [{ id: 'main-sequence', trackIds: ['voice', 'host'] }],
		primarySequenceId: 'main-sequence', mixer: graph([voice, host], [], [
			{ ...edge('assignment:track:voice:master', 'assignment', terminal('track', 'voice'),
				{ kind: 'master' }), channelMap: [0, 0] },
			edge('assignment:track:host:master', 'assignment', terminal('track', 'host'), { kind: 'master' }),
			{ ...edge('voice-host-duck', 'sidechain', terminal('track', 'voice'), {
				kind: 'effect-sidechain', strip: terminal('track', 'host'), effectId: 'host-duck',
			}), channelMap: [0, 0] },
		]),
	});
}

function graph(tracks: readonly { readonly id: string }[], groups: readonly unknown[], routes: readonly unknown[]) {
	return {
		schemaVersion: 1, groups, sends: [], cues: [], vcas: [],
		outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
		edges: [...routes, edge('master-main', 'assignment', { kind: 'master' }, terminal('output', 'main'))],
	};
}

function routedCommit(
	project: ReturnType<typeof createSoundscaperProject>,
	prepared: Readonly<MixRenderOperationCommit>,
	next: () => number,
): Readonly<MixRenderOperationCommit> {
	return preserveProductionMixRenderRouting(
		project as unknown as ControllerProject,
		prepared,
		(candidate, command) => applySoundscaperProjectCommand(candidate, command, { now: NOW }) as never,
		(prefix) => `${prefix}-${String(next())}`,
	);
}

function assertDirectOnly(project: ReturnType<typeof createSoundscaperProject>, trackId: string): void {
	const outgoing = project.mixer.edges.filter((edge) => edge.source.kind === 'track'
		&& edge.source.id === trackId);
	assert.equal(outgoing.length, 1);
	assert.equal(outgoing[0]?.destination.kind, 'master');
}

function strip(id: string, effects: readonly unknown[]) {
	return { id, name: id, color: '#808080', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects, channelCount: 2 };
}

function edge(id: string, kind: string, source: unknown, destination: unknown) {
	return { id, kind, source, destination, position: 'post-fader', level: 1, enabled: true, channelMap: [] };
}

function terminal(kind: string, id: string) { return { kind, id }; }

function lane(id: string, address: unknown, value = 1) {
	return { id, address, timebase: 'absolute-samples',
		points: [{ id: `${id}-start`, position: 0, value }], segments: [] };
}

function mediaSource(id: string, channelCount = 1, contentSha256?: string) {
	return createAudioSource({
		id, storageKey: id, name: id, mimeType: 'audio/wav', frameCount: 4, channelCount,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		...(contentSha256 ? { contentSha256 } : {}),
	});
}

function mediaClip(id: string, sourceId: string) {
	return createAudioClip({ id, sourceId, title: id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 });
}

function renderedSource(id: string, channelCount: number): ControllerSource {
	return mediaSource(id, channelCount) as unknown as ControllerSource;
}
