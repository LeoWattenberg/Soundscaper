import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityXmlAttribute, createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import {
	aup4ClipTempoStretchRatio,
	readAup4ClipStretch,
	readAup4ClipTiming,
} from '../src/common/editor/aup4-clip-timing.ts';
import { alignWaveClips } from '../src/common/editor/aup4-conversion-wave-clips.js';
import { createAup4CompatibilityReport } from '../src/common/editor/aup4-profile.js';

type AudacityXmlNode = ReturnType<typeof createAudacityXmlNode>;

const closeTo = (actual: number, expected: number): void => {
	assert.ok(Math.abs(actual - expected) < 1e-12, `${String(actual)} != ${String(expected)}`);
};

test('Audacity clip tempo stretch follows the 4.0.1 inheritance matrix', () => {
	const cases: readonly Readonly<{
		name: string;
		rawAudioTempo?: number;
		clipTempo?: number;
		stretchToTempo?: boolean;
		expected: number;
	}>[] = [
		{ name: 'no tempo metadata', expected: 1 },
		{ name: 'zero raw tempo', rawAudioTempo: 0, expected: 1 },
		{ name: 'raw tempo matches project', rawAudioTempo: 188, expected: 1 },
		{ name: 'raw tempo inherits project', rawAudioTempo: 130, expected: 130 / 188 },
		{ name: 'project matching disabled', rawAudioTempo: 130, stretchToTempo: false, expected: 1 },
		{ name: 'explicit clip tempo', rawAudioTempo: 130, clipTempo: 150, expected: 130 / 150 },
		{ name: 'explicit clip tempo while matching is disabled', rawAudioTempo: 130, clipTempo: 150, stretchToTempo: false, expected: 130 / 150 },
		{ name: 'clip tempo without raw tempo', clipTempo: 150, expected: 1 },
	];

	for (const fixture of cases) {
		closeTo(aup4ClipTempoStretchRatio({
			rawAudioTempo: fixture.rawAudioTempo,
			clipTempo: fixture.clipTempo,
			projectTempo: 188,
			stretchToTempo: fixture.stretchToTempo,
		}), fixture.expected);
	}
});

test('legacy Audacity clips inherit project tempo and default tempo matching on', () => {
	const clipNode = createAudacityXmlNode('waveclip', [
		{ kind: 'attribute', name: 'offset', type: 'double', value: 0.5, digits: 8 },
		{ kind: 'attribute', name: 'trimLeft', type: 'double', value: 0.25, digits: 8 },
		{ kind: 'attribute', name: 'trimRight', type: 'double', value: 0.25, digits: 8 },
		{ kind: 'attribute', name: 'clipStretchRatio', type: 'double', value: 188 / 130, digits: 8 },
		{ kind: 'attribute', name: 'rawAudioTempo', type: 'double', value: 130, digits: 8 },
	]);
	const stretch = readAup4ClipStretch(clipNode, 188);
	closeTo(stretch.storedStretchRatio, 188 / 130);
	closeTo(stretch.tempoStretchRatio, 130 / 188);
	closeTo(stretch.stretchRatio, 1);
	assert.equal(stretch.clipTempo, null);
	assert.equal(stretch.rawAudioTempo, 130);
	assert.equal(stretch.stretchToTempo, true);

	const timing = readAup4ClipTiming(clipNode, 96_000, 48_000, 48_000, 188);
	closeTo(timing.stretchRatio, 1);
	assert.equal(timing.stretchToTempo, true);
	assert.equal(timing.trimStartFrames, 12_000);
	assert.equal(timing.trimEndFrames, 12_000);
	assert.equal(timing.sourceDurationFrames, 72_000);
	assert.equal(timing.timelineStartFrame, 36_000);
	assert.equal(timing.durationFrames, 72_000);
});

test('linked-channel alignment compares inherited-tempo effective durations', () => {
	const clip = (
		name: string,
		storedStretchRatio: number,
		rawAudioTempo?: number,
	) => createAudacityXmlNode('waveclip', [
		{ kind: 'attribute', name: 'name', type: 'string', value: name },
		{ kind: 'attribute', name: 'offset', type: 'double', value: 0, digits: 8 },
		{ kind: 'attribute', name: 'clipStretchRatio', type: 'double', value: storedStretchRatio, digits: 8 },
		...(rawAudioTempo == null ? [] : [{
			kind: 'attribute' as const,
			name: 'rawAudioTempo',
			type: 'double',
			value: rawAudioTempo,
			digits: 8,
		}]),
	], [createAudacityXmlNode('sequence', [
		{ kind: 'attribute', name: 'numsamples', type: 'long-long', value: 48_000 },
	])]);
	const track = (channel: number, clips: AudacityXmlNode[]) => createAudacityXmlNode('wavetrack', [
		{ kind: 'attribute', name: 'channel', type: 'int', value: channel },
	], clips);
	const leaderA = clip('A', 188 / 130, 130);
	const leaderB = clip('B', 188 / 130, 260);
	const followerA = clip('A', 1);
	const followerB = clip('B', 2);
	const state = {
		warnings: [] as string[],
		compatibilityReport: createAup4CompatibilityReport('open'),
	};
	const aligned = alignWaveClips([
		track(0, [leaderA, leaderB]),
		track(1, [followerB, followerA]),
	], [48_000, 48_000], state, 0, 188) as Array<Array<AudacityXmlNode | null>>;

	assert.deepEqual(aligned.map((row) => row.map((node) => audacityXmlAttribute(node, 'name'))), [
		['A', 'A'],
		['B', 'B'],
	]);
});
