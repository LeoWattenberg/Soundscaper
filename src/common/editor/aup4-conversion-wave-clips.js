/* SPDX-License-Identifier: AGPL-3.0-only */

// Turning Audacity's per-channel wave tracks back into the browser's clips. A
// stereo track is two sibling wave tracks whose clips have to be matched by
// timeline position rather than by order, their rates reconciled, and any clip
// Audacity 4 no longer supports counted rather than silently dropped. Split out
// of aup4-conversion.js; no behaviour changes here.

import {
	audacityXmlAttribute,
	audacityXmlChildren,
} from './audacity-binary-xml.js';
import { createStreamingWindowedSincResampler } from './resample.js';
import { addAup4CompatibilityItem } from './aup4-profile.js';
import { scaleSampleFrame } from './timeline-time.ts';
import { readPitchAndSpeedPreset } from './aup4-conversion-settings.js';
import {
	booleanValue,
	finite,
	nonNegative,
	nonNegativeInteger,
	optionalPositive,
	positive,
	warn,
} from './aup4-conversion-values.js';

export function groupWaveTracks(nodes, state) {
	const groups = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const first = nodes[index];
		const linked = Number(audacityXmlAttribute(first, 'linked', 0)) !== 0;
		const channel = Number(audacityXmlAttribute(first, 'channel', 0));
		const nextChannel = Number(audacityXmlAttribute(nodes[index + 1], 'channel', -1));
		if (linked && nodes[index + 1] && channel === 0 && nextChannel === 1) {
			groups.push([first, nodes[++index]]);
			continue;
		}
		if (linked) {
			warn(state, `Audacity wave track ${index + 1} declares a linked channel without a matching follower and was imported separately.`);
			addAup4CompatibilityItem(state.compatibilityReport, {
				code: 'LINKED_CHANNEL_MISMATCH',
				severity: 'warning',
				disposition: 'converted',
				scope: { kind: 'track', trackIndex: index },
				data: { reason: 'missing-follower', channel, nextChannel },
			});
		}
		groups.push([first]);
	}
	return groups;
}

export function alignWaveClips(group, channelRates, state, trackIndex) {
	const clipsByChannel = group.map((node) => audacityXmlChildren(node, 'waveclip'));
	if (group.length === 1) return clipsByChannel[0].map((node) => [node]);
	const rows = clipsByChannel[0].map((node) => [node, null]);
	const leaderTimelines = clipsByChannel[0].map((node) => waveClipTimeline(node, channelRates[0]));
	const unmatchedLeaderIndexes = new Set(rows.map((_row, index) => index));
	let mismatch = clipsByChannel[0].length !== clipsByChannel[1].length;
	for (const follower of clipsByChannel[1]) {
		const followerTimeline = waveClipTimeline(follower, channelRates[1]);
		const candidates = [...unmatchedLeaderIndexes]
			.filter((index) => clipStartsAlign(leaderTimelines[index], followerTimeline))
			.sort((left, right) => (
				Math.abs(leaderTimelines[left].duration - followerTimeline.duration)
				- Math.abs(leaderTimelines[right].duration - followerTimeline.duration)
			));
		const rowIndex = candidates[0];
		if (rowIndex == null) {
			rows.push([null, follower]);
			mismatch = true;
		} else {
			unmatchedLeaderIndexes.delete(rowIndex);
			rows[rowIndex][1] = follower;
			const leaderTimeline = leaderTimelines[rowIndex];
			const tolerance = clipTimelineTolerance(leaderTimeline, followerTimeline);
			if (Math.abs(leaderTimeline.duration - followerTimeline.duration) > tolerance
				|| waveClipSemanticKey(rows[rowIndex][0]) !== waveClipSemanticKey(follower)) {
				mismatch = true;
			}
		}
	}
	if (rows.some((row) => !row[0] || !row[1])) mismatch = true;
	if (mismatch) {
		warn(state, `Linked channels in track ${trackIndex + 1} had mismatched clip timelines; absent channel regions were replaced with silence.`);
		addAup4CompatibilityItem(state.compatibilityReport, {
			code: 'LINKED_CHANNEL_MISMATCH',
			severity: 'warning',
			disposition: 'converted',
			scope: { kind: 'track', trackIndex },
			data: {
				leaderClipCount: clipsByChannel[0].length,
				followerClipCount: clipsByChannel[1].length,
			},
		});
	}
	return rows;
}

function waveClipTimeline(node, rate) {
	const sequence = audacityXmlChildren(node, 'sequence')[0];
	const storedStretchRatio = positive(audacityXmlAttribute(node, 'clipStretchRatio', 1), 1);
	const clipTempo = optionalPositive(audacityXmlAttribute(node, 'clipTempo', null));
	const rawAudioTempo = optionalPositive(audacityXmlAttribute(node, 'rawAudioTempo', null));
	const stretchRatio = storedStretchRatio * (clipTempo != null && rawAudioTempo != null ? rawAudioTempo / clipTempo : 1);
	const trimLeft = nonNegative(audacityXmlAttribute(node, 'trimLeft', 0));
	const trimRight = nonNegative(audacityXmlAttribute(node, 'trimRight', 0));
	const sampleCount = nonNegativeInteger(audacityXmlAttribute(sequence, 'numsamples', 0), 0);
	return {
		rate,
		start: finite(audacityXmlAttribute(node, 'offset', 0), 0) + trimLeft,
		duration: Math.max(0, sampleCount * stretchRatio / rate - trimLeft - trimRight),
	};
}

function clipStartsAlign(left, right) {
	return Math.abs(left.start - right.start) <= clipTimelineTolerance(left, right);
}

function clipTimelineTolerance(left, right) {
	return Math.max(1 / left.rate, 1 / right.rate) * 1.5 + 1e-9;
}

function waveClipSemanticKey(node) {
	return JSON.stringify([
		String(audacityXmlAttribute(node, 'name', '')),
		finite(audacityXmlAttribute(node, 'trimLeft', 0), 0),
		finite(audacityXmlAttribute(node, 'trimRight', 0), 0),
		finite(audacityXmlAttribute(node, 'clipStretchRatio', 1), 1),
		optionalPositive(audacityXmlAttribute(node, 'clipTempo', null)),
		optionalPositive(audacityXmlAttribute(node, 'rawAudioTempo', null)),
		finite(audacityXmlAttribute(node, 'centShift', 0), 0),
		readPitchAndSpeedPreset(node),
		booleanValue(audacityXmlAttribute(node, 'clipStretchToMatchTempo', false), false),
		String(audacityXmlAttribute(node, 'groupId', -1)),
		String(audacityXmlAttribute(node, 'colorindex', audacityXmlAttribute(node, 'color', 'auto'))),
		audacityXmlChildren(node, 'envelope')[0] || null,
	]);
}

export function countWaveBlocks(root) {
	let count = 0;
	for (const track of audacityXmlChildren(root, 'wavetrack')) for (const clip of audacityXmlChildren(track, 'waveclip')) {
		for (const sequence of audacityXmlChildren(clip, 'sequence')) count += audacityXmlChildren(sequence, 'waveblock').length;
	}
	return count;
}

export function countUnsupportedWaveClips(root) {
	let count = 0;
	const visit = (node, parent = null) => {
		if (node?.name === 'waveclip' && parent?.name !== 'wavetrack') count += 1;
		for (const child of audacityXmlChildren(node)) visit(child, node);
	};
	visit(root);
	return count;
}
export function resampleMono(input, inputRate, outputRate) {
	if (!input.length || inputRate === outputRate) return input;
	const outputFrames = Math.max(1, scaleSampleFrame(input.length, inputRate, outputRate));
	const resampler = createStreamingWindowedSincResampler(inputRate, outputRate, 1);
	const head = resampler.push([input])[0];
	const tail = resampler.finish(outputFrames)[0];
	const output = new Float32Array(head.length + tail.length);
	output.set(head);
	output.set(tail, head.length);
	return output.length === outputFrames ? output : output.slice(0, outputFrames);
}
