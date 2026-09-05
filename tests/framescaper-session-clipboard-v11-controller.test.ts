/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import {
	applyFramescaperProjectCommandFinishing,
} from '../src/framescaper/editor-project-finishing-commands.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	prepareFramescaperSessionClipboardPasteCommandV11,
} from '../src/framescaper/editor-session-clipboard-v11-controller.ts';
import {
	createFramescaperSessionClipboardV11,
} from '../src/framescaper/editor-session-clipboard-v11.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);
const VIDEO_KEY = 'video-clip:0:48000';
const STILL_KEY = 'still-clip:48000:48000';
const GENERATOR_KEY = 'generator-clip:96000:48000';
const AUDIO_ADMISSION = Object.freeze({
	type: 'source/add', source: {
		kind: 'audio', id: 'pasted-audio-source', name: 'Pasted audio', storageKey: 'pasted-audio-source',
		mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	},
});

function composition(): Data {
	return {
		schemaVersion: 1,
		crop: { left: 0, top: 0, right: 0, bottom: 0 },
		transform: {
			anchorX: 0.5, anchorY: 0.5, positionX: 0.5, positionY: 0.5, scaleX: 1, scaleY: 1,
			rotationDegrees: 0, flipHorizontal: false, flipVertical: false,
		},
		opacity: 1, blendMode: 'normal', compositingOrder: 0,
	};
}

/** An origin project holding the whole V11 finishing graph a clipboard can select. */
function originOptions(): Data {
	const options = framescaperV20Options();
	(options.clips as Data[]).push(
		{
			schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
		},
		{
			schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10,
		},
	);
	((options.tracks as Data[])[0]!.clipIds as string[]).push('still-clip', 'generator-clip');
	return {
		...options,
		visualModel: {
			stillSources: [{
				schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate', mimeType: 'image/png',
				storageKey: 'still-storage', contentSha256: SHA_A, width: 1_920, height: 1_080, hasAlpha: true,
			}],
			generatorSources: [{
				schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Title',
				width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 100,
				generator: {
					kind: 'title', text: 'Framescaper', fontFamily: 'soundscaper-sans', fontSize: 72,
					color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
				},
			}],
			maskMattes: [{
				schemaVersion: 1, id: 'mask', kind: 'mask',
				inputs: [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' }],
				nodes: [{
					id: 'shape', kind: 'vector-shape', shape: 'rectangle',
					x: 0, y: 0, width: 1_920, height: 1_080,
				}],
				outputNodeId: 'shape',
			}],
		},
		finishing: {
			colorContexts: [{
				schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
				outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
			}],
			sourceColorInterpretations: [
				{
					schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video', primaries: 'bt709',
					transfer: 'bt709', matrix: 'bt709', range: 'limited',
					provenance: 'default-video-bt709-limited',
				},
				{
					schemaVersion: 1, sourceId: 'still-source', sourceKind: 'still', primaries: 'display-p3',
					transfer: 'srgb', matrix: 'rgb', range: 'full', provenance: 'user-override',
				},
			],
			visualPresentations: [{
				schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'still-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', grade: null,
				processorStackId: 'stack-1', maskMatteIds: ['mask'],
			}],
			processorStacks: [{
				schemaVersion: 1, id: 'stack-1', sourceId: 'video-source',
				processors: [{
					schemaVersion: 1, id: 'denoise-1', kind: 'spatial-denoise',
					enabled: true, radius: 1, strength: 1,
				}],
			}],
			motionAnalyses: [{
				schemaVersion: 1, id: 'analysis-1', sourceId: 'video-source', processorStackId: 'stack-1',
				inputSha256: SHA_B, settingsSha256: SHA_C, storageKey: `motion-sha256:${SHA_D}`,
				sha256: SHA_D, byteLength: 128, startFrame: 0, endFrame: 10,
			}],
		},
	};
}

function project(options: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
}

function destination(): Data {
	return project(framescaperV20Options());
}

function descriptorClip(key: string, sourceId: string, offsetFrame: number, extra: Data = {}): Data {
	return {
		key, kind: 'video', sourceId, offsetFrame, sourceStartFrame: 0, durationFrames: 48_000,
		sequenceId: 'main-sequence', sequenceFrameCount: 10, videoComposition: composition(), ...extra,
	};
}

function descriptorTrack(sourceTrackId: string, clips: readonly Data[]): Data {
	return {
		sourceTrackId, sourceTrackName: 'Video', sourceTrackType: 'video',
		sourceLaneGroupId: null, sourceSequenceId: 'main-sequence', clips: [...clips],
	};
}

function descriptor(sampleRate: unknown, tracks: readonly Data[], durationFrames = 144_000): Data {
	return { schemaVersion: 6, sampleRate, durationFrames, annotations: [], takeGroups: [], tracks: [...tracks] };
}

function fullDescriptor(origin: Data, stillExtra: Data = {}): Data {
	return descriptor(origin.sampleRate, [descriptorTrack('video-track', [
		descriptorClip(VIDEO_KEY, 'video-source', 0),
		descriptorClip(STILL_KEY, 'still-source', 48_000, stillExtra),
		descriptorClip(GENERATOR_KEY, 'generator-source', 96_000, { sourceInFrame: 0, sourceFrameCount: 10 }),
	])]);
}

function board(origin: Data, wire: Data): Data {
	return createFramescaperSessionClipboardV11(PROFILE, origin, wire as never) as unknown as Data;
}

function fullBoard(stillExtra: Data = {}): Readonly<{ origin: Data; carrier: Data }> {
	const origin = project(originOptions());
	return { origin, carrier: board(origin, fullDescriptor(origin, stillExtra)) };
}

function counter(): (prefix?: string) => string {
	let index = 0;
	return (prefix = 'id') => `${prefix}-${String((index += 1))}`;
}

function pasteCommand(carrier: Data, overrides: Data = {}, trackMap: Data = { 'video-track': 'video-track' }): Data {
	const base = preparePasteCommand(carrier.descriptor, {
		atFrame: 480_000, mode: 'overlap', trackMap,
	}, counter()) as Data;
	return { ...base, ...overrides };
}

function prepare(destinationProject: Data, carrier: Data, command: Data, createId = counter()): Data {
	return prepareFramescaperSessionClipboardPasteCommandV11(
		PROFILE, destinationProject, carrier, command as never, createId,
	) as unknown as Data;
}

function commandsOf(value: Data): Data[] {
	return value.type === 'batch' ? value.commands as Data[] : [value];
}

function types(value: Data): string[] {
	return commandsOf(value).map(({ type }) => String(type));
}

/** Re-serialize a carrier so its finishing half can be replaced before normalization. */
function withFinishing(carrier: Data, patch: Data): Data {
	const wire = JSON.parse(JSON.stringify(carrier)) as Data;
	return { ...wire, finishing: { ...wire.finishing as Data, ...patch } };
}

function finishingOf(carrier: Data): Data {
	return JSON.parse(JSON.stringify(carrier.finishing)) as Data;
}

test('a paste appends every carried visual and finishing model to the foundation command', () => {
	const { carrier } = fullBoard();

	const prepared = prepare(destination(), carrier, pasteCommand(carrier));

	assert.deepEqual(types(prepared), [
		'clipboard/paste',
		'video-visual-source/set', 'video-visual-source/set', 'video-mask-matte/set',
		'video-visual-clip/set', 'video-visual-clip/set',
		'video-color-context/set', 'video-source-color-interpretation/set',
		'video-processor-stack/set', 'video-motion-analysis/set', 'video-visual-presentation/set',
	]);
	const commands = commandsOf(prepared);
	const only = (type: string): Data | undefined => commands.find((command) => command.type === type);
	assert.deepEqual(
		commands.filter(({ type }) => type === 'video-visual-source/set').map(({ sourceId }) => sourceId),
		['visual-source-1', 'visual-source-2'],
	);
	assert.equal(only('video-mask-matte/set')?.maskMatteId, 'mask-matte-5');
	assert.equal(only('video-motion-analysis/set')?.motionAnalysisId, 'motion-analysis-9');
	assert.deepEqual(only('video-processor-stack/set')?.processorStack, {
		schemaVersion: 1, id: 'processor-stack-7', sourceId: 'video-source',
		processors: [{
			schemaVersion: 1, id: 'video-processor-8', kind: 'spatial-denoise',
			enabled: true, radius: 1, strength: 1,
		}],
	});
	assert.deepEqual(only('video-visual-presentation/set')?.presentation, {
		schemaVersion: 1, id: 'visual-presentation-6', owner: { kind: 'clip', id: 'visual-clip-3' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: 'processor-stack-7', maskMatteIds: ['mask-matte-5'],
	});
});

test('a carried visual clip is rescaled onto the paste anchor of its mapped destination track', () => {
	const { carrier } = fullBoard();

	const commands = commandsOf(prepare(destination(), carrier, pasteCommand(carrier)));

	const stillClip = commands.find(({ clipId }) => clipId === 'visual-clip-3');
	const generatorClip = commands.find(({ clipId }) => clipId === 'visual-clip-4');
	// The anchor is sample frame 480000 at 10/1 over 48000 Hz, so video frame 100.
	assert.deepEqual(stillClip?.clip, {
		schemaVersion: 1, kind: 'still', id: 'visual-clip-3', sourceId: 'visual-source-1',
		sequenceId: 'main-sequence', sequenceStartFrame: 110, sequenceFrameCount: 10,
	});
	assert.deepEqual(generatorClip?.clip, {
		schemaVersion: 1, kind: 'generator', id: 'visual-clip-4', sourceId: 'visual-source-2',
		sequenceId: 'main-sequence', sequenceStartFrame: 120, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	assert.deepEqual(stillClip?.placement, { scope: 'timeline', trackId: 'video-track' });
	assert.equal(stillClip?.expectedClip, null);
	assert.equal(stillClip?.expectedPlacement, null);
});

test('the prepared paste applies to the destination project as one transaction', () => {
	const { carrier } = fullBoard();

	const prepared = prepare(destination(), carrier, pasteCommand(carrier));
	const pasted = applyFramescaperProjectCommandFinishing(
		PROFILE, destination() as never, prepared as never,
	) as unknown as Data;

	assert.deepEqual((pasted.clips as Data[]).map(({ id, kind }) => [id, kind]), [
		['video-clip', 'video'], ['audio-clip', 'audio'], ['clip-1', 'video'],
		['visual-clip-3', 'still'], ['visual-clip-4', 'generator'],
	]);
	assert.deepEqual((pasted.sources as Data[]).map(({ id }) => id), [
		'video-source', 'audio-source', 'visual-source-1', 'visual-source-2',
	]);
	assert.deepEqual((pasted.videoVisualPresentations as Data[]).map(({ id }) => id), ['visual-presentation-6']);
});

test('carried color state that the destination already agrees with emits no set command', () => {
	const { carrier } = fullBoard();
	const agreeing = withFinishing(carrier, {
		colorContexts: [{
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'rec709', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
		}],
		sourceColorInterpretations: [{
			schemaVersion: 1, sourceId: 'still-source', sourceKind: 'still', primaries: 'srgb',
			transfer: 'srgb', matrix: 'rgb', range: 'full', provenance: 'default-still-srgb-full',
		}],
	});

	const prepared = prepare(destination(), agreeing, pasteCommand(carrier));

	assert.deepEqual(types(prepared).filter((type) => type.startsWith('video-color')
		|| type.startsWith('video-source-color')), []);
});

test('a rewritten color context and interpretation carry the destination rows they replace', () => {
	const { carrier } = fullBoard();

	const commands = commandsOf(prepare(destination(), carrier, pasteCommand(carrier)));

	const context = commands.find(({ type }) => type === 'video-color-context/set');
	const interpretation = commands.find(({ type }) => type === 'video-source-color-interpretation/set');
	assert.equal((context?.expectedContext as Data | undefined)?.outputSpace, 'rec709');
	assert.equal((context?.context as Data | undefined)?.outputSpace, 'srgb');
	assert.equal(interpretation?.sourceId, 'visual-source-1');
	assert.equal((interpretation?.expectedInterpretation as Data | undefined)?.provenance, 'default-still-srgb-full');
	assert.equal((interpretation?.interpretation as Data | undefined)?.primaries, 'display-p3');
});

test('a carrier with no finishing content returns the sanitized foundation command alone', () => {
	const plain = project(framescaperV20Options());
	const carrier = board(plain, descriptor(plain.sampleRate, [descriptorTrack('video-track', [
		descriptorClip(VIDEO_KEY, 'video-source', 0),
	])], 48_000));

	const prepared = prepare(destination(), carrier, pasteCommand(carrier));

	assert.equal(prepared.type, 'clipboard/paste');
	assert.equal(Array.isArray(prepared.commands), false);
});

test('a paste strips carried visual source admissions and clip keys from the foundation command', () => {
	const { carrier } = fullBoard();
	const visualAdmissions = (carrier.sources as Data[])
		.filter(({ id }) => id !== 'video-source')
		.map((source) => ({ type: 'source/add', source }));

	const prepared = prepare(destination(), carrier, {
		type: 'batch', commands: [...visualAdmissions, AUDIO_ADMISSION, pasteCommand(carrier)],
	});

	const foundation = commandsOf(commandsOf(prepared)[0]!);
	const paste = foundation.at(-1)!;
	assert.deepEqual(foundation.filter(({ type }) => type === 'source/add')
		.map((command) => (command.source as Data).id), ['pasted-audio-source']);
	assert.deepEqual(
		(((paste.clipboard as Data).tracks as Data[])[0]!.clips as Data[]).map(({ key }) => key),
		[VIDEO_KEY],
	);
	assert.deepEqual(Object.keys(paste.clipIds as Data), [VIDEO_KEY]);
	assert.deepEqual(Object.keys(paste.videoEffectIds as Data), []);
});

test('a paste refuses a foundation batch that carried-visual filtering would empty', () => {
	const { carrier } = fullBoard();
	const stillAdmission = { type: 'source/add', source: (carrier.sources as Data[])[1] };

	assert.throws(() => prepare(destination(), carrier, {
		type: 'batch',
		commands: [pasteCommand(carrier), { type: 'batch', commands: [stillAdmission] }],
	}), { name: 'RangeError', message: /foundation paste cannot become empty/u });
});

test('a paste refuses an identity factory whose identities are occupied or unstable', () => {
	const { carrier } = fullBoard();

	assert.throws(
		() => prepare(destination(), carrier, pasteCommand(carrier), () => 'video-source'),
		{ name: 'RangeError', message: /fresh visual-source ID collides with existing state/u },
	);
	assert.throws(
		() => prepare(destination(), carrier, pasteCommand(carrier), () => ''),
		{ name: 'TypeError', message: /fresh visual-source ID must be a stable identity/u },
	);
});

test('a paste refuses a carrier whose pasted video effect identities are incomplete', () => {
	const { carrier } = fullBoard({
		videoEffects: [{ schemaVersion: 1, id: 'effect-1', kind: 'blur', enabled: true }],
	});

	assert.throws(
		() => prepare(destination(), carrier, pasteCommand(carrier, { videoEffectIds: {} })),
		{ name: 'ReferenceError', message: /pasted effects for still-clip:48000:48000 are incomplete/u },
	);
});

function audioTrack(id: string, name: string): Data {
	return { id, name, type: 'audio', clipIds: [], height: 96, collapsed: false };
}

test('one carried source sequence cannot land in two destination sequences', () => {
	const options = framescaperV20Options();
	(options.tracks as Data[]).push(audioTrack('second-audio', 'Second'));
	(options.sequences as Data[])[0]!.trackIds = ['video-track', 'audio-track', 'second-audio'];
	const origin = project(options);
	// A V2 carrier keeps its per-track sequence context without the foundation's own sequence-map guard.
	const carrier = board(origin, {
		schemaVersion: 2, sampleRate: origin.sampleRate, durationFrames: 48_000,
		tracks: ['audio-track', 'second-audio'].map((sourceTrackId) => ({
			sourceTrackId, sourceTrackName: 'Audio', sourceTrackType: 'audio',
			sourceLaneGroupId: null, sourceSequenceId: 'main-sequence', clips: [],
		})),
	});
	const split = framescaperV20Options();
	(split.tracks as Data[]).push(audioTrack('other-audio', 'Other'));
	(split.sequences as Data[]).push({
		id: 'other-sequence', rate: { num: 10, den: 1 }, trackIds: ['other-audio'],
	});

	assert.throws(() => prepare(project(split), carrier, pasteCommand(
		carrier, {}, { 'audio-track': 'audio-track', 'second-audio': 'other-audio' },
	)), { name: 'RangeError', message: /cannot paste into multiple destination sequences/u });
});

test('a paste refuses a carried project reference the destination cannot resolve', () => {
	const { carrier } = fullBoard();
	const ghosted = withFinishing(carrier, {
		colorContexts: [
			...finishingOf(carrier).colorContexts as Data[],
			{
				schemaVersion: 1, sequenceId: 'ghost-sequence', workingSpace: 'linear-rec709-d65',
				outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
			},
		],
	});

	assert.throws(
		() => prepare(destination(), ghosted, pasteCommand(carrier)),
		{ name: 'ReferenceError', message: /cannot resolve project reference ghost-sequence/u },
	);
});

test('a paste refuses carried color state whose resolved owner the destination does not hold', () => {
	const { carrier } = fullBoard();
	const contextOnAudio = withFinishing(carrier, {
		colorContexts: [{
			schemaVersion: 1, sequenceId: 'audio-source', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
		}],
	});
	const interpretationOnAudio = withFinishing(carrier, {
		sourceColorInterpretations: [{
			schemaVersion: 1, sourceId: 'audio-source', sourceKind: 'video', primaries: 'bt709',
			transfer: 'bt709', matrix: 'bt709', range: 'limited', provenance: 'user-override',
		}],
	});

	assert.throws(
		() => prepare(destination(), contextOnAudio, pasteCommand(carrier)),
		{ name: 'ReferenceError', message: /destination color context audio-source is missing/u },
	);
	assert.throws(
		() => prepare(destination(), interpretationOnAudio, pasteCommand(carrier)),
		{ name: 'ReferenceError', message: /destination interpretation audio-source is missing/u },
	);
});

test('a paste refuses a carried visual clip that no descriptor binding places', () => {
	const { carrier } = fullBoard();
	const finishing = finishingOf(carrier);
	const visual = finishing.visual as Data;
	const orphaned = withFinishing(carrier, {
		visual: {
			...visual,
			clips: [...visual.clips as Data[], {
				schemaVersion: 1, kind: 'still', id: 'orphan-clip', sourceId: 'still-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 30, sequenceFrameCount: 10,
			}],
		},
	});

	assert.throws(
		() => prepare(destination(), orphaned, pasteCommand(carrier)),
		{ name: 'ReferenceError', message: /visual clip visual-clip-5 has no placement binding/u },
	);
});

test('a carried adjustment layer and preset are remapped onto destination tracks', () => {
	const { carrier } = fullBoard();
	const finishing = finishingOf(carrier);
	const visual = finishing.visual as Data;
	const layered = withFinishing(carrier, {
		visual: {
			...visual,
			adjustmentLayers: [{
				schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment', sequenceId: 'main-sequence',
				sequenceStartFrame: 0, sequenceFrameCount: 30, targetTrackIds: ['video-track'], effectIds: [],
			}],
			presets: [{
				schemaVersion: 1, kind: 'video-preset', id: 'preset', name: 'Look',
				modelKind: 'adjustment-layer', authoredStateSha256: SHA_A,
			}],
		},
	});

	const commands = commandsOf(prepare(destination(), layered, pasteCommand(carrier)));

	const adjustment = commands.find(({ type }) => type === 'video-adjustment-layer/set');
	const preset = commands.find(({ type }) => type === 'video-visual-preset/set');
	assert.deepEqual(adjustment?.adjustmentLayer, {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment-layer-5', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 30, targetTrackIds: ['video-track'], effectIds: [],
	});
	assert.equal(adjustment?.expectedAdjustmentLayer, null);
	assert.equal(preset?.presetId, 'visual-preset-6');
	assert.equal(preset?.expectedPreset, null);
});
