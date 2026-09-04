/* SPDX-License-Identifier: AGPL-3.0-only */

// Project fixtures the AUP4 export suites share: the projects each plan is built
// from and the PCM the exporter is handed for them. Split out of
// aup4-export.test.js so its suites can sit in separate files.

import {
	createAup4SampleBlock,
} from '../../src/common/editor/aup4-profile.js';

export function fixtureProject(overrides) {
	return {
		id: 'project',
		title: 'AUP4 export fixture',
		sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: 0, trackIds: [] },
		metadata: {},
		master: { effects: [] },
		...overrides,
	};
}

export function source(id, sampleRate, channelCount, frameCount) {
	return {
		id,
		name: id,
		storageKey: id,
		mimeType: 'audio/wav',
		sampleRate,
		originalSampleRate: sampleRate,
		channelCount,
		frameCount,
		sampleFormat: 'float32',
	};
}

export function clip(id, sourceId, overrides = {}) {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 1,
		durationFrames: 1,
		trimStartFrames: 0,
		trimEndFrames: 0,
		envelope: [],
		...overrides,
	};
}

export function track(id, clipIds) {
	return { id, type: 'audio', name: id, clipIds, effects: [] };
}

export function videoSource(id, frameCount) {
	return {
		kind: 'video',
		id,
		name: id,
		storageKey: id,
		mimeType: 'video/mp4',
		sampleRate: 48_000,
		frameCount,
		width: 1920,
		height: 1080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	};
}

export function videoClip(id, sourceId, overrides = {}) {
	return {
		kind: 'video',
		id,
		sourceId,
		title: id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 1,
		durationFrames: 1,
		trimStartFrames: 0,
		trimEndFrames: 0,
		avLinkId: null,
		binItemId: null,
		...overrides,
	};
}

export function blockMap(sources) {
	const blocks = new Map();
	let blockId = 0;
	for (const sourceAudio of sources) {
		for (let channel = 0; channel < sourceAudio.channels.length; channel += 1) {
			blocks.set(`${sourceAudio.sourceId}:${channel}`, [{
				blockId: ++blockId,
				start: 0,
				sampleCount: sourceAudio.channels[channel].length,
			}]);
		}
	}
	return blocks;
}

export function nativeBlockFixture(sources) {
	const channelBlocks = new Map();
	const sampleBlocks = new Map();
	let blockId = 0;
	for (const sourceAudio of sources) {
		for (let channel = 0; channel < sourceAudio.channels.length; channel += 1) {
			const samples = sourceAudio.channels[channel];
			const id = ++blockId;
			sampleBlocks.set(id, createAup4SampleBlock(samples));
			channelBlocks.set(`${sourceAudio.sourceId}:${channel}`, [{
				blockId: id,
				start: 0,
				sampleCount: samples.length,
			}]);
		}
	}
	return { channelBlocks, sampleBlocks };
}
