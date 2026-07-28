import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

function plan(version = 4) {
	const videoEffects: Array<Record<string, unknown>> = [];
	return {
		version,
		format: 'webm', container: 'webm', extension: 'webm', mimeType: 'video/webm', durationSeconds: 1,
		canvas: { width: 320, height: 180, frameRate: 30, pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		codecs: { video: 'vp9', videoEncoder: 'libvpx-vp9', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		inputs: [{ kind: 'video-source', inputIndex: 0, sourceId: 'source', mimeType: 'video/webm' }],
		intervals: [{
			kind: 'composition', durationSeconds: 1,
			layers: [{
				trackId: 'track',
				clips: [{
					role: 'single', inputIndex: 0, sourceId: 'source', sourceStartTimeSeconds: 0,
					sourceEndTimeSeconds: 1, playbackRate: 1, opacityStart: 1, opacityEnd: 1,
					videoEffects,
				}],
			}],
		}],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

test('render-plan V4 expands the second batch in stack order before padding', () => {
	const value = plan();
	value.intervals[0].layers[0].clips[0].videoEffects = [
		createVideoEffect('chroma-key', { id: 'chroma' }),
		createVideoEffect('luma-key', { id: 'luma', params: { mode: 1 } }),
		createVideoEffect('spill-suppression', { id: 'spill' }),
		createVideoEffect('glow', { id: 'glow' }),
		createVideoEffect('outline', { id: 'outline' }),
		createVideoEffect('drop-shadow', { id: 'shadow' }),
	];
	const args = buildVideoFfmpegArgs(value, { videoInputPaths: { source: '/source.webm' } }, '/output.webm');
	const graph = args[args.indexOf('-filter_complex') + 1];
	const positions = [
		graph.indexOf('format=pix_fmts=yuva444p,chromakey=color=0x00ff00:similarity=0.1:blend=0.1'),
		graph.indexOf('format=pix_fmts=yuva444p,lumakey=threshold=1:tolerance=0.8:softness=0.1'),
		graph.indexOf('despill=type=green:mix=0.5:red=0:green=-0.5:blue=0:expand=0:brightness=0:alpha=0'),
		graph.indexOf("geq=r='r(X,Y)*max("),
		graph.indexOf('dilation=coordinates=255'),
		graph.indexOf('overlay=x=8:y=8'),
	];
	assert.ok(positions.every((position) => position >= 0));
	assert.deepEqual([...positions].sort((left, right) => left - right), positions);
	assert.ok(graph.indexOf('pad=w=320:h=180') > (positions.at(-1) ?? -1));
	assert.doesNotMatch(graph, /movie=|sendcmd=|zmq=/u);
});

test('render-plan V3 rejects second-batch types while V4 rejects malformed values', () => {
	const legacy = plan(3);
	legacy.intervals[0].layers[0].clips[0].videoEffects = [createVideoEffect('glow', { id: 'glow' })];
	assert.throws(
		() => buildVideoFfmpegArgs(legacy, { videoInputPaths: { source: '/source.webm' } }, '/output.webm'),
		/not supported by this schema/u,
	);
	const malformed = plan();
	malformed.intervals[0].layers[0].clips[0].videoEffects = [{
		id: 'key', type: 'chroma-key', enabled: true,
		params: { keyColor: 0x00ff00, similarity: Number.NaN, softness: 0.1 },
	}];
	assert.throws(
		() => buildVideoFfmpegArgs(malformed, { videoInputPaths: { source: '/source.webm' } }, '/output.webm'),
		/similarity must be between/u,
	);
});
