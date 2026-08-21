/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperWebVcrRecordingToken,
	evaluateFramescaperWebVcrTakeObservation,
	type FramescaperWebVcrFrozenTake,
} from '../src/common/editor/controller/framescaper-web-vcr-take-authority.ts';
import type { WebVcrSnapshot } from '../src/common/editor/web-vcr-domain.ts';

const TOKEN = 'b'.repeat(32);
const frozen: Readonly<FramescaperWebVcrFrozenTake> = Object.freeze({
	sessionId: 'a'.repeat(32), generation: 1, navigationGeneration: 2,
	targetId: 'd'.repeat(32), targetGeneration: 3, recordingToken: TOKEN,
	pixelCrop: { x: 192, y: 216, width: 1_152, height: 540 },
	surface: { width: 1_920, height: 1_080 }, output: { width: 1_152, height: 540 },
});

test('recording tokens are exact bounded 128-bit lowercase values', () => {
	assert.equal(createFramescaperWebVcrRecordingToken((bytes) => { bytes.fill(0xab); }), 'ab'.repeat(16));
});

test('only exact ended from the frozen take token admits automatic stop', () => {
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		phase: 'recording', targetEndedRecordingToken: 'c'.repeat(32),
	}), 'recording'), 'unchanged');
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		phase: 'recording', targetEndedRecordingToken: null,
	}), 'recording'), 'unchanged');
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		phase: 'recording', targetEndedRecordingToken: TOKEN,
	}), 'countdown'), 'unchanged');
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		phase: 'recording', targetEndedRecordingToken: TOKEN,
	}), 'recording'), 'exact-ended');
});

test('session, navigation, or target replacement seals the frozen take', () => {
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		navigation: { generation: 4 },
	}), 'recording'), 'authority-changed');
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		target: { targetId: 'e'.repeat(32) },
	}), 'recording'), 'authority-changed');
	assert.equal(evaluateFramescaperWebVcrTakeObservation(frozen, snapshot({
		crop: { x: 0.2, y: 0.2, width: 0.6, height: 0.5 },
		target: { aperture: { x: 0.2, y: 0.2, width: 0.6, height: 0.5 } },
	}), 'previewing'), 'authority-changed');
});

function snapshot(overrides: Readonly<Record<string, unknown>> = {}): Readonly<WebVcrSnapshot> {
	const navigation = overrides.navigation as Readonly<Record<string, unknown>> | undefined;
	const target = overrides.target as Readonly<Record<string, unknown>> | null | undefined;
	const base = {
		version: 1, sessionId: 'a'.repeat(32), generation: 1, phase: 'ready',
		capability: { status: 'available', resolutions: ['720p', '1080p'] },
		resolution: '1080p', aspect: 'free', crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
		autoCrop: true, monitorMuted: false, autoStop: true, visible: true,
		navigation: { generation: 2, url: 'https://example.test/', canGoBack: false,
			canGoForward: false, isLoading: false },
		target: { targetId: 'd'.repeat(32), generation: 3, mediaState: 'ended',
			aperture: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
			intrinsicSize: { width: 1_920, height: 1_080 } },
		targetEndedRecordingToken: null,
		captureSurface: { width: 1_920, height: 1_080 }, outputSize: null, metrics: null, failure: null,
	};
	return {
		...base, ...overrides,
		navigation: { ...base.navigation, ...navigation },
		target: target === null ? null : { ...base.target, ...target },
	} as Readonly<WebVcrSnapshot>;
}
