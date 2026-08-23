/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands/clipboard-runtime.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorProjectRuntimeV27Selection,
} from '../src/framescaper/editor-project-runtime-v27-selection.ts';
import {
	createFramescaperFinishingClipboardV11,
	normalizeFramescaperFinishingClipboardV11,
	normalizeFramescaperSessionClipboardV11,
	prepareFramescaperFinishingClipboardPasteV11,
} from '../src/framescaper/editor-session-clipboard-v11.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 runtime creates its edit session clipboard through V11', () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = projectWithFinishing();
	const descriptor = createClipboardDescriptor(runtime.projectForCommandConsumers(project), {
		startFrame: 0,
		endFrame: 48_000,
		trackIds: ['video-track'],
	});
	const clipboard = runtime.createSessionClipboard(project, descriptor);
	assert.equal(clipboard.schemaVersion, 11);
	assert.equal(clipboard.kind, 'framescaper-session-clipboard');
	assert.equal(clipboard.originProjectId, project.id);
	assert.equal(clipboard.originRevision, project.revision);
	assert.deepEqual(clipboard.descriptor, descriptor);
	assert.deepEqual(clipboard.clipBindings, [{ clipId: 'video-clip', descriptorKey: descriptor.tracks[0]!.clips[0]!.key }]);
	assert.equal(clipboard.finishing.visualPresentations[0]?.id, 'presentation-1');
	assert.deepEqual(clipboard.finishing.finishingPresets, []);
	assert.deepEqual(clipboard.finishing.captionTracks, []);
	assert.deepEqual(normalizeFramescaperSessionClipboardV11(structuredClone(clipboard)), clipboard);
	assert.deepEqual(runtime.prepareEditClipboardDescriptor(project, descriptor), descriptor);
});

test('selected clipboard V11 carries only descriptor-reachable V24/V27 state without M5 state', () => {
	const project = projectWithFinishing();
	const descriptor = selectedVideoDescriptor(project);
	const clipboard = createFramescaperFinishingClipboardV11(PROFILE, project, descriptor);
	assert.equal(clipboard.schemaVersion, 11);
	assert.equal(clipboard.visual.schemaVersion, 8);
	assert.equal(clipboard.visualPresentations[0]?.id, 'presentation-1');
	assert.equal(clipboard.processorStacks[0]?.id, 'stack-1');
	assert.equal(clipboard.motionAnalyses[0]?.id, 'analysis-1');
	assert.deepEqual(clipboard.finishingPresets, []);
	assert.deepEqual(clipboard.captionTracks, []);
	assert.equal(Object.hasOwn(clipboard, 'effects'), false);
	assert.equal(Object.hasOwn(clipboard, 'nativeVideoSources'), false);
	assert.deepEqual(normalizeFramescaperFinishingClipboardV11(structuredClone(clipboard)), clipboard);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11({ ...clipboard, schemaVersion: 10 }),
		/V11.*re-copy|requires V11/iu,
	);
});

test('clipboard V11 paste uses caller-owned fresh identities and remaps every finishing reference', () => {
	const project = projectWithFinishing();
	const clipboard = createFramescaperFinishingClipboardV11(PROFILE, project, selectedVideoDescriptor(project));
	const pasted = prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		visual: {
			sourceIdMap: new Map(), clipIdMap: new Map(), adjustmentLayerIdMap: new Map(),
			presetIdMap: new Map(), maskMatteIdMap: new Map(), projectReferenceIdMap: new Map(),
		},
		presentationIdMap: new Map([['presentation-1', 'presentation-copy']]),
		processorStackIdMap: new Map([['stack-1', 'stack-copy']]),
		processorIdMap: new Map([['tracking-1', 'tracking-copy']]),
		motionAnalysisIdMap: new Map([['analysis-1', 'analysis-copy']]),
		finishingPresetIdMap: new Map(),
		captionTrackIdMap: new Map(),
		projectReferenceIdMap: new Map([
			['main-sequence', 'destination-sequence'],
			['video-source', 'destination-video-source'],
			['video-clip', 'destination-video-clip'],
		]),
	});
	assert.equal(pasted.colorContexts[0]?.sequenceId, 'destination-sequence');
	assert.equal(pasted.sourceColorInterpretations[0]?.sourceId, 'destination-video-source');
	assert.deepEqual(pasted.visualPresentations[0], {
		...clipboard.visualPresentations[0], id: 'presentation-copy',
		owner: { kind: 'clip', id: 'destination-video-clip' }, processorStackId: 'stack-copy',
	});
	assert.equal(pasted.processorStacks[0]?.id, 'stack-copy');
	assert.equal(pasted.processorStacks[0]?.sourceId, 'destination-video-source');
	assert.equal(pasted.processorStacks[0]?.processors[0]?.id, 'tracking-copy');
	assert.equal(pasted.motionAnalyses[0]?.id, 'analysis-copy');
	assert.equal(pasted.motionAnalyses[0]?.processorStackId, 'stack-copy');
	assert.deepEqual(pasted.captionTracks, []);
	assert.deepEqual(pasted.finishingPresets, []);
});

test('clipboard V11 refuses missing, reused, colliding, and unused paste allocations', () => {
	const project = projectWithFinishing();
	const clipboard = createFramescaperFinishingClipboardV11(PROFILE, project, selectedVideoDescriptor(project));
	const options = pasteOptions();
	assert.throws(() => prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		...options, presentationIdMap: new Map(),
	}), /mapping.*presentation|no.*presentation/iu);
	assert.throws(() => prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		...options, presentationIdMap: new Map([['presentation-1', 'presentation-1']]),
	}), /fresh/iu);
	assert.throws(() => prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		...options, captionTrackIdMap: new Map([['unused', 'unused-copy']]),
	}), /unused.*allocation/iu);
});

test('selected V27 clipboard composes foundation paste and finishing graph as one history step', () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = projectWithFinishing();
	const commandProject = runtime.projectForCommandConsumers(project);
	const descriptor = selectedVideoDescriptor(project);
	const clipboard = runtime.createEditSessionClipboard(project, descriptor);
	let serial = 0;
	const createId = (prefix = 'id') => `${prefix}-copy-${String(++serial)}`;
	const base = preparePasteCommand(descriptor, {
		project: commandProject,
		atFrame: 48_000,
		trackMap: { 'video-track': 'video-track' },
		mode: 'overlap',
	}, createId) as Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
	const command = runtime.prepareEditClipboardPasteCommand(project, clipboard, base, createId);
	const history = runtime.executeCommand(runtime.createHistory(project), command, {
		now: '2026-08-23T12:00:00.000Z',
	});
	const descriptorKey = String(descriptor.tracks[0]!.clips[0]!.key);
	assert.ok(base.clipIds);
	const pastedClipId = base.clipIds[descriptorKey]!;
	const presentation = history.present.videoVisualPresentations.find(({ owner }) => owner.id === pastedClipId);
	assert.ok(presentation);
	assert.notEqual(presentation.id, 'presentation-1');
	assert.notEqual(presentation.processorStackId, 'stack-1');
	assert.equal(history.present.videoProcessorStacks.length, 2);
	assert.equal(history.present.videoMotionAnalyses.length, 2);
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(runtime.undo(history, { now: '2026-08-23T12:00:01.000Z' }).present.videoVisualPresentations,
		project.videoVisualPresentations);
});

test('selected V27 visual clip copies through V11 and pastes as a visual instead of foundation video', () => {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	const project = projectWithVisual();
	const clipboardProject = runtime.projectForEditClipboardConsumers(project);
	const descriptor = createClipboardDescriptor(clipboardProject, {
		startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: ['still-clip'],
	});
	assert.equal(descriptor.tracks[0]?.clips[0]?.kind, 'video');
	const clipboard = runtime.createEditSessionClipboard(project, descriptor);
	assert.deepEqual(clipboard.finishing.visual.sources.map(({ id }) => id), ['still-source']);
	assert.deepEqual(clipboard.finishing.visual.clips.map(({ id }) => id), ['still-clip']);
	let serial = 0;
	const createId = (prefix = 'id') => `${prefix}-visual-${String(++serial)}`;
	const base = preparePasteCommand(descriptor, {
		project: clipboardProject, atFrame: 48_000,
		trackMap: { 'video-track': 'video-track' }, mode: 'overlap',
	}, createId) as Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
	const command = runtime.prepareEditClipboardPasteCommand(project, clipboard, base, createId);
	const pasted = runtime.applyCommand(project, command, {
		now: '2026-08-23T12:00:00.000Z',
	}) as unknown as Readonly<{ readonly clips: readonly Readonly<{
		readonly id: string; readonly kind: string; readonly sequenceStartFrame?: number;
	}>[] }>;
	const copies = pasted.clips.filter(({ kind, id }) => kind === 'still' && id !== 'still-clip');
	assert.equal(copies.length, 1);
	assert.equal(copies[0]?.sequenceStartFrame, 10);
	const clipIds = base.clipIds;
	assert.ok(clipIds);
	assert.equal(pasted.clips.some(({ kind, id }) => kind === 'video' && id === clipIds[String(
		descriptor.tracks[0]!.clips[0]!.key,
	)]), false);
});

function pasteOptions() {
	return {
		visual: {
			sourceIdMap: new Map<string, string>(), clipIdMap: new Map<string, string>(),
			adjustmentLayerIdMap: new Map<string, string>(), presetIdMap: new Map<string, string>(),
			maskMatteIdMap: new Map<string, string>(), projectReferenceIdMap: new Map<string, string>(),
		},
		presentationIdMap: new Map([['presentation-1', 'presentation-copy']]),
		processorStackIdMap: new Map([['stack-1', 'stack-copy']]),
		processorIdMap: new Map([['tracking-1', 'tracking-copy']]),
		motionAnalysisIdMap: new Map([['analysis-1', 'analysis-copy']]),
		finishingPresetIdMap: new Map(),
		captionTrackIdMap: new Map(),
		projectReferenceIdMap: new Map([
			['main-sequence', 'destination-sequence'],
			['video-source', 'destination-video-source'],
			['video-clip', 'destination-video-clip'],
		]),
	};
}

function selectedVideoDescriptor(project: ReturnType<typeof projectWithFinishing>) {
	const runtime = createEditorProjectRuntimeV27Selection(PROFILE);
	return createClipboardDescriptor(runtime.projectForCommandConsumers(project), {
		startFrame: 0,
		endFrame: 48_000,
		trackIds: ['video-track'],
	});
}

function projectWithFinishing() {
	return createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			visualPresentations: [{
				schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', grade: null,
				processorStackId: 'stack-1', maskMatteIds: [],
			}],
			processorStacks: [{
				schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors: [{
					schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
					maximumFeatures: 128, quality: 0.05, minimumDistance: 3,
					windowRadius: 3, pyramidLevels: 3,
				}],
			}],
			motionAnalyses: [{
				schemaVersion: 1, id: 'analysis-1', sourceId: 'video-source',
				processorStackId: 'stack-1', inputSha256: 'aa'.repeat(32),
				settingsSha256: 'bb'.repeat(32), storageKey: `motion-sha256:${'bb'.repeat(32)}`,
				sha256: 'bb'.repeat(32), byteLength: 4_096, startFrame: 0, endFrame: 10,
			}],
			finishingPresets: [{
				schemaVersion: 1, kind: 'video-finishing-preset', id: 'finishing-preset-1',
				name: 'Look', template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null },
			}],
			captionTracks: [{
				schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence',
				name: 'English', language: 'en', styles: [], regions: [], speakers: [],
				cues: [{
					schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000,
					text: 'Caption', styleId: null, regionId: null, speakerId: null, words: [],
				}],
			}],
		},
	});
}

function projectWithVisual() {
	const base = framescaperV20Options() as Readonly<Record<string, unknown>>;
	const tracks = structuredClone(base.tracks) as Array<Record<string, unknown>>;
	const videoTrack = tracks.find(({ id }) => id === 'video-track')!;
	videoTrack.clipIds = [...videoTrack.clipIds as string[], 'still-clip'];
	return createFramescaperProjectV27(PROFILE, {
		...base,
		sources: [...base.sources as ReadonlyArray<Readonly<Record<string, unknown>>>, {
			schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Poster',
			mimeType: 'image/png', storageKey: 'still-source', contentSha256: '34'.repeat(32),
			width: 1_920, height: 1_080, hasAlpha: true,
		}],
		clips: [...base.clips as ReadonlyArray<Readonly<Record<string, unknown>>>, {
			schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		}],
		tracks,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { stillSources: [{
			schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Poster',
			mimeType: 'image/png', storageKey: 'still-source', contentSha256: '34'.repeat(32),
			width: 1_920, height: 1_080, hasAlpha: true,
		}] },
	});
}
