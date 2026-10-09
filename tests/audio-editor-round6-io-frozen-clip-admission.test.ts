/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { installAudioTrackFreezeCandidateV21, removeAudioTrackFreezeCandidateV21 } from '../src/common/editor/audio-track-freeze-lifecycle-v21.ts';
import { exportClipCount, resolveExportClips } from '../src/common/editor/export-clip-boundaries.ts';
import ExportOutputHints from '../src/common/editor/ui/inspector/ExportOutputHints.tsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

function projects() {
	const source = createAudioSource({ id: 'voice', sampleRate: 48_000, frameCount: 512,
		channelCount: 2, contentSha256: 'ab'.repeat(32) });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512 });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id],
		effects: [{ id: 'delay', type: 'delay', enabled: true, params: {} }] });
	const project = createSoundscaperProject({ id: 'programme', sources: [source], clips: [clip], tracks: [track] });
	const sourceContentIdentities = [{ sourceId: source.id, contentSha256: source.contentSha256! }];
	const freeze = { schemaVersion: 1 as const, derivedSourceId: 'frozen', renderStartFrame: 0,
		renderFrameCount: 1024, capturePosition: 'post-insert-pre-strip' as const,
		...computeAudioTrackFreezeDigestsV1({ sampleRate: project.sampleRate, renderStartFrame: 0,
			renderFrameCount: 1024, track, clips: [clip], sourceContentIdentities,
			automationLanes: [], tempoMap: project.tempoMap }) };
	const frozen = installAudioTrackFreezeCandidateV21(project, { trackId: track.id,
		expectedFreeze: null, replacementFreeze: freeze, sourceContentIdentities,
		derivedSource: createAudioSource({ id: freeze.derivedSourceId, sampleRate: project.sampleRate,
			frameCount: freeze.renderFrameCount, channelCount: 2, contentSha256: 'cd'.repeat(32) }) });
	return { project, frozen, freeze };
}

test('ordinary editable audio offers Individual clips', () => {
	const { project } = projects();
	assert.equal(exportClipCount(project), 1);
});

test('a verified freeze retains its editable clips but cannot offer their independent export', () => {
	const { frozen } = projects();
	const before = structuredClone(frozen);
	assert.equal(resolveExportClips(frozen, { startFrame: 0, endFrame: 1024 }).length, 1);
	assert.equal(exportClipCount(frozen), 0);
	assert.deepEqual(structuredClone(frozen), before);
});

test('ordinary Unfreeze restores independent clip export', () => {
	const { frozen, freeze } = projects();
	assert.equal(exportClipCount(removeAudioTrackFreezeCandidateV21(frozen, {
		trackId: 'track', expectedFreeze: freeze,
	})), 1);
});

test('the export surface explains the frozen choice in both maintained locales', () => {
	const { project, frozen } = projects();
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		const hints = renderToStaticMarkup(React.createElement(ExportOutputHints, { copy, project: frozen, noLabelsHint: 'Chapter help' }));
		assert.ok(hints.includes('data-export-clips-unavailable'));
		assert.ok(hints.includes(copy.exportOutputClipsFrozen));
		assert.ok(hints.includes('Chapter help'));
		assert.equal(renderToStaticMarkup(React.createElement(ExportOutputHints, { copy, project, noLabelsHint: null })), '');
		assert.equal(renderToStaticMarkup(React.createElement(ExportOutputHints, { copy, project: frozen, noLabelsHint: null, singleFileOnly: true })), '');
	}
});
