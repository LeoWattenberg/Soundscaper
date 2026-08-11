/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { flattenAudioEditorSearchMenus } from '../src/common/editor/search.js';
import { SEQUENCE_TIMING_COPY_BY_LOCALE } from '../src/common/i18n/sequence-timing-copy.js';
import type { FrameCanonicalRateStretchRequest } from '../src/common/editor/frame-canonical-rate-stretch-domain.ts';
import {
	createFramescaperRateStretchMenuItems,
	createFramescaperRateStretchMenuModel,
} from '../src/common/editor/ui/framescaper-rate-stretch-menu-model.ts';
import { findShortcutMenuHandler } from '../src/common/editor/ui/workspace-shortcuts.ts';

const COPY = Object.freeze({
	rateStretchLeftToPlayhead: 'Rate stretch left edge to playhead',
	rateStretchRightToPlayhead: 'Rate stretch right edge to playhead',
});

const IDS = Object.freeze([
	'rate-stretch-left-edge-to-playhead',
	'rate-stretch-right-edge-to-playhead',
]);

test('rate-stretch menu and feedback copy is localized in both sequence catalogs', () => {
	assert.deepEqual({
		left: SEQUENCE_TIMING_COPY_BY_LOCALE.en.rateStretchLeftToPlayhead,
		right: SEQUENCE_TIMING_COPY_BY_LOCALE.en.rateStretchRightToPlayhead,
		appliedLeft: SEQUENCE_TIMING_COPY_BY_LOCALE.en.rateStretchLeftEdgeApplied,
		appliedRight: SEQUENCE_TIMING_COPY_BY_LOCALE.en.rateStretchRightEdgeApplied,
		clamped: SEQUENCE_TIMING_COPY_BY_LOCALE.en.rateStretchBoundaryClamped,
		unavailable: SEQUENCE_TIMING_COPY_BY_LOCALE.en.noRateStretchAvailable,
	}, {
		left: 'Rate stretch left edge to playhead',
		right: 'Rate stretch right edge to playhead',
		appliedLeft: 'Rate-stretched left edge at {rate}× to {timecode}.',
		appliedRight: 'Rate-stretched right edge at {rate}× to {timecode}.',
		clamped: 'Limited to the supported rate and available range.',
		unavailable: 'No rate stretch is available at this position.',
	});
	for (const key of [
		'rateStretchLeftToPlayhead', 'rateStretchRightToPlayhead',
		'rateStretchLeftEdgeApplied', 'rateStretchRightEdgeApplied',
		'rateStretchBoundaryClamped', 'noRateStretchAvailable',
	] as const) {
		assert.equal(typeof SEQUENCE_TIMING_COPY_BY_LOCALE.de[key], 'string');
		assert.notEqual(SEQUENCE_TIMING_COPY_BY_LOCALE.de[key].length, 0);
	}
});

test('Framescaper rate-stretch leaves defer live playhead reads and planning until resolution', () => {
	let playhead = 24_000;
	let playheadReads = 0;
	const planned: FrameCanonicalRateStretchRequest[] = [];
	const model = createFramescaperRateStretchMenuModel(input({
		currentPlayheadSample: () => {
			playheadReads += 1;
			return playhead;
		},
	}), {
		planRateStretch: (request) => {
			planned.push(request);
			if (request.edge === 'left') throw new RangeError('left edge refused');
			return Object.freeze({ kind: 'transform' as const });
		},
	});
	const committed: FrameCanonicalRateStretchRequest[] = [];
	const items = createFramescaperRateStretchMenuItems(model, {
		commitRateStretch: (request) => committed.push(request),
	});

	assert.equal(playheadReads, 0);
	assert.deepEqual(planned, []);
	assert.deepEqual(items.map(({ id, label, disabled, resolve }) => ({
		id, label, disabled, lazy: typeof resolve === 'function',
	})), [
		{ id: IDS[0], label: COPY.rateStretchLeftToPlayhead, disabled: false, lazy: true },
		{ id: IDS[1], label: COPY.rateStretchRightToPlayhead, disabled: false, lazy: true },
	]);
	assert.equal(Object.isFrozen(model), true);
	assert.equal(Object.isFrozen(items), true);
	assert.ok(items.every((item) => Object.isFrozen(item)));

	assert.deepEqual(items[0]?.resolve(), { disabled: true });
	assert.deepEqual(items[1]?.resolve(), { disabled: false });
	assert.equal(playheadReads, 2);
	assert.deepEqual(planned, [{
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: 24_000,
	}, {
		activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: 24_000,
	}]);

	playhead = 25_600;
	items[1]?.onClick();
	assert.deepEqual(committed, [{
		activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: 25_600,
	}]);
	assert.equal(playheadReads, 3, 'activation rebuilds from the live playhead');
});

test('closed-menu direct, shortcut, and Search activation build fresh absolute requests', () => {
	let playhead = 10;
	let plans = 0;
	const committed: FrameCanonicalRateStretchRequest[] = [];
	const items = createFramescaperRateStretchMenuItems(createFramescaperRateStretchMenuModel(input({
		currentPlayheadSample: () => playhead++,
	}), {
		planRateStretch: () => {
			plans += 1;
			return Object.freeze({ kind: 'transform' as const });
		},
	}), {
		commitRateStretch: (request) => committed.push(request),
	});
	const left = items[0];
	assert.ok(left);
	left.onClick();
	findShortcutMenuHandler(items, IDS[0]!).handler?.();
	const searchEntry = flattenAudioEditorSearchMenus([{
		id: 'edit', label: 'Edit', items,
	}]).find(({ commandId }) => commandId === IDS[0]);
	searchEntry?.handler?.();

	assert.equal(plans, 0, 'closed-menu activation delegates replanning to service commit');
	assert.deepEqual(committed, [10, 11, 12].map((requestedBoundarySample) => ({
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample,
	})));
});

test('invalid authority is inert and Soundscaper omits both rate-stretch leaves', () => {
	let calls = 0;
	const dependencies = {
		planRateStretch: () => {
			calls += 1;
			return Object.freeze({ kind: 'transform' as const });
		},
	};
	const inert = createFramescaperRateStretchMenuItems(createFramescaperRateStretchMenuModel(input({
		selectedClipId: null,
		currentPlayheadSample: () => { calls += 1; return 10; },
	}), dependencies), {
		commitRateStretch: () => { calls += 1; },
	});
	assert.deepEqual(inert.map(({ disabled }) => disabled), [true, true]);
	assert.deepEqual(inert.map(({ resolve }) => resolve()), [
		{ disabled: true }, { disabled: true },
	]);
	for (const item of inert) item.onClick();
	assert.equal(calls, 0);

	const soundscaper = createFramescaperRateStretchMenuItems(createFramescaperRateStretchMenuModel(input({
		productId: 'soundscaper',
		currentPlayheadSample: () => { calls += 1; return 10; },
	}), dependencies), {
		commitRateStretch: () => { calls += 1; },
	});
	assert.deepEqual(soundscaper, []);
	assert.equal(calls, 0);
});

function input(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		productId: 'framescaper',
		selectedClipId: 'video-clip',
		editingBlocked: false,
		copy: COPY,
		currentPlayheadSample: () => 24_000,
		...overrides,
	};
}
