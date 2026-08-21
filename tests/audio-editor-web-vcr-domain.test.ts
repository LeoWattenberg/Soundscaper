/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeWebVcrAspect,
	normalizeWebVcrCapability,
	normalizeWebVcrCommandV1,
	normalizeWebVcrLifecyclePhase,
	normalizeWebVcrNavigationState,
	normalizeWebVcrNormalizedCrop,
	normalizeWebVcrRecordingMetrics,
	normalizeWebVcrResolution,
	normalizeWebVcrSnapshot,
	normalizeWebVcrTargetSummary,
} from '../src/common/editor/web-vcr-domain.ts';

const CAPABILITY = {
	status: 'available',
	resolutions: ['720p', '1080p'],
} as const;

const NAVIGATION = {
	generation: 3,
	url: 'https://media.example.test/watch?id=1',
	canGoBack: true,
	canGoForward: false,
	isLoading: false,
} as const;

const TARGET = {
	targetId: 'video-1',
	generation: 7,
	mediaState: 'playing',
	aperture: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
	intrinsicSize: { width: 1_920, height: 1_080 },
} as const;

const METRICS = {
	elapsedMs: 2_500,
	capturedFrames: 150,
	droppedFrames: 1,
	audioDropoutFrames: 0,
	currentAvDriftMs: -3.25,
	maximumAbsoluteAvDriftMs: 8.5,
} as const;

test('Web VCR enums and capability DTOs normalize to frozen closed values', () => {
	assert.equal(normalizeWebVcrResolution('1080p'), '1080p');
	assert.equal(normalizeWebVcrAspect('9:16'), '9:16');
	assert.equal(normalizeWebVcrLifecyclePhase('preparing'), 'preparing');
	assert.throws(() => normalizeWebVcrResolution('2160p'), /resolution is invalid/iu);
	assert.throws(() => normalizeWebVcrAspect('4:3'), /aspect is invalid/iu);

	const checking = normalizeWebVcrCapability({ status: 'checking' });
	const available = normalizeWebVcrCapability(CAPABILITY);
	const unavailable = normalizeWebVcrCapability({
		status: 'unavailable', reason: 'roadmap-gate', detail: null,
	});
	assert.deepEqual(checking, { status: 'checking' });
	assert.deepEqual(available, CAPABILITY);
	assert.deepEqual(unavailable, {
		status: 'unavailable', reason: 'roadmap-gate', detail: null,
	});
	assert.equal(Object.isFrozen(available), true);
	assert.equal(Object.isFrozen(available.resolutions), true);
	assert.throws(
		() => normalizeWebVcrCapability({ ...CAPABILITY, resolutions: ['1080p', '1080p'] }),
		/Duplicate Web VCR resolution/iu,
	);
	assert.throws(
		() => normalizeWebVcrCapability({ status: 'checking', extra: true }),
		/invalid closed shape/iu,
	);
});

test('Web VCR snapshot members are deeply frozen and exclude browser title or project data', () => {
	const crop = normalizeWebVcrNormalizedCrop(TARGET.aperture);
	const navigation = normalizeWebVcrNavigationState(NAVIGATION);
	const target = normalizeWebVcrTargetSummary(TARGET);
	const metrics = normalizeWebVcrRecordingMetrics(METRICS);
	assert.equal(Object.isFrozen(crop), true);
	assert.equal(Object.isFrozen(navigation), true);
	assert.equal(Object.isFrozen(target), true);
	assert.equal(Object.isFrozen(target.aperture), true);
	assert.equal(Object.isFrozen(target.intrinsicSize), true);
	assert.equal(Object.isFrozen(metrics), true);

	const snapshot = normalizeWebVcrSnapshot({
		version: 1,
		sessionId: 'web-vcr-session-1',
		generation: 9,
		phase: 'ready',
		capability: CAPABILITY,
		resolution: '1080p',
		aspect: 'free',
		crop: { x: 0, y: 0, width: 1, height: 1 },
		autoCrop: true,
		monitorMuted: false,
		autoStop: false,
		visible: true,
		navigation: NAVIGATION,
		target: TARGET,
		targetEndedRecordingToken: null,
		captureSurface: { width: 1_920, height: 1_080 },
		outputSize: null,
		metrics: METRICS,
		failure: null,
	});
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.capability), true);
	assert.equal(Object.isFrozen(snapshot.navigation), true);
	assert.equal(Object.isFrozen(snapshot.target), true);
	assert.deepEqual(snapshot.captureSurface, { width: 1_920, height: 1_080 });
	assert.equal('title' in snapshot, false);
	assert.throws(
		() => normalizeWebVcrSnapshot({ ...snapshot, title: 'remote title' }),
		/invalid closed shape/iu,
	);
});

test('Web VCR DTO validation rejects malformed URLs, crops, metrics, and exotic records', () => {
	assert.throws(
		() => normalizeWebVcrNavigationState({ ...NAVIGATION, url: 'http://media.example.test/' }),
		/HTTPS URL or about:blank/iu,
	);
	assert.throws(
		() => normalizeWebVcrNavigationState({ ...NAVIGATION, url: 'https://user:pass@example.test/' }),
		/must not contain credentials/iu,
	);
	assert.throws(
		() => normalizeWebVcrNormalizedCrop({ x: 0.8, y: 0, width: 0.3, height: 1 }),
		/must remain inside/iu,
	);
	assert.throws(
		() => normalizeWebVcrRecordingMetrics({ ...METRICS, maximumAbsoluteAvDriftMs: -1 }),
		/maximum.*non-negative/iu,
	);
	assert.throws(
		() => normalizeWebVcrTargetSummary({ ...TARGET, intrinsicSize: { width: 0, height: 1_080 } }),
		/positive safe integer/iu,
	);

	const inherited = Object.create({ status: 'checking' }) as Record<string, unknown>;
	assert.throws(() => normalizeWebVcrCapability(inherited), /closed data record/iu);
	const accessor = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(accessor, 'status', { enumerable: true, get: () => 'checking' });
	assert.throws(() => normalizeWebVcrCapability(accessor), /enumerable data property/iu);
});

test('Web VCR commands form a closed owner-bound and generation-bound union', () => {
	const base = { version: 1, sessionId: 'session-1', generation: 4 } as const;
	const commands = [
		{ ...base, kind: 'navigate', url: 'https://media.example.test/' },
		{ ...base, kind: 'go-back' },
		{ ...base, kind: 'go-forward' },
		{ ...base, kind: 'reload' },
		{ ...base, kind: 'set-visibility', visible: true },
		{
			...base, kind: 'pointer-input', action: 'down', x: 0.5, y: 0.25,
			button: 'left', deltaX: 0, deltaY: 0, modifiers: ['shift'],
		},
		{
			...base, kind: 'key-input', action: 'down', key: 'a', code: 'KeyA',
			repeat: false, modifiers: ['control'],
		},
		{ ...base, kind: 'set-resolution', resolution: '720p' },
		{ ...base, kind: 'set-auto-crop', enabled: false },
		{
			...base, kind: 'set-crop',
			crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, aspect: '1:1',
		},
		{ ...base, kind: 'set-monitor-muted', muted: true },
		{ ...base, kind: 'set-auto-stop', enabled: true },
		{ ...base, kind: 'request-data-clear' },
		{ ...base, kind: 'clear-browser-data', confirmationNonce: 'confirm-1' },
		{ ...base, kind: 'close-session' },
	] as const;

	for (const input of commands) {
		const command = normalizeWebVcrCommandV1(input);
		assert.equal(command.kind, input.kind);
		assert.equal(Object.isFrozen(command), true);
	}
	const cropCommand = normalizeWebVcrCommandV1(commands[9]);
	assert.equal(cropCommand.kind, 'set-crop');
	if (cropCommand.kind === 'set-crop') assert.equal(Object.isFrozen(cropCommand.crop), true);
	const pointerCommand = normalizeWebVcrCommandV1(commands[5]);
	assert.equal(pointerCommand.kind, 'pointer-input');
	if (pointerCommand.kind === 'pointer-input') assert.equal(Object.isFrozen(pointerCommand.modifiers), true);

	assert.throws(
		() => normalizeWebVcrCommandV1({ ...commands[0], extra: true }),
		/invalid closed shape/iu,
	);
	assert.throws(
		() => normalizeWebVcrCommandV1({ ...commands[0], url: 'file:///tmp/secret' }),
		/HTTPS URL or about:blank/iu,
	);
	assert.throws(
		() => normalizeWebVcrCommandV1({ ...commands[5], x: 1.1 }),
		/from 0 through 1/iu,
	);
	assert.throws(
		() => normalizeWebVcrCommandV1({ ...commands[5], modifiers: ['shift', 'shift'] }),
		/Duplicate Web VCR input modifier/iu,
	);
	assert.throws(
		() => normalizeWebVcrCommandV1({ ...commands[5], action: 'wheel', button: 'left' }),
		/Wheel input must not carry a pointer button/iu,
	);
});
