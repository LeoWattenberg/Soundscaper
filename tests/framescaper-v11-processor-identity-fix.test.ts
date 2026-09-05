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
	createFramescaperProjectUnifiedExactRenderPlanFinishing,
} from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import {
	prepareFramescaperSessionClipboardPasteCommandV11,
} from '../src/framescaper/editor-session-clipboard-v11-controller.ts';
import {
	createFramescaperSessionClipboardV11,
	prepareFramescaperFinishingClipboardPasteV11,
} from '../src/framescaper/editor-session-clipboard-v11.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

const VIDEO_KEY = 'video-clip:0:48000';

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

/** Two stacks that legally reuse one processor identity, which is unique only per stack. */
function stack(id: string, radius: number): Data {
	return {
		schemaVersion: 1, id, sourceId: 'video-source',
		processors: [{
			schemaVersion: 1, id: 'denoise-1', kind: 'spatial-denoise',
			enabled: true, radius, strength: 1,
		}],
	};
}

function presentation(id: string, owner: Data, processorStackId: string): Data {
	return {
		schemaVersion: 1, id, owner, enabled: true, opacity: 1, blendMode: 'normal',
		grade: null, processorStackId, maskMatteIds: [],
	};
}

function originOptions(): Data {
	return {
		...framescaperV20Options(),
		finishing: {
			visualPresentations: [
				presentation('presentation-1', { kind: 'clip', id: 'video-clip' }, 'stack-1'),
				presentation('presentation-2', { kind: 'source', id: 'video-source' }, 'stack-2'),
			],
			processorStacks: [stack('stack-1', 1), stack('stack-2', 3)],
		},
	};
}

function project(options: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
}

function destination(): Data {
	return project(framescaperV20Options());
}

function fullDescriptor(origin: Data): Data {
	return {
		schemaVersion: 6, sampleRate: origin.sampleRate, durationFrames: 48_000,
		annotations: [], takeGroups: [],
		tracks: [{
			sourceTrackId: 'video-track', sourceTrackName: 'Video', sourceTrackType: 'video',
			sourceLaneGroupId: null, sourceSequenceId: 'main-sequence',
			clips: [{
				key: VIDEO_KEY, kind: 'video', sourceId: 'video-source', offsetFrame: 0,
				sourceStartFrame: 0, durationFrames: 48_000, sequenceId: 'main-sequence',
				sequenceFrameCount: 10, videoComposition: composition(),
			}],
		}],
	};
}

function counter(): (prefix?: string) => string {
	let index = 0;
	return (prefix = 'id') => `${prefix}-${String((index += 1))}`;
}

function carrierOf(origin: Data): Data {
	return createFramescaperSessionClipboardV11(
		PROFILE, origin, fullDescriptor(origin) as never,
	) as unknown as Data;
}

function commandsOf(value: Data): Data[] {
	return value.type === 'batch' ? value.commands as Data[] : [value];
}

function pastedStacks(candidate: Data): unknown[][] {
	return (candidate.videoProcessorStacks as Data[]).map((row) => [
		row.id, (row.processors as Data[]).map(({ id }) => id),
	]);
}

function pasteInto(destinationProject: Data, carrier: Data): Data {
	const base = preparePasteCommand(carrier.descriptor, {
		atFrame: 480_000, mode: 'overlap', trackMap: { 'video-track': 'video-track' },
	}, counter()) as Data;
	return prepareFramescaperSessionClipboardPasteCommandV11(
		PROFILE, destinationProject, carrier, base as never, counter(),
	) as unknown as Data;
}

function map(...pairs: readonly (readonly [string, string])[]): Map<string, string> {
	return new Map(pairs);
}

function options(processorIdMap: Map<string, ReadonlyMap<string, string>>): Data {
	return {
		visual: {
			sourceIdMap: map(), clipIdMap: map(), adjustmentLayerIdMap: map(),
			presetIdMap: map(), maskMatteIdMap: map(), projectReferenceIdMap: map(),
		},
		presentationIdMap: map(
			['presentation-1', 'fresh-presentation-1'], ['presentation-2', 'fresh-presentation-2'],
		),
		processorStackIdMap: map(['stack-1', 'fresh-stack-1'], ['stack-2', 'fresh-stack-2']),
		processorIdMap,
		motionAnalysisIdMap: map(),
		finishingPresetIdMap: map(),
		captionTrackIdMap: map(),
		projectReferenceIdMap: map(
			['main-sequence', 'destination-sequence'], ['video-source', 'video-source'],
			['video-clip', 'destination-clip'],
		),
	};
}

function perStack(...pairs: readonly (readonly [string, Map<string, string>])[]): Map<string, ReadonlyMap<string, string>> {
	return new Map(pairs);
}

function preparedStacks(processorIdMap: Map<string, ReadonlyMap<string, string>>): Data[] {
	const carrier = carrierOf(project(originOptions()));
	const pasted = prepareFramescaperFinishingClipboardPasteV11(
		carrier.finishing, options(processorIdMap) as never,
	) as unknown as Data;
	return pasted.processorStacks as Data[];
}

test('an origin project may hold one processor identity in two separate stacks', () => {
	assert.deepEqual(pastedStacks(project(originOptions())), [
		['stack-1', ['denoise-1']], ['stack-2', ['denoise-1']],
	]);
});

test('a paste allocates one fresh processor identity per stack occurrence, never one shared identity', () => {
	const prepared = pasteInto(destination(), carrierOf(project(originOptions())));

	const stacks = commandsOf(prepared)
		.filter(({ type }) => type === 'video-processor-stack/set')
		.map(({ processorStack }) => processorStack as Data);
	assert.deepEqual(stacks, [
		{
			schemaVersion: 1, id: 'processor-stack-3', sourceId: 'video-source',
			processors: [{
				schemaVersion: 1, id: 'video-processor-5', kind: 'spatial-denoise',
				enabled: true, radius: 1, strength: 1,
			}],
		},
		{
			schemaVersion: 1, id: 'processor-stack-4', sourceId: 'video-source',
			processors: [{
				schemaVersion: 1, id: 'video-processor-6', kind: 'spatial-denoise',
				enabled: true, radius: 3, strength: 1,
			}],
		},
	]);
});

test('the pasted project keeps both stacks distinct and still builds a unified exact render plan', () => {
	const prepared = pasteInto(destination(), carrierOf(project(originOptions())));

	const pasted = applyFramescaperProjectCommandFinishing(
		PROFILE, destination() as never, prepared as never,
	) as unknown as Data;
	assert.doesNotThrow(() => createFramescaperProjectUnifiedExactRenderPlanFinishing(
		PROFILE, pasted as never, {
			...renderAuthority(pasted, 130), visualFreshnessByModelId: new Map(),
		} as never,
	));
	assert.deepEqual(pastedStacks(pasted), [
		['processor-stack-3', ['video-processor-5']],
		['processor-stack-4', ['video-processor-6']],
	]);
});

test('a finishing paste renames each stack through the allocation map that stack owns', () => {
	const stacks = preparedStacks(perStack(
		['stack-1', map(['denoise-1', 'fresh-denoise-1'])],
		['stack-2', map(['denoise-1', 'fresh-denoise-2'])],
	));

	assert.deepEqual(stacks, [
		{
			schemaVersion: 1, id: 'fresh-stack-1', sourceId: 'video-source',
			processors: [{
				schemaVersion: 1, id: 'fresh-denoise-1', kind: 'spatial-denoise',
				enabled: true, radius: 1, strength: 1,
			}],
		},
		{
			schemaVersion: 1, id: 'fresh-stack-2', sourceId: 'video-source',
			processors: [{
				schemaVersion: 1, id: 'fresh-denoise-2', kind: 'spatial-denoise',
				enabled: true, radius: 3, strength: 1,
			}],
		},
	]);
});

test('a finishing paste refuses a carried stack whose processor allocations are missing', () => {
	assert.throws(
		() => preparedStacks(perStack(['stack-1', map(['denoise-1', 'fresh-denoise-1'])])),
		{ name: 'ReferenceError', message: /V11 paste has no mapping for stack processors stack-2/u },
	);
});

test('a finishing paste refuses a processor allocation map nothing in the fragment consumed', () => {
	assert.throws(
		() => preparedStacks(perStack(
			['stack-1', map(['denoise-1', 'fresh-denoise-1'])],
			['stack-2', map(['denoise-1', 'fresh-denoise-2'], ['ghost-1', 'fresh-ghost'])],
		)),
		{ name: 'RangeError', message: /V11 paste contains an unused allocation ghost-1/u },
	);
	assert.throws(
		() => preparedStacks(perStack(
			['stack-1', map(['denoise-1', 'fresh-denoise-1'])],
			['stack-2', map(['denoise-1', 'fresh-denoise-2'])],
			['stack-ghost', map(['denoise-1', 'fresh-denoise-3'])],
		)),
		{ name: 'RangeError', message: /V11 paste contains an unused allocation stack-ghost/u },
	);
});

test('a finishing paste refuses two stacks that share one fresh processor identity', () => {
	const shared = map(['denoise-1', 'fresh-denoise-1']);

	assert.throws(
		() => preparedStacks(perStack(['stack-1', shared], ['stack-2', shared])),
		{ name: 'RangeError', message: /V11 paste allocations must be globally unique/u },
	);
});
