/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioTrackRowNavigation } from '../src/common/editor/ui/timeline/useAudioTrackRowNavigation.js';
import type { FrameCanonicalEdgeTrimRequest } from '../src/common/editor/frame-canonical-edge-trim-domain.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Navigation = ReturnType<typeof useAudioTrackRowNavigation>;
type ClipChanges = Readonly<{ timelineStartFrame?: number; durationFrames: number }>;
interface Options { readonly linked?: boolean; readonly canonical?: boolean; readonly playhead?: number; readonly rejected?: boolean; }
interface Probe {
	readonly dom: ReturnType<typeof installReactTestDom>;
	readonly navigation: Navigation;
	readonly stretches: ClipChanges[];
	readonly trims: ClipChanges[];
	readonly canonicalTrims: FrameCanonicalEdgeTrimRequest[];
	readonly canonicalStretches: FrameCanonicalEdgeTrimRequest[];
}

async function withNavigation(options: Options, check: (probe: Probe) => void) {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const clip = { id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 48_000,
		durationFrames: 96_000, sourceStartFrame: 48_000, sourceDurationFrames: 96_000,
		...(options.linked ? { avLinkId: 'av' } : {}),
	};
	const track = { id: 'track', type: 'audio', clipIds: [clip.id] };
	const project = { sampleRate: 48_000, tracks: [track], selection: { clipIds: [clip.id] } };
	const stretches: ClipChanges[] = [], trims: ClipChanges[] = [];
	const canonicalTrims: FrameCanonicalEdgeTrimRequest[] = [], canonicalStretches: FrameCanonicalEdgeTrimRequest[] = [];
	const admission = (requests: FrameCanonicalEdgeTrimRequest[], request: FrameCanonicalEdgeTrimRequest) => {
		requests.push(request);
		if (options.rejected) throw new RangeError('Native trim refused');
	};
	const controller = { getTelemetrySnapshot: () => ({ positionFrame: options.playhead ?? 120_000 }), actions: {
		clip: { trim: (_id: string, changes: ClipChanges) => trims.push(changes), stretch: (_id: string, changes: ClipChanges) => stretches.push(changes) },
		video: { trim: { commit: (request: FrameCanonicalEdgeTrimRequest) => admission(canonicalTrims, request),
			commitStep: () => { throw new Error('Absolute shortcuts must not become adjacent-frame steps'); },
			rateStretch: { commit: (request: FrameCanonicalEdgeTrimRequest) => admission(canonicalStretches, request),
				commitStep: () => { throw new Error('Absolute shortcuts must not become adjacent-frame steps'); } },
		} }, timeline: { selectClip() {} },
	} };
	const navigation: { current: Navigation | null } = { current: null };
	function Subject() {
		navigation.current = useAudioTrackRowNavigation({ controller, project, track, trackWindowRef: { current: null },
			projectedClips: [], clipLookup: new Map([[clip.id, clip]]), sourceLookup: new Map([['source', { frameCount: 192_000 }]]),
			trackIndex: 0, trackCount: 1, isFlatNavigation: false, trackBaseTabIndex: 0, sampleRate: 48_000,
			blocked: false, canonicalVideoTrim: options.canonical ?? false, run: (operation: () => unknown) => operation(),
			onFocusTimelineRuler: () => false, onFocusTrackContainer: () => false, onFocusTrackPanelControl: () => false,
			onFocusTrackClip: () => false, onFocusTrackRuler: () => false, onFocusSelectionToolbar: () => false,
		});
		return <div data-clip-id="clip" tabIndex={0}>
			<button className="clip-display__handle clip-display__handle--stretch-left" />
			<button className="clip-display__handle clip-display__handle--stretch-right" />
		</div>;
	}
	try {
		await act(async () => root.render(<Subject />));
		assert.ok(navigation.current);
		check({ dom, navigation: navigation.current, stretches, trims, canonicalTrims, canonicalStretches });
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
}

function key(target: EventTarget, value: string, modifiers: { readonly altKey?: boolean; readonly shiftKey?: boolean } = {}) {
	return { target, key: value, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
		preventDefault() {}, stopPropagation() {}, ...modifiers,
	};
}

for (const edge of ['left', 'right'] as const) for (const right of [false, true]) {
	test(`${right ? 'Right' : 'Left'} arrow moves the ${edge} stretch edge in that direction`, async () => {
		await withNavigation({}, ({ dom, navigation, stretches }) => {
			navigation.handleClipKeyDownCapture(key(dom.one(`.clip-display__handle--stretch-${edge}`) as unknown as EventTarget,
				right ? 'ArrowRight' : 'ArrowLeft'));
			const delta = right ? 4_800 : -4_800;
			assert.deepEqual(stretches, [edge === 'right' ? { durationFrames: 96_000 + delta }
				: { timelineStartFrame: 48_000 + delta, durationFrames: 96_000 - delta }]);
		});
	});
}

for (const linked of [false, true]) test(`Alt+S moves the right audio edge to the playhead${linked ? ' with a non-canonical link' : ''}`, async () => {
	await withNavigation({ linked }, ({ dom, navigation, stretches, canonicalStretches }) => {
		navigation.handleClipKeyDownCapture(key(dom.one('[data-clip-id]') as unknown as EventTarget, 's', { altKey: true }));
		assert.deepEqual(stretches, [{ durationFrames: 72_000 }]);
		assert.deepEqual(canonicalStretches, []);
	});
});

for (const shortcut of ['t', 's', '[', ']']) test(`linked Alt+${shortcut} retains the absolute playhead boundary`, async () => {
	await withNavigation({ linked: true, canonical: true }, ({ dom, navigation, canonicalTrims, canonicalStretches, stretches, trims }) => {
		navigation.handleClipKeyDownCapture(key(dom.one('[data-clip-id]') as unknown as EventTarget, shortcut, { altKey: true }));
		const requests = shortcut === 's' ? canonicalStretches : canonicalTrims;
		assert.deepEqual(requests, [{ activeClipId: 'clip', edge: shortcut === '[' ? 'left' : 'right', requestedBoundarySample: 120_000 }]);
		assert.deepEqual(stretches, []); assert.deepEqual(trims, []);
	});
});

for (const shortcut of ['t', 's', '[']) test(`linked Alt+${shortcut} at the clip start is unchanged`, async () => {
	await withNavigation({ linked: true, canonical: true, playhead: 48_000 }, ({ dom, navigation, canonicalTrims, canonicalStretches }) => {
		navigation.handleClipKeyDownCapture(key(dom.one('[data-clip-id]') as unknown as EventTarget, shortcut, { altKey: true }));
		assert.deepEqual(canonicalTrims, []); assert.deepEqual(canonicalStretches, []);
	});
});

test('absolute linked edit refusal does not fall back to legacy audio mutation', async () => {
	await withNavigation({ linked: true, canonical: true, rejected: true }, ({ dom, navigation, stretches, trims }) => {
		assert.throws(() => navigation.handleClipKeyDownCapture(key(dom.one('[data-clip-id]') as unknown as EventTarget, 's', { altKey: true })), /Native trim refused/u);
		assert.deepEqual(stretches, []); assert.deepEqual(trims, []);
	});
});
