/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	assertEditorCommandCapabilities,
	type EditorCommandCapabilities,
} from '../src/common/editor/controller/command-capability-policy.ts';

const enabled: EditorCommandCapabilities = {
	audioEffects: true,
	audioRecording: true,
	audioSpectralEditing: true,
	audioWarp: true,
	takeComp: true,
	timelineAnnotations: true,
	trackFolders: true,
	videoEffects: true,
	videoGeometry: true,
};
const authoredWarpMap = { feature: 'audio-warp', points: [
	{ outer: 0, source: 0, mode: 'forward' },
	{ outer: 1, source: 1, mode: 'forward' },
] };
const authoredVideoComposition = {
	schemaVersion: 1,
	crop: { left: 0.1, top: 0, right: 0, bottom: 0 },
	transform: {
		anchorX: 0.5, anchorY: 0.5, positionX: 0.5, positionY: 0.5,
		scaleX: 1, scaleY: 1, rotationDegrees: 0,
		flipHorizontal: false, flipVertical: false,
	},
	opacity: 1,
	blendMode: 'normal',
	compositingOrder: 0,
};

test('command capability policy accepts unrestricted commands and recursively validates batches', () => {
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		{ type: 'project/rename', title: 'Allowed' },
		enabled,
		'Soundscaper',
	));

	const nested: AudioEditorCommand = {
		type: 'batch',
		commands: [{
			type: 'batch',
			commands: [{ type: 'video-effect/remove', clipId: 'clip', effectId: 'effect' }],
		}],
	};
	assert.throws(
		() => assertEditorCommandCapabilities(nested, { ...enabled, videoEffects: false }, 'Audio only'),
		/Audio only does not support videoEffects\./u,
	);
	const nestedAnnotation: AudioEditorCommand = {
		type: 'batch',
		commands: [{
			type: 'batch',
			commands: [{ type: 'timeline-annotation/remove-many', annotationIds: ['annotation'] }],
		}],
	};
	assert.throws(
		() => assertEditorCommandCapabilities(
			nestedAnnotation,
			{ ...enabled, timelineAnnotations: false },
			'Framescaper',
		),
		/Framescaper does not support timelineAnnotations\./u,
	);
});

test('command capability policy covers every product-sensitive payload path', () => {
	const cases: ReadonlyArray<Readonly<{
		capability: keyof EditorCommandCapabilities;
		command: AudioEditorCommand;
	}>> = [
		{ capability: 'videoEffects', command: { type: 'video-effect/update', clipId: 'clip', effectId: 'effect', changes: {} } },
		{ capability: 'videoGeometry', command: {
			type: 'video-composition/set', clipId: 'clip',
			expectedComposition: {} as never, composition: {} as never,
		} },
		{ capability: 'videoGeometry', command: {
			type: 'clip/add', trackId: 'track',
			clip: { id: 'clip', kind: 'video', videoComposition: authoredVideoComposition },
		} },
		{ capability: 'videoGeometry', command: {
			type: 'project-bin/add',
			clip: { id: 'clip', kind: 'video', videoComposition: authoredVideoComposition },
		} },
		{ capability: 'videoGeometry', command: {
			type: 'clip/update', clipId: 'clip', changes: { videoComposition: authoredVideoComposition },
		} },
		{ capability: 'videoGeometry', command: {
			type: 'project-bin/update', clipId: 'clip', changes: { videoComposition: authoredVideoComposition },
		} },
		{ capability: 'videoGeometry', command: {
			type: 'clip/overwrite', clipId: 'clip', changes: { videoComposition: authoredVideoComposition },
		} },
		{ capability: 'videoGeometry', command: {
			type: 'clip/transform-many', transforms: [{
				clipId: 'clip', changes: { videoComposition: authoredVideoComposition },
			}],
		} },
		{ capability: 'videoEffects', command: { type: 'clip/update', clipId: 'clip', changes: { videoEffects: [] } } },
		{ capability: 'videoEffects', command: { type: 'clip/add', trackId: 'track', clip: { videoEffects: [{ id: 'effect' }] } } },
		{ capability: 'audioEffects', command: { type: 'effect/remove', scope: 'master', effectId: 'effect' } },
		{ capability: 'audioEffects', command: { type: 'track/add', track: { effects: [{ id: 'effect' }] } } },
		{ capability: 'audioEffects', command: { type: 'track/update', trackId: 'track', changes: { effects: [] } } },
		{ capability: 'audioEffects', command: { type: 'clip/update', clipId: 'clip', changes: { speedRatio: 2 } } },
		{ capability: 'audioEffects', command: { type: 'track/update', trackId: 'track', changes: { sampleRate: 44_100 } } },
		{ capability: 'audioEffects', command: { type: 'master/update', changes: { effects: [] } } },
		{ capability: 'audioEffects', command: { type: 'mixer/bus-add', busType: 'group', bus: { effects: [{ id: 'effect' }] } } },
		{ capability: 'audioEffects', command: { type: 'mixer/bus-update', busType: 'send', busId: 'send', changes: { effects: [] } } },
		{ capability: 'audioSpectralEditing', command: { type: 'track/update', trackId: 'track', changes: { displayMode: 'spectrogram' } } },
		{ capability: 'audioRecording', command: { type: 'track/update', trackId: 'track', changes: { armed: true } } },
		{ capability: 'timelineAnnotations', command: { type: 'timeline-annotation/remove-many', annotationIds: ['annotation'] } },
		{ capability: 'timelineAnnotations', command: { type: 'selection/set', startFrame: 0, endFrame: 0, annotationIds: [] } },
		{ capability: 'trackFolders', command: { type: 'track-folder/add', folder: { id: 'folder', name: 'Folder' }, sequenceId: 'main' } },
		{ capability: 'trackFolders', command: { type: 'track-folder/update', folderId: 'folder', changes: { name: 'Renamed' } } },
		{ capability: 'trackFolders', command: { type: 'track-folder/remove', folderId: 'folder', disposition: 'promote' } },
		{ capability: 'trackFolders', command: { type: 'track-node/move', sequenceId: 'main', nodeId: 'folder', parentFolderId: null, index: 0 } },
		{ capability: 'takeComp', command: { type: 'take-comp/group-add', group: { id: 'group' } } },
		{ capability: 'takeComp', command: { type: 'take-comp/group-remove', groupId: 'group' } },
		{ capability: 'audioWarp', command: { type: 'audio-warp/clear', clipId: 'clip', expectedClipAuthority: {} } },
		{ capability: 'audioWarp', command: { type: 'audio-warp/quantize', clipId: 'clip', expectedClipAuthority: {}, transientSources: [], options: {} } },
		{ capability: 'audioWarp', command: { type: 'clip/add', trackId: 'track', clip: { id: 'clip', warpMap: authoredWarpMap } } },
		{ capability: 'audioWarp', command: { type: 'project-bin/add', clip: { id: 'clip', warpMap: authoredWarpMap } } },
		{ capability: 'audioWarp', command: { type: 'clip/overwrite', clipId: 'clip', changes: { warpMap: authoredWarpMap } } },
		{ capability: 'audioWarp', command: {
			type: 'take-comp/flatten', groupId: 'group', operationId: 'operation', outputId: 'output',
			preFlattenSnapshot: {}, source: {}, clip: { id: 'clip', warpMap: authoredWarpMap },
		} },
	];

	for (const { capability, command } of cases) {
		assert.throws(
			() => assertEditorCommandCapabilities(command, { ...enabled, [capability]: false }, 'Limited'),
			new RegExp(`Limited does not support ${capability}\\.`),
			`${command.type} must require ${capability}`,
		);
	}
});

test('capability policy inspects clipboard clip warp maps across every supported schema', () => {
	for (const schemaVersion of [1, 2, 3, 4, 5] as const) {
		const clipboard = {
			schemaVersion,
			sampleRate: 48_000,
			durationFrames: 1,
			tracks: [{
				sourceTrackId: 'track', sourceTrackName: 'Track', sourceTrackType: 'audio' as const,
				sourceSequenceId: 'main', clips: [{ id: 'clip', warpMap: authoredWarpMap }],
			}],
			...(schemaVersion >= 3 ? { annotations: [] } : {}),
			...(schemaVersion >= 4 ? { takeGroups: [] } : {}),
		} as unknown as AudioEditorClipboard;
		assert.throws(
			() => assertEditorCommandCapabilities(
				{ type: 'clipboard/paste', clipboard, atFrame: 0 },
				{ ...enabled, audioWarp: false },
				'Framescaper',
			),
			/Framescaper does not support audioWarp\./u,
			`clipboard V${String(schemaVersion)} must not introduce audio warp state`,
		);
	}
});

test('capability policy inspects clipboard video composition across every supported schema', () => {
	for (const schemaVersion of [1, 2, 3, 4, 5] as const) {
		const clipboard = {
			schemaVersion,
			sampleRate: 48_000,
			durationFrames: 1,
			tracks: [{
				sourceTrackId: 'track', sourceTrackName: 'Track', sourceTrackType: 'video' as const,
				sourceSequenceId: 'main', clips: [{
					id: 'clip', kind: 'video', videoComposition: authoredVideoComposition,
				}],
			}],
			...(schemaVersion >= 3 ? { annotations: [] } : {}),
			...(schemaVersion >= 4 ? { takeGroups: [] } : {}),
		} as unknown as AudioEditorClipboard;
		assert.throws(
			() => assertEditorCommandCapabilities(
				{ type: 'clipboard/paste', clipboard, atFrame: 0 },
				{ ...enabled, videoGeometry: false },
				'Soundscaper',
			),
			/Soundscaper does not support videoGeometry\./u,
			`clipboard V${String(schemaVersion)} must not introduce video composition state`,
		);
	}
});

test('capability policy refuses disguised warp maps without invoking accessors', () => {
	let gets = 0;
	const clip = { id: 'clip' } as Record<string, unknown>;
	Object.defineProperty(clip, 'warpMap', {
		enumerable: true,
		get() { gets += 1; return authoredWarpMap; },
	});
	assert.throws(
		() => assertEditorCommandCapabilities(
			{ type: 'clip/add', trackId: 'track', clip } as AudioEditorCommand,
			{ ...enabled, audioWarp: false },
			'Framescaper',
		),
		/Framescaper does not support audioWarp\./u,
	);
	assert.equal(gets, 0);
});

test('capability policy inspects V4 take group payloads and permits take-free V4 media', () => {
	const clipboard: AudioEditorClipboard = {
		schemaVersion: 4, sampleRate: 48_000, durationFrames: 100, tracks: [], annotations: [], takeGroups: [],
	};
	const disabled = { ...enabled, takeComp: false };
	assert.throws(
		() => assertEditorCommandCapabilities(
			{ type: 'clipboard/paste', clipboard: { ...clipboard, takeGroups: [{ id: 'group' }] }, atFrame: 0 },
			disabled,
			'Framescaper',
		),
		/Framescaper does not support takeComp\./u,
	);
	const { takeGroups: _takeGroups, ...withoutTakeGroups } = clipboard;
	assert.throws(
		() => assertEditorCommandCapabilities(
			{ type: 'clipboard/paste', clipboard: withoutTakeGroups, atFrame: 0 },
			disabled,
			'Framescaper',
		),
		/Framescaper does not support takeComp\./u,
	);
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		{ type: 'clipboard/paste', clipboard, atFrame: 0 },
		disabled,
		'Framescaper',
	));
});

test('empty effect stacks remain compatible with products that disable effect editing', () => {
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		{ type: 'track/add', track: { id: 'track', effects: [] } },
		{ ...enabled, audioEffects: false },
		'Limited',
	));
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', videoEffects: [] } },
		{ ...enabled, videoEffects: false },
		'Limited',
	));
});
