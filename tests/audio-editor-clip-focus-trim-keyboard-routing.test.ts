/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FrameCanonicalClipFocusStep } from '../src/common/editor/frame-canonical-clip-focus-step-request.ts';
import {
	routeClipFocusTrimKeyboard,
} from '../src/common/editor/ui/timeline/clip-focus-trim-keyboard-routing.ts';

const KEY_ROWS = [
	{ key: 'Shift+Left', operation: 'trim', edge: 'left', delta: -0.1, direction: 'outward' },
	{ key: 'Shift+Right', operation: 'trim', edge: 'right', delta: -0.1, direction: 'outward' },
	{ key: 'Cmd/Ctrl+Shift+Left', operation: 'trim', edge: 'right', delta: 0.1, direction: 'inward' },
	{ key: 'Cmd/Ctrl+Shift+Right', operation: 'trim', edge: 'left', delta: 0.1, direction: 'inward' },
	{ key: 'Alt+Shift+Left', operation: 'rate-stretch', edge: 'left', delta: -0.1, direction: 'outward' },
	{ key: 'Alt+Shift+Right', operation: 'rate-stretch', edge: 'right', delta: -0.1, direction: 'outward' },
	{ key: 'Cmd/Ctrl+Alt+Shift+Left', operation: 'rate-stretch', edge: 'right', delta: 0.1, direction: 'inward' },
	{ key: 'Cmd/Ctrl+Alt+Shift+Right', operation: 'rate-stretch', edge: 'left', delta: 0.1, direction: 'inward' },
] as const;

test('the eight existing clip-focus key rows route linked audio to exact canonical steps', () => {
	for (const row of KEY_ROWS) {
		const trimSteps: FrameCanonicalClipFocusStep[] = [];
		const rateStretchSteps: FrameCanonicalClipFocusStep[] = [];
		let legacyCalls = 0;
		const result = routeClipFocusTrimKeyboard({
			blocked: false,
			videoCompositing: true,
			clipId: 'linked-audio',
			operation: row.operation,
			edge: row.edge,
			callbackDeltaSeconds: row.delta,
			resolveFocusedClip: () => Object.freeze({
				id: 'linked-audio', kind: 'audio', avLinkId: 'exact-av-link',
			}),
			commitCanonicalTrim: (step) => { trimSteps.push(step); return 'canonical-trim'; },
			commitCanonicalRateStretch: (step) => {
				rateStretchSteps.push(step);
				return 'canonical-rate-stretch';
			},
			commitLegacy: () => { legacyCalls += 1; return 'legacy'; },
		});

		const expected = Object.freeze({
			activeClipId: 'linked-audio', edge: row.edge, direction: row.direction,
		});
		assert.deepEqual(trimSteps, row.operation === 'trim' ? [expected] : [], row.key);
		assert.deepEqual(rateStretchSteps, row.operation === 'rate-stretch' ? [expected] : [], row.key);
		assert.equal(result, row.operation === 'trim' ? 'canonical-trim' : 'canonical-rate-stretch', row.key);
		assert.equal(legacyCalls, 0, row.key);
		assert.ok(Object.isFrozen((trimSteps[0] ?? rateStretchSteps[0])!), row.key);
	}
});

test('canonical intent uses callback sign while discarding its finite non-zero magnitude', () => {
	for (const row of [
		{ delta: -Number.MIN_VALUE, direction: 'outward' },
		{ delta: -83.75, direction: 'outward' },
		{ delta: Number.MIN_VALUE, direction: 'inward' },
		{ delta: 9_999, direction: 'inward' },
	] as const) {
		const steps: FrameCanonicalClipFocusStep[] = [];
		routeLinked({
			callbackDeltaSeconds: row.delta,
			commitCanonicalTrim: (step) => { steps.push(step); },
		});
		assert.deepEqual(steps, [{
			activeClipId: 'linked-audio', edge: 'left', direction: row.direction,
		}]);
	}

	for (const delta of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		let canonicalCalls = 0;
		let legacyCalls = 0;
		assert.throws(() => routeLinked({
			callbackDeltaSeconds: delta,
			commitCanonicalTrim: () => { canonicalCalls += 1; },
			commitLegacy: () => { legacyCalls += 1; },
		}), (error: unknown) => error instanceof RangeError || error instanceof TypeError);
		assert.equal(canonicalCalls, 0);
		assert.equal(legacyCalls, 0);
	}
});

test('blocking and capability precede relation inspection, while ordinary audio keeps legacy identity', () => {
	let relationReads = 0;
	let canonicalCalls = 0;
	let legacyCalls = 0;
	const blocked = routeLinked({
		blocked: true,
		resolveFocusedClip: () => { relationReads += 1; return linkedAudio(); },
		commitCanonicalTrim: () => { canonicalCalls += 1; },
		commitLegacy: () => { legacyCalls += 1; },
	});
	assert.equal(blocked, undefined);
	assert.equal(relationReads, 0);
	assert.equal(canonicalCalls, 0);
	assert.equal(legacyCalls, 0);

	const soundscaperResult = routeLinked({
		videoCompositing: false,
		callbackDeltaSeconds: Number.NaN,
		resolveFocusedClip: () => { relationReads += 1; return linkedAudio(); },
		commitCanonicalTrim: () => { canonicalCalls += 1; },
		commitLegacy: () => { legacyCalls += 1; return 'same-legacy-result'; },
	});
	assert.equal(soundscaperResult, 'same-legacy-result');
	assert.equal(relationReads, 0);
	assert.equal(canonicalCalls, 0);
	assert.equal(legacyCalls, 1);

	for (const clip of [
		Object.freeze({ id: 'audio-only', kind: 'audio' }),
		Object.freeze({ id: 'unlinked', kind: 'audio', avLinkId: null }),
		Object.freeze({ id: 'empty-link', kind: 'audio', avLinkId: '' }),
		Object.freeze({ id: 'malformed-link', kind: 'audio', avLinkId: 42 }),
		Object.freeze({ id: 'unexpected-video', kind: 'video', avLinkId: 'link' }),
	] as const) {
		const legacyToken = Object.freeze({ clip: clip.id });
		const result = routeLinked({
			clipId: clip.id,
			callbackDeltaSeconds: -0.375,
			resolveFocusedClip: () => { relationReads += 1; return clip; },
			commitCanonicalTrim: () => { canonicalCalls += 1; },
			commitLegacy: () => { legacyCalls += 1; return legacyToken; },
		});
		assert.equal(result, legacyToken, clip.id);
	}
	assert.equal(relationReads, 5);
	assert.equal(canonicalCalls, 0);
	assert.equal(legacyCalls, 6);
});

test('a canonical refusal propagates and never falls through to legacy mutation', () => {
	const refusal = new RangeError('ambiguous linked video companion');
	let canonicalCalls = 0;
	let legacyCalls = 0;
	assert.throws(() => routeLinked({
		commitCanonicalTrim: () => { canonicalCalls += 1; throw refusal; },
		commitLegacy: () => { legacyCalls += 1; },
	}), (error: unknown) => error === refusal);
	assert.equal(canonicalCalls, 1);
	assert.equal(legacyCalls, 0);
});

function routeLinked(overrides: Partial<Parameters<typeof routeClipFocusTrimKeyboard>[0]> = {}) {
	return routeClipFocusTrimKeyboard({
		blocked: false,
		videoCompositing: true,
		clipId: 'linked-audio',
		operation: 'trim',
		edge: 'left',
		callbackDeltaSeconds: -0.1,
		resolveFocusedClip: linkedAudio,
		commitCanonicalTrim: () => undefined,
		commitCanonicalRateStretch: () => undefined,
		commitLegacy: () => undefined,
		...overrides,
	});
}

function linkedAudio() {
	return Object.freeze({ id: 'linked-audio', kind: 'audio', avLinkId: 'exact-av-link' });
}
