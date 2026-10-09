/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveTimelineSelectionPointerTarget,
	setTimelineSelectionPointerCursor,
	type SelectionPointerEvent,
	type SelectionPointerTargetOptions,
} from '../src/common/editor/ui/timeline/selection-pointer-target.ts';

function pointerTarget({
	trackId = 'track-a', selector = '', ruler = false, clip = false,
} = {}) {
	const lane = { dataset: { trackId, ...(ruler ? { rulerInteraction: '' } : {}) } } as unknown as HTMLElement;
	const clipDisplay = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, height: 90 }) };
	const target = {
		closest: (query: string) => {
			if (query === '[data-track-lane]') return lane;
			if (query === '.clip-display') return clip ? clipDisplay : null;
			return selector && query.split(',').map((part) => part.trim()).includes(selector) ? {} : null;
		},
	} as unknown as EventTarget;
	return { target, lane };
}

const options: SelectionPointerTargetOptions = {
	selection: { startFrame: 100, endFrame: 200, trackIds: ['track-a'] },
	tracks: [{ id: 'track-a', type: 'audio' }, { id: 'track-b', type: 'audio' }],
	selectedTrackId: 'track-a',
	frameAtClientX: (clientX) => clientX,
	pixelsPerSecond: 1_000, sampleRate: 1_000,
	splitToolActive: false, automationToolEnabled: false, samplePencilActive: false,
};

function event(target: EventTarget, overrides: Partial<SelectionPointerEvent> = {}): SelectionPointerEvent {
	return { target, clientX: 100, clientY: 60, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...overrides };
}

test('selected waveform bodies expose directional edge handles while ruler and other lanes retain their actions', () => {
	const { target, lane } = pointerTarget({ clip: true });
	assert.deepEqual(resolveTimelineSelectionPointerTarget(event(target), options), { lane, edge: 'start' });
	assert.equal(resolveTimelineSelectionPointerTarget(event(pointerTarget({ ruler: true }).target), options), null);
	assert.equal(resolveTimelineSelectionPointerTarget(event(pointerTarget({ trackId: 'track-b' }).target), options), null);
	assert.equal(resolveTimelineSelectionPointerTarget(event(pointerTarget({ trackId: 'track-b' }).target, { shiftKey: true }), options)?.edge, 'start');
});

test('selection handles yield to clip headers, handles, labels, fades, spectral tools and interactive controls', () => {
	for (const selector of [
		'button', 'input', 'textarea', 'select', '[role="menuitem"]', '[data-track-header]',
		'.clip-header', '.clip-display__handle', '.audio-editor-vertical-ruler', '[data-label-id]',
		'[data-timeline-annotation-interactive]', '[data-track-automation-interactive]', '[data-spectral-brush]',
		'[data-spectral-selection]', '[data-stereo-channel-divider]', '[data-crossfade-handle]',
		'[data-clip-fade-shape-handle]', '[data-clip-fade-handle]',
	]) {
		assert.equal(resolveTimelineSelectionPointerTarget(event(pointerTarget({ selector }).target), options), null, selector);
	}
});

test('selection boundary hits preserve trim-band and modifier tool precedence', () => {
	const { target } = pointerTarget({ clip: true });
	const nearClipEdge = { ...options, selection: { startFrame: 0, endFrame: 200, trackIds: ['track-a'] } };
	assert.equal(resolveTimelineSelectionPointerTarget(event(target, { clientX: 0, clientY: 10 }), nearClipEdge), null);
	assert.equal(resolveTimelineSelectionPointerTarget(event(target, { clientX: 0, clientY: 60 }), nearClipEdge)?.edge, 'start');
	for (const modifier of ['altKey', 'ctrlKey', 'metaKey'] as const) {
		assert.equal(resolveTimelineSelectionPointerTarget(event(target, { [modifier]: true }), options), null, modifier);
	}
	for (const tool of ['splitToolActive', 'automationToolEnabled', 'samplePencilActive'] as const) {
		assert.equal(resolveTimelineSelectionPointerTarget(event(target), { ...options, [tool]: true }), null, tool);
	}
});

test('Shift cursor uses live playhead direction when no range exists', () => {
	const { target } = pointerTarget();
	let readCount = 0;
	const collapsed = { ...options, selection: { startFrame: 0, endFrame: 0 }, playheadFrame: () => { readCount++; return 150; } };
	assert.equal(resolveTimelineSelectionPointerTarget(event(target, { shiftKey: true, clientX: 100 }), collapsed)?.edge, 'start');
	assert.equal(readCount, 1, 'read the playing position once per pointer event');
	assert.equal(resolveTimelineSelectionPointerTarget(event(target, { shiftKey: true, clientX: 200 }), collapsed)?.edge, 'end');
});

test('selection pointer cursor is reversible and only changes its own data attribute', () => {
	const root = { dataset: { other: 'keep' } } as unknown as HTMLElement;
	setTimelineSelectionPointerCursor(root, 'start');
	assert.equal(root.dataset.selectionPointerEdge, 'start');
	setTimelineSelectionPointerCursor(root, 'end');
	assert.equal(root.dataset.selectionPointerEdge, 'end');
	setTimelineSelectionPointerCursor(root, null);
	assert.equal(root.dataset.selectionPointerEdge, undefined);
	assert.equal(root.dataset.other, 'keep');
	setTimelineSelectionPointerCursor(null, null);
});
