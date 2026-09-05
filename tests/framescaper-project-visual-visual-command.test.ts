/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	applyFramescaperOwnedVisualCommandVisual as apply,
	isFramescaperOwnedVisualCommandTypeVisual as owns,
	snapshotFramescaperOwnedVisualCommandVisual as snapshot,
	type FramescaperVideoAdjustmentLayerSetCommandVisual,
	type FramescaperVideoFreezeFallbackSetCommandVisual,
	type FramescaperVideoMaskMatteSetCommandVisual,
	type FramescaperVideoVisualClipSetCommandVisual,
	type FramescaperVideoVisualPresetSetCommandVisual,
	type FramescaperVideoVisualSourceSetCommandVisual,
} from '../src/framescaper/editor-project-visual-visual-command.ts';

type Data = Record<string, unknown>;

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const TIMELINE = Object.freeze({ scope: 'timeline', trackId: 'video-track' });
const BIN = Object.freeze({ scope: 'project-bin' });

// Every fixture lists its fields in the canonical order the V24 normalizers emit;
// stored state is compared with the expected state by JSON serialization.
function stillSource(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256: SHA_A,
		width: 1_920, height: 1_080, hasAlpha: true, ...overrides,
	};
}

function generatorSource(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Title',
		width: 1_920, height: 1_080, frameRate: { num: 30, den: 1 }, frameCount: 100,
		generator: { kind: 'solid', color: '#101010ff' }, ...overrides,
	};
}

function stillClip(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, ...overrides,
	};
}

function generatorClip(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, ...overrides,
	};
}

function adjustment(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 30, targetTrackIds: ['video-track'],
		effectIds: [], ...overrides,
	};
}

function preset(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'video-preset', id: 'preset', name: 'Look',
		modelKind: 'adjustment-layer', authoredStateSha256: SHA_A, ...overrides,
	};
}

function mask(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1_920, height: 1_080 }],
		outputNodeId: 'shape', ...overrides,
	};
}

function freezeFallback(overrides: Data = {}): Data {
	return createVideoFreezeFallbackV1({
		renderedSourceId: 'rendered-source', renderedAssetSha256: SHA_A,
		authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
		renderPlanFingerprintSha256: SHA_A, nativeEffectFingerprintSha256: SHA_B,
		...overrides,
	}) as unknown as Data;
}

interface RemovalCase { readonly label: string; readonly expectedField: string; readonly command: Data }

const REMOVALS: readonly RemovalCase[] = Object.freeze([
	{
		label: 'visual source', expectedField: 'expectedSource',
		command: {
			type: 'video-visual-source/set', sourceId: 'still-source',
			expectedSource: stillSource(), source: null,
		},
	},
	{
		label: 'visual clip', expectedField: 'expectedClip',
		command: {
			type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: stillClip(),
			expectedPlacement: BIN, clip: null, placement: null,
		},
	},
	{
		label: 'adjustment layer', expectedField: 'expectedAdjustmentLayer',
		command: {
			type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment',
			expectedAdjustmentLayer: adjustment(), adjustmentLayer: null,
		},
	},
	{
		label: 'visual preset', expectedField: 'expectedPreset',
		command: {
			type: 'video-visual-preset/set', presetId: 'preset',
			expectedPreset: preset(), preset: null,
		},
	},
	{
		label: 'mask/matte', expectedField: 'expectedMaskMatte',
		command: {
			type: 'video-mask-matte/set', maskMatteId: 'mask',
			expectedMaskMatte: mask(), maskMatte: null,
		},
	},
	{
		label: 'freeze fallback', expectedField: 'expectedFreezeFallback',
		command: {
			type: 'video-freeze-fallback/set', renderedSourceId: 'rendered-source',
			expectedFreezeFallback: freezeFallback(), freezeFallback: null,
		},
	},
]);

function clipProject(overrides: Data = {}): Data {
	return {
		sources: [], clips: [], projectBin: { clips: [] },
		tracks: [{ id: 'video-track', type: 'video', clipIds: [] }],
		...overrides,
	};
}

test('the command-type predicate admits exactly the six visual set commands', () => {
	const owned = REMOVALS.map(({ command }) => String(command.type));

	assert.deepEqual(owned.filter(owns), owned);
	assert.deepEqual(
		['batch', 'video-transition/set', 'clip/remove', 'video-visual-source/SET', ''].filter(owns),
		[],
	);
});

test('a still source command snapshots a frozen normalized copy of its payload', () => {
	const payload = stillSource();

	const command = snapshot({
		type: 'video-visual-source/set', sourceId: 'still-source',
		expectedSource: null, source: payload,
	}) as FramescaperVideoVisualSourceSetCommandVisual;

	assert.equal(Object.isFrozen(command), true);
	assert.equal(command.expectedSource, null);
	assert.deepEqual(command.source, payload);
	assert.notEqual(command.source as unknown, payload);
	assert.equal(Object.isFrozen(command.source), true);
});

test('a generator clip command snapshots the clip together with its timeline placement', () => {
	const command = snapshot({
		type: 'video-visual-clip/set', clipId: 'generator-clip', expectedClip: null,
		expectedPlacement: null, clip: generatorClip(), placement: { scope: 'timeline', trackId: 'video-track' },
	}) as FramescaperVideoVisualClipSetCommandVisual;

	assert.deepEqual(command.clip, generatorClip());
	assert.deepEqual(command.placement, { scope: 'timeline', trackId: 'video-track' });
	assert.equal(Object.isFrozen(command.placement), true);
	assert.equal(command.expectedPlacement, null);
});

test('an adjustment-layer command sorts the target track and effect identifiers it snapshots', () => {
	const command = snapshot({
		type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment',
		expectedAdjustmentLayer: null,
		adjustmentLayer: adjustment({ targetTrackIds: ['video-upper', 'video-track'], effectIds: ['fx-b', 'fx-a'] }),
	}) as FramescaperVideoAdjustmentLayerSetCommandVisual;

	assert.deepEqual(command.adjustmentLayer?.targetTrackIds, ['video-track', 'video-upper']);
	assert.deepEqual(command.adjustmentLayer?.effectIds, ['fx-a', 'fx-b']);
});

test('a mask/matte command normalizes the graph and a preset command keeps its digest identity', () => {
	const maskCommand = snapshot({
		type: 'video-mask-matte/set', maskMatteId: 'mask', expectedMaskMatte: null,
		maskMatte: mask({ inputs: [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' }] }),
	}) as FramescaperVideoMaskMatteSetCommandVisual;
	const presetCommand = snapshot({
		type: 'video-visual-preset/set', presetId: 'preset', expectedPreset: null, preset: preset(),
	}) as FramescaperVideoVisualPresetSetCommandVisual;

	assert.deepEqual(maskCommand.maskMatte?.inputs, [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' }]);
	assert.equal(maskCommand.maskMatte?.outputNodeId, 'shape');
	assert.equal(presetCommand.preset?.authoredStateSha256, SHA_A);
	assert.equal(presetCommand.preset?.modelKind, 'adjustment-layer');
});

test('a freeze-fallback command binds identity to the rendered source rather than an id field', () => {
	const command = snapshot(REMOVALS[5]!.command) as FramescaperVideoFreezeFallbackSetCommandVisual;

	assert.equal(command.renderedSourceId, 'rendered-source');
	assert.equal(command.expectedFreezeFallback?.renderedSourceId, 'rendered-source');
	assert.throws(() => snapshot({
		type: 'video-freeze-fallback/set', renderedSourceId: 'other-source',
		expectedFreezeFallback: null, freezeFallback: freezeFallback(),
	}), /cannot change identity/u);
});

test('a command type outside the visual slice is refused as unsupported', () => {
	assert.throws(() => snapshot({ type: 'video-transition/set' }), RangeError);
	assert.throws(() => snapshot({ type: 'video-visual-source/set ' }), RangeError);
});

test('a command must be a plain record carrying a string type', () => {
	assert.throws(() => snapshot(null), TypeError);
	assert.throws(() => snapshot([{ type: 'video-visual-preset/set' }]), TypeError);
	assert.throws(() => snapshot({ type: 7 }), /type must be a string/u);
	assert.throws(() => snapshot({ get type() { return 'video-visual-preset/set'; } }), /data property/u);
});

test('every visual command refuses a payload carrying an unexpected field', () => {
	for (const { label, command } of REMOVALS) {
		assert.equal(snapshot(command).type, command.type, label);
		assert.throws(() => snapshot({ ...command, note: 'annotation' }), /unsupported field/u, label);
	}
});

test('every visual command refuses a null-to-null mutation', () => {
	for (const { label, expectedField, command } of REMOVALS) {
		assert.throws(
			() => snapshot({ ...command, [expectedField]: null }),
			/must mutate state/u,
			label,
		);
	}
});

test('a visual command may not rename the subject it edits', () => {
	assert.throws(() => snapshot({
		type: 'video-visual-source/set', sourceId: 'other-source',
		expectedSource: stillSource(), source: null,
	}), /cannot change identity/u);
	assert.throws(() => snapshot({
		type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment',
		expectedAdjustmentLayer: adjustment(), adjustmentLayer: adjustment({ id: 'renamed' }),
	}), /cannot change identity/u);
});

test('an identity field must be a stable identifier', () => {
	assert.throws(() => snapshot({
		type: 'video-visual-preset/set', presetId: 'not a stable id',
		expectedPreset: null, preset: preset(),
	}), /must be a stable ID/u);
	assert.throws(() => snapshot({
		type: 'video-visual-preset/set', presetId: 'preset', expectedPreset: null, preset: null,
	}), /must mutate state/u);
});

test('a source or clip of an unsupported kind is refused before normalization', () => {
	assert.throws(() => snapshot({
		type: 'video-visual-source/set', sourceId: 'video-source',
		expectedSource: null, source: { ...stillSource({ id: 'video-source' }), kind: 'video' },
	}), /source kind is unsupported/u);
	assert.throws(() => snapshot({
		type: 'video-visual-clip/set', clipId: 'video-clip', expectedClip: null,
		expectedPlacement: null, clip: { ...stillClip({ id: 'video-clip' }), kind: 'video' },
		placement: BIN,
	}), /clip kind is unsupported/u);
});

test('a visual clip and its placement must be present or absent together', () => {
	assert.throws(() => snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: null,
		expectedPlacement: null, clip: stillClip(), placement: null,
	}), /present or absent together/u);
	assert.throws(() => snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: null,
		expectedPlacement: BIN, clip: stillClip(), placement: BIN,
	}), /present or absent together/u);
});

test('a placement must name a supported scope with a stable track identifier', () => {
	const place = (placement: unknown): unknown => snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: null,
		expectedPlacement: null, clip: stillClip(), placement,
	});

	assert.throws(() => place({ scope: 'library' }), /placement scope is unsupported/u);
	assert.throws(() => place({ scope: 'project-bin', trackId: 'video-track' }), /unsupported field/u);
	assert.throws(() => place({ scope: 'timeline' }), /trackId is required/u);
	assert.throws(() => place({ scope: 'timeline', trackId: '' }), /must be a stable ID/u);
	assert.throws(() => place({ trackId: 'video-track' }), /scope is required/u);
});

test('applying a source command appends a visual source the project does not hold', () => {
	const project: Data = { sources: [{ id: 'video-source', kind: 'video' }] };

	apply(project, snapshot({
		type: 'video-visual-source/set', sourceId: 'still-source',
		expectedSource: null, source: stillSource(),
	}));

	assert.deepEqual(project.sources, [{ id: 'video-source', kind: 'video' }, stillSource()]);
});

test('applying a source command replaces the stored source in place', () => {
	const project: Data = { sources: [stillSource(), { id: 'video-source', kind: 'video' }] };

	apply(project, snapshot({
		type: 'video-visual-source/set', sourceId: 'still-source',
		expectedSource: stillSource(), source: stillSource({ name: 'Plate B' }),
	}));

	assert.deepEqual(project.sources, [stillSource({ name: 'Plate B' }), { id: 'video-source', kind: 'video' }]);
});

test('applying a source removal deletes only the named visual source', () => {
	const project: Data = { sources: [generatorSource(), stillSource()] };

	apply(project, snapshot(REMOVALS[0]!.command));

	assert.deepEqual(project.sources, [generatorSource()]);
});

test('a stale expected source aborts the command before the project is touched', () => {
	const project: Data = { sources: [stillSource({ name: 'Plate B' })] };
	const before = structuredClone(project);

	assert.throws(() => apply(project, snapshot(REMOVALS[0]!.command)), /expected visual visual source is stale/u);
	assert.deepEqual(project, before);
});

// A null-to-null removal never survives the snapshot gate, so the apply-level
// missing-identity guard is reached only by a directly constructed command.
test('a source removal ignores a video source that happens to share the identity', () => {
	const project: Data = { sources: [{ id: 'still-source', kind: 'video' }] };
	const command = {
		type: 'video-visual-source/set', sourceId: 'still-source', expectedSource: null, source: null,
	} as const;

	assert.throws(() => snapshot(command), /must mutate state/u);
	assert.throws(() => apply(project, command), /source still-source is missing/u);
	assert.deepEqual(project.sources, [{ id: 'still-source', kind: 'video' }]);
});

test('the source collection must be an array of records', () => {
	const command = snapshot({
		type: 'video-visual-source/set', sourceId: 'still-source', expectedSource: null, source: stillSource(),
	});

	assert.throws(() => apply({}, command), /sources must be an array/u);
	assert.throws(() => apply({ sources: { 0: stillSource() } }, command), /sources must be an array/u);
	assert.throws(() => apply({ sources: ['still-source'] }, command), /sources\[0\] must be an object/u);
});

test('placing a clip on a video track links it into that track clip order', () => {
	const project = clipProject();

	apply(project, snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: null,
		expectedPlacement: null, clip: stillClip(), placement: TIMELINE,
	}));

	assert.deepEqual(project.clips, [stillClip()]);
	assert.deepEqual((project.projectBin as Data).clips, []);
	assert.deepEqual((project.tracks as Data[])[0]?.clipIds, ['still-clip']);
});

test('moving a clip to the project bin unlinks it from its timeline track', () => {
	const project = clipProject({
		clips: [stillClip()],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['still-clip'] }],
	});

	apply(project, snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: stillClip(),
		expectedPlacement: TIMELINE, clip: stillClip(), placement: BIN,
	}));

	assert.deepEqual(project.clips, []);
	assert.deepEqual((project.projectBin as Data).clips, [stillClip()]);
	assert.deepEqual((project.tracks as Data[])[0]?.clipIds, []);
});

test('removing a project-bin clip drops it from the bin without touching the timeline', () => {
	const project = clipProject({
		clips: [generatorClip()], projectBin: { clips: [stillClip()] },
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['generator-clip'] }],
	});

	apply(project, snapshot(REMOVALS[1]!.command));

	assert.deepEqual((project.projectBin as Data).clips, []);
	assert.deepEqual(project.clips, [generatorClip()]);
	assert.deepEqual((project.tracks as Data[])[0]?.clipIds, ['generator-clip']);
});

test('a timeline placement requires an existing video track', () => {
	const command = (trackId: string): ReturnType<typeof snapshot> => snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: null,
		expectedPlacement: null, clip: stillClip(), placement: { scope: 'timeline', trackId },
	});
	const project = clipProject({
		tracks: [{ id: 'video-track', type: 'video', clipIds: [] }, { id: 'audio-track', type: 'audio', clipIds: [] }],
	});

	assert.throws(() => apply(project, command('missing-track')), /requires a video track/u);
	assert.throws(() => apply(project, command('audio-track')), ReferenceError);
	assert.deepEqual(project.clips, []);
});

test('a locked source track refuses to release the clip it owns', () => {
	const project = clipProject({
		clips: [stillClip()],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['still-clip'], locked: true }],
	});

	assert.throws(() => apply(project, snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: stillClip(),
		expectedPlacement: TIMELINE, clip: null, placement: null,
	})), /clip source track is locked/u);
	assert.deepEqual(project.clips, [stillClip()]);
});

test('a locked target track refuses to accept a placed clip', () => {
	const project = clipProject({
		tracks: [{ id: 'video-track', type: 'video', clipIds: [], locked: true }],
	});

	assert.throws(() => apply(project, snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: null,
		expectedPlacement: null, clip: stillClip(), placement: TIMELINE,
	})), /clip target track is locked/u);
	assert.deepEqual(project.clips, []);
});

test('a stale expected placement aborts the clip command', () => {
	const project = clipProject({ projectBin: { clips: [stillClip()] } });
	const before = structuredClone(project);

	assert.throws(() => apply(project, snapshot({
		type: 'video-visual-clip/set', clipId: 'still-clip', expectedClip: stillClip(),
		expectedPlacement: TIMELINE, clip: null, placement: null,
	})), /clip or placement is stale/u);
	assert.deepEqual(project, before);
});

test('the clip command requires the timeline, project bin and track collections', () => {
	const command = snapshot(REMOVALS[1]!.command);

	assert.throws(() => apply({ projectBin: { clips: [] }, tracks: [] }, command), /clips must be an array/u);
	assert.throws(() => apply({ clips: [], tracks: [] }, command), /projectBin must be an object/u);
	assert.throws(() => apply({ clips: [], projectBin: { clips: 'none' }, tracks: [] }, command),
		/projectBin\.clips must be an array/u);
	assert.throws(() => apply({ clips: [], projectBin: { clips: [] } }, command), /tracks must be an array/u);
});

test('an adjustment layer is appended, replaced and removed by identity', () => {
	const project: Data = { videoAdjustmentLayers: [] };
	const added = adjustment();
	const widened = adjustment({ sequenceFrameCount: 60 });

	apply(project, snapshot({
		type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment',
		expectedAdjustmentLayer: null, adjustmentLayer: added,
	}));
	assert.deepEqual(project.videoAdjustmentLayers, [added]);

	apply(project, snapshot({
		type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment',
		expectedAdjustmentLayer: added, adjustmentLayer: widened,
	}));
	assert.deepEqual(project.videoAdjustmentLayers, [widened]);

	apply(project, snapshot({
		type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment',
		expectedAdjustmentLayer: widened, adjustmentLayer: null,
	}));
	assert.deepEqual(project.videoAdjustmentLayers, []);
});

test('a stale preset expectation refuses to overwrite the stored preset', () => {
	const project: Data = { videoVisualPresets: [preset({ name: 'Look B' })] };

	assert.throws(() => apply(project, snapshot({
		type: 'video-visual-preset/set', presetId: 'preset',
		expectedPreset: preset(), preset: preset({ authoredStateSha256: SHA_B }),
	})), /expected visual visual preset is stale/u);
	assert.deepEqual(project.videoVisualPresets, [preset({ name: 'Look B' })]);
});

test('removing an absent mask/matte is refused as missing', () => {
	const project: Data = { videoMaskMattes: [mask({ id: 'other-mask' })] };

	assert.throws(() => apply(project, {
		type: 'video-mask-matte/set', maskMatteId: 'mask', expectedMaskMatte: null, maskMatte: null,
	}), /mask\/matte mask is missing/u);
	assert.deepEqual(project.videoMaskMattes, [mask({ id: 'other-mask' })]);
});

test('a freeze fallback is stored and replaced under its rendered source identity', () => {
	const project: Data = { videoFreezeFallbacks: [] };
	const stored = freezeFallback();
	const rerendered = freezeFallback({ renderedAssetSha256: SHA_B });

	apply(project, snapshot({
		type: 'video-freeze-fallback/set', renderedSourceId: 'rendered-source',
		expectedFreezeFallback: null, freezeFallback: stored,
	}));
	assert.deepEqual(project.videoFreezeFallbacks, [stored]);

	apply(project, snapshot({
		type: 'video-freeze-fallback/set', renderedSourceId: 'rendered-source',
		expectedFreezeFallback: stored, freezeFallback: rerendered,
	}));
	assert.deepEqual(project.videoFreezeFallbacks, [rerendered]);

	apply(project, snapshot({
		type: 'video-freeze-fallback/set', renderedSourceId: 'rendered-source',
		expectedFreezeFallback: rerendered, freezeFallback: null,
	}));
	assert.deepEqual(project.videoFreezeFallbacks, []);
});

test('a model collection must be an array before it is edited', () => {
	assert.throws(() => apply({ videoVisualPresets: 'none' }, snapshot(REMOVALS[3]!.command)),
		/videoVisualPresets must be an array/u);
	assert.throws(() => apply({ videoMaskMattes: [null] }, snapshot(REMOVALS[4]!.command)),
		/videoMaskMattes\[0\] must be an object/u);
});
