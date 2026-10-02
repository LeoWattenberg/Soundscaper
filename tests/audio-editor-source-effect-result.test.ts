/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectResultService, type EffectResultCommitOptions } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

test('source effects persist full media without changing the main timeline selection', async () => {
	const commits: Array<{ command: AudioEditorCommand; options: EffectResultCommitOptions }> = [];
	let written: Float32Array | null = null;
	const service = createSelectionEffectResultService({
		expandSourceResult: async (_target, channels) => [Float32Array.of(1, ...channels[0]!, 6)],
		SOURCE_CHUNK_FRAMES: 65_536,
		assertAudacityEffectOutput: () => {}, audioSelectionEffectLabel: () => 'Effect',
		bufferFromChannels: async (channels, sampleRate) => ({ length: channels[0]!.length, sampleRate,
			numberOfChannels: channels.length, getChannelData: (index: number) => channels[index]!,
		}),
		cacheSourceBuffer: () => {}, commit: (command, options) => { commits.push({ command, options }); },
		copy: { audioAnalysisFailed: '', audioAnalysisWorkerFailed: '', audioBufferUnsupported: '', audacityProjectTooLong: '',
			decodedAudioEmpty: '', decodedChannelLengthsMismatch: '', effectChannelLayoutChanged: '', effectChannelLengthsMismatch: '', effectInvalidAudio: '',
		},
		createStableId: () => 'processed', engine: { getAudioContext: async () => ({}) },
		generateWaveformPeaks: async () => ({}), peakCacheKey: (id) => id,
		preparePasteCommand: () => { throw new Error('Unexpected timeline paste'); },
		prepareRangeDeleteCommand: () => { throw new Error('Unexpected timeline delete'); },
		prepareRangeReplacementCommand: () => { throw new Error('Unexpected timeline replacement'); },
		getProject: () => ({ id: 'project' }), projectSampleRate: () => 48_000,
		sourceBuffers: new Map(), sourcePeaks: new Map(), state: { selectedTrackId: 'track-a' },
		store: { beginSourceWrite: async () => ({ write: () => {}, commit: () => {}, abort: () => {} }),
			saveAnalysis: async () => {}, deleteSource: async () => {},
		},
		throwIfAborted: () => {}, writeBuffer: async (_writer, buffer) => { written = buffer.getChannelData(0); },
	});
	await service.persistAudacityEffectResults([{
		target: { track: { id: 'source-editor:source', name: 'Recording', type: 'audio' },
			sourceId: 'source', sourceTrackId: 'track-a', sourceClipId: 'clip-a',
			sourceSampleRate: 24_000,
			startFrame: 1, endFrame: 5, durationFrames: 4, channelCount: 1, hasAudio: true,
		}, channels: [Float32Array.of(2, 3, 4, 5)],
	}], 'audacity-amplify');
	assert.deepEqual(written, Float32Array.of(1, 2, 3, 4, 5, 6));
	const commit = commits[0]!;
	assert.equal(commit.command.type, 'batch');
	if (commit.command.type !== 'batch') return;
	assert.equal(commit.command.commands.length, 1);
	const command = commit.command.commands[0]!;
	assert.equal(command.type, 'source/process-audio');
	if (command.type !== 'source/process-audio') return;
	assert.equal(command.source.frameCount, 6);
	assert.equal(command.source.sampleRate, 24_000);
	assert.equal(command.sourceId, 'source');
	assert.deepEqual(commit.options, { selectTrackId: 'track-a', selectClipId: 'clip-a' });
});
