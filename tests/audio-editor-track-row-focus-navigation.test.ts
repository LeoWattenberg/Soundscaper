/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createTrackRowFocusRouter,
	routeTrackRowClipKeyDown,
} from '../src/common/editor/ui/timeline/useTrackRowFocusNavigation.js';

test('audio and video rows share routing while retaining their ruler difference', () => {
	const audio = fixture({ trackIndex: 1, trackCount: 3, hasTrackRuler: true });
	audio.router.focusBeforeTrack();
	assert.deepEqual(audio.calls, ['ruler:0:first', 'clip:0:last', 'panel:0:last', 'track:0']);

	const video = fixture({ trackIndex: 1, trackCount: 3, hasTrackRuler: false });
	video.router.focusBeforeTrack();
	assert.deepEqual(video.calls, ['clip:0:last', 'panel:0:last', 'track:0']);

	const audioAfterPanel = fixture({ trackIndex: 1, trackCount: 3, hasTrackRuler: true });
	audioAfterPanel.router.focusAfterPanel();
	assert.deepEqual(audioAfterPanel.calls, ['clip:1:first', 'ruler:1:first']);

	const videoAfterPanel = fixture({ trackIndex: 1, trackCount: 3, hasTrackRuler: false });
	videoAfterPanel.router.focusAfterPanel();
	assert.deepEqual(videoAfterPanel.calls, ['clip:1:first', 'track:2']);
});

test('shared row routing preserves boundaries, successful short-circuiting and vertical focus', () => {
	const first = fixture({ trackIndex: 0, trackCount: 2, hasTrackRuler: true });
	first.router.focusBeforeTrack();
	first.router.focusPanelVertical('up');
	first.router.focusTrackVertical(-1);
	assert.deepEqual(first.calls, ['timeline']);

	const last = fixture({ trackIndex: 1, trackCount: 2, hasTrackRuler: false });
	last.router.focusAfterTrack();
	last.router.focusPanelVertical('up');
	last.router.focusTrackVertical(-1);
	assert.deepEqual(last.calls, ['toolbar', 'panel:0:first', 'track:0']);

	const shortCircuit = fixture({
		trackIndex: 2,
		trackCount: 3,
		hasTrackRuler: true,
		succeeds: new Set(['ruler:1:first']),
	});
	assert.equal(shortCircuit.router.focusBeforeTrack(), true);
	assert.deepEqual(shortCircuit.calls, ['ruler:1:first']);
});

test('shared clip routing owns selection and horizontal roving focus', () => {
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const document = { activeElement: null as ClipElement | null };
	Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
	const first = clip('first', document);
	const second = clip('second', document);
	const root = { querySelectorAll: () => [first, second] };
	const selections: unknown[] = [];
	try {
		const enter = keyboardEvent('Enter', first, { shiftKey: true });
		routeTrackRowClipKeyDown(enter, {
			root,
			isFlatNavigation: false,
			tabIndex: 14,
			onSelectClip: (...values: unknown[]) => selections.push(values),
		});
		assert.deepEqual(selections, [['first', { additive: true, toggle: false }]]);
		assert.equal(enter.prevented, true);
		assert.equal(enter.stopped, true);

		const right = keyboardEvent('ArrowRight', first);
		routeTrackRowClipKeyDown(right, {
			root,
			isFlatNavigation: false,
			tabIndex: 14,
			onSelectClip: () => undefined,
		});
		assert.equal(first.tabIndex, -1);
		assert.equal(second.tabIndex, 14);
		assert.equal(document.activeElement, second);
		assert.equal(second.revealed, true);
	} finally {
		if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
		else Reflect.deleteProperty(globalThis, 'document');
	}
});

test('audio and video consumers use the shared focus-navigation hook', () => {
	const directory = new URL('../src/common/editor/ui/timeline/', import.meta.url);
	const audio = readFileSync(new URL('useAudioTrackRowNavigation.js', directory), 'utf8');
	const video = readFileSync(new URL('VideoTrackRow.jsx', directory), 'utf8');
	for (const source of [audio, video]) {
		assert.match(source, /useTrackRowFocusNavigation\(/u);
		assert.doesNotMatch(source, /normalizeClipSemantics/u);
	}
});

function fixture({
	trackIndex,
	trackCount,
	hasTrackRuler,
	succeeds = new Set<string>(),
}: {
	readonly trackIndex: number;
	readonly trackCount: number;
	readonly hasTrackRuler: boolean;
	readonly succeeds?: ReadonlySet<string>;
}) {
	const calls: string[] = [];
	const attempt = (value: string) => {
		calls.push(value);
		return succeeds.has(value);
	};
	const router = createTrackRowFocusRouter({
		trackIndex,
		trackCount,
		hasTrackRuler,
		onFocusTimelineRuler: () => attempt('timeline'),
		onFocusTrackContainer: (index: number) => attempt(`track:${index}`),
		onFocusTrackPanelControl: (index: number, last = false) => attempt(`panel:${index}:${last ? 'last' : 'first'}`),
		onFocusTrackClip: (index: number, last = false) => attempt(`clip:${index}:${last ? 'last' : 'first'}`),
		onFocusTrackRuler: (index: number, last = false) => attempt(`ruler:${index}:${last ? 'last' : 'first'}`),
		onFocusSelectionToolbar: () => attempt('toolbar'),
	});
	return { calls, router };
}

interface ClipElement {
	readonly dataset: { readonly clipId: string };
	tabIndex: number;
	revealed: boolean;
	matches(selector: string): boolean;
	focus(): void;
	scrollIntoView(): void;
}

function clip(id: string, document: { activeElement: ClipElement | null }): ClipElement {
	return {
		dataset: { clipId: id },
		tabIndex: -1,
		revealed: false,
		matches: (selector) => selector === '[data-clip-id][role="group"]',
		focus() { document.activeElement = this; },
		scrollIntoView() { this.revealed = true; },
	};
}

function keyboardEvent(key: string, target: ClipElement, overrides: Readonly<Record<string, boolean>> = {}) {
	return {
		key,
		target,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		prevented: false,
		stopped: false,
		preventDefault() { this.prevented = true; },
		stopPropagation() { this.stopped = true; },
		...overrides,
	};
}
