/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import {
	automationNormalizedToValueV21,
	automationValueToNormalizedV21,
	createTrackAutomationTargetInventoryV21,
	quantizeAutomationValueV21,
} from '../src/common/editor/track-automation-targets-v21.ts';

test('track automation targets lead with strip controls and retain rack descriptor order', () => {
	const filter = createEffect('highpass', {
		id: 'filter',
		params: { frequency: 1_000, q: 2 },
	});
	const blocked = createEffect('delay', { id: 'delay' });
	const project = {
		sampleRate: 48_000,
		tracks: [{
			id: 'voice', type: 'audio', name: 'Voice', gain: 0.75, pan: -0.25, mute: true,
			effects: [filter, blocked], clipIds: [],
		}],
		automationLanes: [{
			id: 'pan-lane',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' },
			timebase: 'absolute-samples',
			points: [{ id: 'pan-origin', position: 0, value: 0 }],
			segments: [],
		}, {
			id: 'send-lane',
			address: { kind: 'edge', edgeId: 'voice-reverb', parameterId: 'level' },
			timebase: 'absolute-samples',
			points: [{ id: 'send-origin', position: 0, value: 0.25 }],
			segments: [],
		}],
		mixer: {
			groups: [],
			sends: [{ id: 'reverb', name: 'Vocal reverb' }],
			cues: [],
			edges: [{
				id: 'voice-master', kind: 'assignment', level: 1,
				source: { kind: 'track', id: 'voice' }, destination: { kind: 'master' },
			}, {
				id: 'voice-reverb', kind: 'send', level: 0.25,
				source: { kind: 'track', id: 'voice' },
				destination: { kind: 'mixer-node', id: 'reverb' },
			}, {
				id: 'other-reverb', kind: 'send', level: 0.5,
				source: { kind: 'track', id: 'other' },
				destination: { kind: 'mixer-node', id: 'reverb' },
			}],
		},
	};
	const targets = createTrackAutomationTargetInventoryV21(project, 'voice');

	assert.deepEqual(targets.slice(0, 3).map(({ label, currentValue }) => [label, currentValue]), [
		['Volume', 0.75], ['Pan', -0.25], ['Mute', 1],
	]);
	assert.equal(targets[0]?.groupLabel, 'Track');
	assert.equal(targets[1]?.lane?.id, 'pan-lane');
	assert.deepEqual(targets.slice(3, 5).map(({ label, groupLabel, currentValue, lane }) => (
		[label, groupLabel, currentValue, lane?.id ?? null]
	)), [
		['Master assignment', 'Routing', 1, null],
		['Vocal reverb send', 'Routing', 0.25, 'send-lane'],
	]);
	assert.deepEqual(targets.filter(({ effectId }) => effectId === 'filter').map(({ label, currentValue }) => (
		[label, currentValue]
	)), [
		['Frequency', 1_000], ['Q', 2],
	]);
	assert.ok(targets.filter(({ effectId }) => effectId === 'delay').length > 0);
	assert.ok(targets.filter(({ effectId }) => effectId === 'delay').every(({ disabledReason }) => (
		/queue|worklet/iu.test(disabledReason || '')
	)));
});

test('descriptor-aware automation coordinates round-trip and quantize native values', () => {
	const targets = createTrackAutomationTargetInventoryV21({
		sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', gain: 1, pan: 0, mute: false, effects: [], clipIds: [] }],
		automationLanes: [],
	}, 'voice');
	const gain = targets[0]!.descriptor;
	const pan = targets[1]!.descriptor;
	const mute = targets[2]!.descriptor;

	assert.equal(automationValueToNormalizedV21(gain, 0), 0);
	assert.ok(Math.abs(automationValueToNormalizedV21(gain, 1) - 60 / (60 + 20 * Math.log10(4))) < 1e-12);
	assert.ok(Math.abs(automationNormalizedToValueV21(gain, automationValueToNormalizedV21(gain, 2)) - 2) < 1e-12);
	assert.equal(automationValueToNormalizedV21(pan, 0), 0.5);
	assert.equal(automationNormalizedToValueV21(pan, 0.25), -0.5);
	assert.equal(quantizeAutomationValueV21(pan, 0.124), 0.12);
	assert.equal(quantizeAutomationValueV21(mute, 0.51), 1);
	assert.equal(quantizeAutomationValueV21(mute, 0.49), 0);
});

test('graphic EQ element addresses read their matching scalar gain value', () => {
	const gains = Array.from({ length: 31 }, () => 0);
	gains[17] = 6.5;
	const graphic = createEffect('audacity-graphic-eq', {
		id: 'graphic', params: { gains },
	});
	const targets = createTrackAutomationTargetInventoryV21({
		sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', gain: 1, pan: 0, mute: false, effects: [graphic] }],
		automationLanes: [],
	}, 'voice');
	const oneKilohertz = targets.find(({ address }) => (
		address.kind === 'effect' && address.effectId === 'graphic'
		&& address.elementId === 'frequency:1000' && address.parameterId === 'gains'
	));
	assert.equal(oneKilohertz?.currentValue, 6.5);
});

test('compound effect parameters remain visible as disabled targets with their reason', () => {
	const curve = createEffect('audacity-filter-curve-eq', { id: 'curve' });
	const targets = createTrackAutomationTargetInventoryV21({
		sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', effects: [curve], clipIds: [] }],
		automationLanes: [],
	}, 'voice');
	const points = targets.find(({ address }) => address.kind === 'effect'
		&& address.effectId === 'curve' && address.parameterId === 'points');

	assert.ok(points);
	assert.equal(points.label, 'Points');
	assert.equal(points.descriptor.automatable, false);
	assert.match(points.disabledReason || '', /stable element IDs/iu);
});

test('missing tracks have no automation inventory and missing values use descriptor defaults', () => {
	assert.deepEqual(createTrackAutomationTargetInventoryV21({ tracks: [], automationLanes: [] }, 'missing'), []);
	const [gain, pan, mute] = createTrackAutomationTargetInventoryV21({
		sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', effects: [], clipIds: [] }],
		automationLanes: [],
	}, 'voice');
	assert.deepEqual([gain?.currentValue, pan?.currentValue, mute?.currentValue], [1, 0, 0]);
});
