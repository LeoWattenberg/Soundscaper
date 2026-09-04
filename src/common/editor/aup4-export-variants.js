/* SPDX-License-Identifier: AGPL-3.0-only */

// Rendering a project's source PCM into the fixed rate and channel layout an
// AUP4 variant declares: the downmix and upmix matrices, the streaming
// resample, and the identifier each rendered variant is stored under. Split out
// of aup4-export.js; no behaviour changes here.

import { createStreamingWindowedSincResampler } from './resample.js';
import { scaleSampleFrame } from './timeline-time.ts';
import { applyMaterialTransform, normalizeInputChannels } from './aup4-export-material.js';
import { exportError, positiveRate } from './aup4-export-values.js';

function assertExportPlan(plan) {
	if (!plan?.project || !Array.isArray(plan.sources)) throw exportError('An AUP4 export plan is required.', 'INVALID_SNAPSHOT');
}


/**
 * Materialize every native variant derived from one original source. The
 * result can be written and released before the next source is requested.
 */
export function normalizeAup4ExportSource(plan, sourceAudio) {
	assertExportPlan(plan);
	const sourceId = String(sourceAudio?.sourceId || '');
	const variants = plan.sources.filter((variant) => variant.inputSourceId === sourceId);
	if (!variants.length) return [];
	const inputSource = variants[0].inputSource;
	const inputChannels = normalizeInputChannels(sourceAudio.channels, inputSource);
	const sourceRate = positiveRate(inputSource.sampleRate ?? sourceAudio.sampleRate, `source ${sourceId} sampleRate`);
	return variants.map((variant) => {
		const mappedChannels = mapChannels(inputChannels, variant.targetChannels);
		const convertedChannels = sourceRate === variant.targetRate
			? mappedChannels.map((channel) => channel.slice())
			: resampleChannels(mappedChannels, sourceRate, variant.targetRate);
		const channels = applyMaterialTransform(
			convertedChannels,
			variant.transform,
			sourceRate,
			variant.targetRate,
		);
		if (channels.some((channel) => channel.length !== variant.source.frameCount)) {
			throw exportError(`AUP4 source ${sourceId} normalization produced an invalid frame count.`, 'INVALID_SOURCE_AUDIO');
		}
		return { sourceId: variant.source.id, sampleRate: variant.targetRate, channels };
	});
}

export function mapChannels(channels, targetChannels) {
	if (targetChannels === 1) return [channels[0]];
	if (channels.length === 1) return [channels[0], channels[0]];
	if (channels.length === 2) return channels;
	const frameCount = channels[0].length;
	const left = channels[0].slice();
	const right = channels[1].slice();
	if (channels.length === 3) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
	} else if (channels.length === 4) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[3], Math.SQRT1_2);
	} else if (channels.length === 5) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
		mixInto(left, channels[3], Math.SQRT1_2);
		mixInto(right, channels[4], Math.SQRT1_2);
	} else {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
		mixInto(left, channels[3], 0.5);
		mixInto(right, channels[3], 0.5);
		mixInto(left, channels[4], Math.SQRT1_2);
		mixInto(right, channels[5], Math.SQRT1_2);
		for (let channel = 6; channel < channels.length; channel += 1) {
			mixInto(channel % 2 ? right : left, channels[channel], 0.5);
		}
	}
	if (left.length !== frameCount || right.length !== frameCount) throw exportError('AUP4 channel downmix failed.', 'INVALID_SOURCE_AUDIO');
	return [left, right];
}

function mixInto(output, input, gain) {
	for (let frame = 0; frame < output.length; frame += 1) output[frame] += input[frame] * gain;
}

export function resampleChannels(channels, inputRate, outputRate) {
	const outputFrames = Math.max(1, scaleSampleFrame(channels[0].length, inputRate, outputRate, 'point'));
	const resampler = createStreamingWindowedSincResampler(inputRate, outputRate, channels.length);
	const head = resampler.push(channels); const tail = resampler.finish(outputFrames);
	return head.map((values, channel) => {
		const output = new Float32Array(values.length + tail[channel].length);
		output.set(values);
		output.set(tail[channel], values.length);
		return output.length === outputFrames ? output : output.slice(0, outputFrames);
	});
}

export function uniqueVariantId(sourceId, sampleRate, channelCount, usedIds) {
	const base = `${sourceId}-aup4-${sampleRate}-${channelCount}ch`;
	let id = base;
	let suffix = 1;
	while (usedIds.has(id)) id = `${base}-${++suffix}`;
	usedIds.add(id);
	return id;
}
