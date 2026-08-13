import assert from 'node:assert/strict';
import test from 'node:test';

import * as commandFacade from '../src/common/editor/commands.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	AUDIO_WARP_COMMAND_TYPES,
	CLIP_RANGE_CLIPBOARD_COMMAND_TYPES,
	EFFECTS_VIDEO_COMMAND_TYPES,
	PROJECT_SOURCE_BIN_COMMAND_TYPES,
	SEQUENCE_TIMING_COMMAND_TYPES,
	TAKE_COMP_COMMAND_TYPES,
	TEMPO_SIGNATURE_COMMAND_TYPES,
	TIMELINE_ANNOTATION_COMMAND_TYPES,
	VIDEO_COMPOSITION_COMMAND_TYPES,
	VIDEO_KEYFRAMES_COMMAND_TYPES,
	TRACK_FOLDER_COMMAND_TYPES,
	TRACK_MIXER_LABEL_COMMAND_TYPES,
	defineEditorCommandHandlerRegistry,
	dispatchEditorCommand,
	type EditorCommandHandlerDomains,
} from '../src/common/editor/commands/registry.ts';
import {
	AUDIO_EDITOR_COMMAND_TYPES,
	type AudioEditorCommand,
} from '../src/common/editor/commands/protocol.ts';
import { createEditorCommandRuntime } from '../src/common/editor/commands/runtime-registry.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioEditorProjectV2 } from '../src/common/editor/project-v2.js';

const NOW = '2026-07-26T12:00:00.000Z';

test('command domains partition the authoritative protocol exactly once', () => {
	const domainTypes = [
		...PROJECT_SOURCE_BIN_COMMAND_TYPES,
		...TEMPO_SIGNATURE_COMMAND_TYPES,
		...SEQUENCE_TIMING_COMMAND_TYPES,
		...TRACK_MIXER_LABEL_COMMAND_TYPES,
		...TRACK_FOLDER_COMMAND_TYPES,
		...TAKE_COMP_COMMAND_TYPES,
		...AUDIO_WARP_COMMAND_TYPES,
		...CLIP_RANGE_CLIPBOARD_COMMAND_TYPES,
		...EFFECTS_VIDEO_COMMAND_TYPES,
		...TIMELINE_ANNOTATION_COMMAND_TYPES,
		...VIDEO_COMPOSITION_COMMAND_TYPES,
		...VIDEO_KEYFRAMES_COMMAND_TYPES,
	];
	assert.equal(AUDIO_EDITOR_COMMAND_TYPES.length, 92);
	assert.equal(new Set(domainTypes).size, domainTypes.length, 'a command type belongs to only one domain');
	assert.deepEqual([...domainTypes].sort(), [...AUDIO_EDITOR_COMMAND_TYPES].sort());
});

test('the decomposed runtime registry remains exhaustive', () => {
	const registry = createEditorCommandRuntime(() => undefined);
	assert.deepEqual(Object.keys(registry).sort(), [...AUDIO_EDITOR_COMMAND_TYPES].sort());
});

test('the compatibility facade keeps its established public command surface', () => {
	assert.deepEqual(Object.keys(commandFacade).sort(), [
		'applyEditorCommand',
		'collectClipTransformIds',
		'collectClipTrimIds',
		'collectRelatedClipIds',
		'createAddClipCommand',
		'createAddLabelCommand',
		'createAddLabelTrackCommand',
		'createAddSignatureEventCommand',
		'createAddSourceCommand',
		'createAddTempoEventCommand',
		'createAddTimelineAnnotationCommand',
		'createAddTrackCommand',
		'createAddTrackFolderCommand',
		'createAddVideoEffectCommand',
		'createBypassVideoEffectCommand',
		'createBatchSetTimelineAnnotationsCommand',
		'createConvertTimelineAnnotationCommand',
		'createClipboardDescriptor',
		'createRemoveVideoEffectCommand',
		'createRemoveSignatureEventCommand',
		'createRemoveTempoEventCommand',
		'createRemoveTimelineAnnotationsCommand',
		'createRemoveTrackFolderCommand',
		'createMoveTimelineAnnotationsCommand',
		'createMoveTrackNodeCommand',
		'createReorderVideoEffectCommand',
		'createReplaceClipSourceCommand',
		'createResizeTimelineAnnotationCommand',
		'createSetTempoMapModeCommand',
		'createSetVideoKeyframesCommand',
		'createUpdateSequenceTimingCommand',
		'createUpdateSignatureEventCommand',
		'createUpdateTempoEventCommand',
		'createUpdateTimelineAnnotationsCommand',
		'createUpdateTrackFolderCommand',
		'createUpdateVideoEffectCommand',
		'prepareCut',
		'prepareDisjointRangeDeleteCommand',
		'prepareGroupClipsCommand',
		'prepareKeepRangeCommand',
		'prepareLinkAvCommand',
		'prepareLinkedSplitCommand',
		'prepareOverwriteClipCommand',
		'preparePasteCommand',
		'preparePunchCommand',
		'prepareRangeDeleteCommand',
		'prepareRangeReplacementCommand',
		'prepareSplitCommand',
		'prepareTransformClipsCommand',
		'prepareUnlinkAvCommand',
		'resolveEditingSelection',
	].sort());
});

test('the exhaustive registry rejects a missing handler and dispatches every declared type', () => {
	const calls: string[] = [];
	const handlers = Object.fromEntries(AUDIO_EDITOR_COMMAND_TYPES.map((type) => [
		type,
		(_project: unknown, command: { type: string }) => calls.push(command.type),
	]));
	const domains = domainHandlers(handlers);
	const registry = defineEditorCommandHandlerRegistry(domains);
	for (const type of AUDIO_EDITOR_COMMAND_TYPES) {
		dispatchEditorCommand(registry, {}, { type } as AudioEditorCommand);
	}
	assert.deepEqual(calls, AUDIO_EDITOR_COMMAND_TYPES);

	const incomplete = domainHandlers(handlers);
	const incompleteEffects = { ...incomplete.effectsVideo } as Record<string, unknown>;
	delete incompleteEffects['video-effect/reorder'];
	assert.throws(
		() => defineEditorCommandHandlerRegistry({
			...incomplete,
			effectsVideo: incompleteEffects,
		} as unknown as EditorCommandHandlerDomains),
		/video-effect\/reorder/,
	);
});

test('the commands.js facade preserves cross-domain batch semantics with one commit', () => {
	const original = createAudioEditorProjectV2({ id: 'command-registry', title: 'Before', now: NOW });
	const command = {
		type: 'batch',
		commands: [{
			type: 'project/rename', title: 'Registry-backed edit',
		}, {
			type: 'source/add',
			source: {
				id: 'source', storageKey: 'source', name: 'Source', frameCount: 100, channelCount: 1,
			},
		}, {
			type: 'track/add', track: { id: 'track', name: 'Track' },
		}, {
			type: 'clip/add',
			trackId: 'track',
			clip: { id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 100 },
		}, {
			type: 'effect/add',
			scope: 'track',
			trackId: 'track',
			effect: createEffect('audacity-invert', { id: 'invert' }),
		}],
	} satisfies AudioEditorCommand;

	const edited = applyEditorCommand(original, command, { now: NOW });
	assert.equal(edited.revision, original.revision + 1);
	assert.equal(edited.title, 'Registry-backed edit');
	assert.deepEqual(edited.sources.map((source) => source.id), ['source']);
	const track = edited.tracks.find((candidate) => candidate.id === 'track');
	if (!track || track.type !== 'audio') assert.fail('Expected the batch to add an audio track.');
	assert.deepEqual(track.clipIds, ['clip']);
	assert.equal((track.effects[0] as { id?: unknown }).id, 'invert');
});

test('a failing child leaves an atomic batch input untouched', () => {
	const original = createAudioEditorProjectV2({ id: 'atomic-command', title: 'Before', now: NOW });
	const snapshot = structuredClone(original);
	const command = {
		type: 'batch',
		commands: [
			{ type: 'project/rename', title: 'Must roll back' },
			{ type: 'track/remove', trackId: 'missing-track' },
		],
	} satisfies AudioEditorCommand;

	assert.throws(() => applyEditorCommand(original, command, { now: NOW }), /Unknown track/);
	assert.deepEqual(original, snapshot);
});

function domainHandlers(handlers: Record<string, unknown>): EditorCommandHandlerDomains {
	return {
		projectSourceBin: pick(handlers, PROJECT_SOURCE_BIN_COMMAND_TYPES),
		tempoSignature: pick(handlers, TEMPO_SIGNATURE_COMMAND_TYPES),
		sequenceTiming: pick(handlers, SEQUENCE_TIMING_COMMAND_TYPES),
		trackMixerLabel: pick(handlers, TRACK_MIXER_LABEL_COMMAND_TYPES),
		trackFolder: pick(handlers, TRACK_FOLDER_COMMAND_TYPES),
		takeComp: pick(handlers, TAKE_COMP_COMMAND_TYPES),
		audioWarp: pick(handlers, AUDIO_WARP_COMMAND_TYPES),
		clipRangeClipboard: pick(handlers, CLIP_RANGE_CLIPBOARD_COMMAND_TYPES),
		effectsVideo: pick(handlers, EFFECTS_VIDEO_COMMAND_TYPES),
		timelineAnnotation: pick(handlers, TIMELINE_ANNOTATION_COMMAND_TYPES),
		videoComposition: pick(handlers, VIDEO_COMPOSITION_COMMAND_TYPES),
		videoKeyframes: pick(handlers, VIDEO_KEYFRAMES_COMMAND_TYPES),
	} as unknown as EditorCommandHandlerDomains;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	return Object.fromEntries(keys.flatMap((key) => key in source ? [[key, source[key]]] : []));
}
