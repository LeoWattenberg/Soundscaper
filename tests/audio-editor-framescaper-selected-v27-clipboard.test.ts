/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperFinishingClipboardV11,
	normalizeFramescaperFinishingClipboardV11,
	prepareFramescaperFinishingClipboardPasteV11,
} from '../src/framescaper/editor-session-clipboard-v11.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected clipboard V11 carries V24 visuals and V27 finishing without M5 state', () => {
	const project = projectWithFinishing();
	const clipboard = createFramescaperFinishingClipboardV11(PROFILE, project);
	assert.equal(clipboard.schemaVersion, 11);
	assert.equal(clipboard.visual.schemaVersion, 8);
	assert.equal(clipboard.visualPresentations[0]?.id, 'presentation-1');
	assert.equal(clipboard.processorStacks[0]?.id, 'stack-1');
	assert.equal(clipboard.motionAnalyses[0]?.id, 'analysis-1');
	assert.equal(clipboard.captionTracks[0]?.id, 'captions-en');
	assert.equal(Object.hasOwn(clipboard, 'effects'), false);
	assert.equal(Object.hasOwn(clipboard, 'nativeVideoSources'), false);
	assert.deepEqual(normalizeFramescaperFinishingClipboardV11(structuredClone(clipboard)), clipboard);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11({ ...clipboard, schemaVersion: 10 }),
		/V11.*re-copy|requires V11/iu,
	);
});

test('clipboard V11 paste uses caller-owned fresh identities and remaps every finishing reference', () => {
	const clipboard = createFramescaperFinishingClipboardV11(PROFILE, projectWithFinishing());
	const pasted = prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		visual: {
			sourceIdMap: new Map(), clipIdMap: new Map(), adjustmentLayerIdMap: new Map(),
			presetIdMap: new Map(), maskMatteIdMap: new Map(), projectReferenceIdMap: new Map(),
		},
		presentationIdMap: new Map([['presentation-1', 'presentation-copy']]),
		processorStackIdMap: new Map([['stack-1', 'stack-copy']]),
		processorIdMap: new Map([['tracking-1', 'tracking-copy']]),
		motionAnalysisIdMap: new Map([['analysis-1', 'analysis-copy']]),
		finishingPresetIdMap: new Map([['finishing-preset-1', 'finishing-preset-copy']]),
		captionTrackIdMap: new Map([['captions-en', 'captions-copy']]),
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
	assert.equal(pasted.captionTracks[0]?.id, 'captions-copy');
	assert.equal(pasted.captionTracks[0]?.sequenceId, 'destination-sequence');
	assert.equal(pasted.finishingPresets[0]?.id, 'finishing-preset-copy');
	assert.notStrictEqual(pasted.captionTracks[0]?.cues, clipboard.captionTracks[0]?.cues);
});

test('clipboard V11 refuses missing, reused, colliding, and unused paste allocations', () => {
	const clipboard = createFramescaperFinishingClipboardV11(PROFILE, projectWithFinishing());
	const options = pasteOptions();
	assert.throws(() => prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		...options, presentationIdMap: new Map(),
	}), /mapping.*presentation|no.*presentation/iu);
	assert.throws(() => prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		...options, presentationIdMap: new Map([['presentation-1', 'presentation-1']]),
	}), /fresh/iu);
	assert.throws(() => prepareFramescaperFinishingClipboardPasteV11(clipboard, {
		...options, captionTrackIdMap: new Map([
			['captions-en', 'captions-copy'], ['unused', 'unused-copy'],
		]),
	}), /unused.*allocation/iu);
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
		finishingPresetIdMap: new Map([['finishing-preset-1', 'finishing-preset-copy']]),
		captionTrackIdMap: new Map([['captions-en', 'captions-copy']]),
		projectReferenceIdMap: new Map([
			['main-sequence', 'destination-sequence'],
			['video-source', 'destination-video-source'],
			['video-clip', 'destination-video-clip'],
		]),
	};
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
