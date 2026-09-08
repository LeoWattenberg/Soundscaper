/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDefaultFramescaperAudioFinishingFinishing,
	normalizeFramescaperAudioFinishingFinishing,
} from '../src/framescaper/editor-audio-finishing-finishing.ts';
import { reconcileFramescaperAudioFinishingFinishing } from '../src/framescaper/editor-audio-finishing-reconciliation-finishing.ts';

const project = {
	sampleRate: 48_000,
	masterChannels: 2,
	master: { effects: [] },
	tracks: [
		{ id: 'audio-track', type: 'audio', effects: [] },
		{ id: 'video-track', type: 'video', effects: [] },
	],
};

const videoLane = {
	id: 'video-volume',
	address: { kind: 'strip', strip: { kind: 'track', id: 'video-track' }, parameterId: 'gain' },
	timebase: 'absolute-samples',
	points: [{ id: 'video-volume-origin', position: 0, value: 1 }],
	segments: [],
};

test('Framescaper automation validation refuses strips for non-audio tracks', () => {
	const defaults = createDefaultFramescaperAudioFinishingFinishing(project);
	assert.throws(
		() => normalizeFramescaperAudioFinishingFinishing(project, {
			automationLanes: [videoLane], mixer: defaults.mixer,
		}),
		{ name: 'ReferenceError', message: /video-volume references a missing track/u },
	);
});

test('Framescaper automation reconciliation drops strips for non-audio tracks', () => {
	const defaults = createDefaultFramescaperAudioFinishingFinishing(project);
	const reconciled = reconcileFramescaperAudioFinishingFinishing(project, {
		automationLanes: [videoLane], mixer: defaults.mixer,
	});
	assert.deepEqual(reconciled.automationLanes, []);
});
