/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1, normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

const runtime = createEditorProjectRuntimeSelection(PROFILE);
const rate30 = { num: 30, den: 1 };
const rate25 = { num: 25, den: 1 };
type Kind = 'generator' | 'still' | 'image';

for (const kind of ['generator', 'still', 'image'] as const) {
	test(`sequence rate conforms ${kind} absolute boundaries while preserving native source time and history`, () => {
		const before = authored(kind);
		const updated = runtime.executeCommand(before, { type: 'sequence/update', sequenceId: 'main-sequence', changes: { rate: rate25 } });
		const clip = updated.present.clips.find(item => item.id === 'visual');
		assert.ok(clip);
		assert.deepEqual([clip.sequenceStartFrame, clip.sequenceFrameCount], [25, 125]);
		assert.deepEqual(updated.present.sources, before.present.sources);
		const original = before.present.clips.find(item => item.id === 'visual');
		assert.ok(original);
		assert.deepEqual(clip, { ...original, sequenceStartFrame: 25, sequenceFrameCount: 125 });
		const binClip = updated.present.projectBin.clips.find(item => item.id === 'bin-visual');
		assert.ok(binClip);
		assert.deepEqual([binClip.sequenceStartFrame, binClip.sequenceFrameCount], [25, 125]);
		const undone = runtime.undo(updated);
		assert.deepEqual(undone.present, { ...before.present, revision: undone.present.revision, updatedAt: undone.present.updatedAt });
		const redone = runtime.redo(undone);
		assert.deepEqual(redone.present, { ...updated.present, revision: redone.present.revision, updatedAt: redone.present.updatedAt });
		assert.deepEqual(before.present.sequences[0]?.rate, rate30);
	});
	test(`same sequence rate leaves ${kind} placement unchanged`, () => {
		const before = authored(kind);
		const updated = runtime.executeCommand(before, { type: 'sequence/update', sequenceId: 'main-sequence', changes: { rate: rate30 } });
		assert.deepEqual(updated.present.clips, before.present.clips);
		assert.deepEqual(updated.present.sources, before.present.sources);
		assert.deepEqual(updated.present.projectBin, before.present.projectBin);
	});
}

function authored(kind: Kind) {
	const options = framescaperBaselineOptions();
	options.sequences = [{ id: 'main-sequence', rate: rate30, trackIds: ['video-track', 'audio-track'] }];
	let history = runtime.createHistory(createFramescaperProject(PROFILE, options));
	const placement = { scope: 'timeline', trackId: 'video-track' };
	const common = { schemaVersion: 1, kind, id: 'visual', sourceId: 'visual-source', sequenceId: 'main-sequence', sequenceStartFrame: 30, sequenceFrameCount: 150 };
	if (kind === 'image') {
		const source = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind, id: 'visual-source', name: 'Poster',
			mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: 'visual-source', contentSha256: '11'.repeat(32), assetByteLength: 4096,
			original: { fileName: 'poster.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: 128, sha256: '22'.repeat(32) },
			canonical: { width: 640, height: 360, hasAlpha: true, frameCount: 1, durationTicks: '1000000', timingMode: 'fallback' },
			conversionReceiptSha256: '33'.repeat(32) });
		const clip = normalizeFramescaperImageClipV1({ ...common, sourceStartTicks: '100000' });
		history = runtime.executeCommand(history, { type: 'batch', commands: [
			{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
			{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement },
			{ type: 'image-clip/set', clipId: 'bin-visual', expectedClip: null, expectedPlacement: null,
				clip: { ...clip, id: 'bin-visual' }, placement: { scope: 'project-bin' } },
		] });
	} else {
		const source = kind === 'still' ? normalizeVideoStillSourceV1({ schemaVersion: 1, kind, id: 'visual-source', name: 'Poster',
			mimeType: 'image/png', storageKey: 'poster', contentSha256: '11'.repeat(32), width: 640, height: 360, hasAlpha: true })
			: normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind, id: 'visual-source', name: 'Title', width: 640, height: 360,
				frameRate: rate30, frameCount: 180, generator: { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans',
					fontSize: 96, color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' } });
		const clip = kind === 'still' ? normalizeVideoStillClipV1(common)
			: normalizeVideoGeneratorClipV1({ ...common, sourceInFrame: 30, sourceFrameCount: 150 });
		history = runtime.executeCommand(history, { type: 'batch', commands: [
			{ type: 'video-visual-source/set', sourceId: source.id, expectedSource: null, source },
			{ type: 'video-visual-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement },
			{ type: 'video-visual-clip/set', clipId: 'bin-visual', expectedClip: null, expectedPlacement: null,
				clip: { ...clip, id: 'bin-visual' }, placement: { scope: 'project-bin' } },
		] });
	}
	return runtime.createHistory(history.present);
}
