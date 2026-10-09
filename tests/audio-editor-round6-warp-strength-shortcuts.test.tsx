/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudioWarpDialog from '../src/common/editor/ui/dialogs/AudioWarpDialog.tsx';
import { guardModalNativeRangeKey } from '../src/common/editor/ui/modal-native-range-keys.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

interface RangeKey {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	target?: ReactTestElement;
	defaultPrevented: boolean;
	stopped: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

interface Sliders {
	readonly sliders: readonly ReactTestElement[];
	capture(slider: ReactTestElement, event: RangeKey, phase?: 'down' | 'up'): void;
}

async function withSliders(run: (controls: Sliders) => Promise<void>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
		timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id: 'warp', title: 'Warp', now: '2026-10-09T00:00:00.000Z',
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: [clip.id] })] });
	const controller = { actions: { audioWarp: {
		view: () => ({ renderStatus: { path: 'exact-offline' as const } }),
		analyze() {}, createIdentityMap() {}, addMarker() {}, moveMarker() {}, deleteMarker() {},
		quantize() {}, applyGroove() {}, clear() {},
	} } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<AudioWarpDialog productId="soundscaper" controller={controller}
			snapshot={{ project, selectedClipId: clip.id }} copy={ENGLISH_COPY}
			run={operation => operation()} onClose={() => undefined} />); });
		const groove = dom.container.querySelectorAll('input').find(control => control.type === 'checkbox');
		assert.ok(groove);
		await act(async () => { reactProps(groove).onChange({ currentTarget: { checked: true } }); });
		const sliders = dom.container.querySelectorAll('input').filter(control => control.type === 'range');
		assert.equal(sliders.length, 2);
		const panel = dom.container.querySelectorAll('[role="dialog"]')[0];
		assert.ok(panel);
		await run({ sliders, capture(slider, event, phase = 'down') {
			event.target = slider;
			const handler = reactProps(panel)[phase === 'down' ? 'onKeyDownCapture' : 'onKeyUpCapture'] as
				((event: RangeKey) => void) | undefined;
			handler?.(event);
		} });
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
}

function key(key: string, modifiers: Partial<Pick<RangeKey, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}): RangeKey {
	return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers,
		defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.stopped = true; } };
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
	test(`ordinary Audio warp strength inputs refuse ${modifier} native navigation`, async () => {
		await withSliders(async ({ sliders, capture }) => {
			for (const slider of sliders) {
				const before = Number(reactProps(slider).value);
				const event = key('End', { [modifier]: true });
				await act(async () => { capture(slider, event); });
				assert.equal(event.defaultPrevented, true, `${String(reactProps(slider)['aria-label'])} must prevent the native parameter jump`);
				assert.equal(reactProps(slider).value, before);
				assert.equal(event.stopped, true);
				const release = key('End', { [modifier]: true });
				await act(async () => { capture(slider, release, 'up'); });
				assert.equal(release.stopped, true, 'modified release must not finish an unrelated parameter gesture');
			}
		});
	});
}

test('both Audio warp strength inputs retain ordinary/Shift navigation and pointer changes', async () => {
	await withSliders(async ({ sliders, capture }) => {
		for (const slider of sliders) {
			for (const event of [key('ArrowRight'), key('Home'), key('End'), key('ArrowRight', { shiftKey: true }), key('a', { ctrlKey: true })]) {
				await act(async () => { capture(slider, event); });
				assert.equal(event.defaultPrevented, false);
			}
			await act(async () => { reactProps(slider).onChange({ currentTarget: { value: '75' } }); });
			assert.equal(reactProps(slider).value, 75);
			await act(async () => { reactProps(slider).onDoubleClick({ preventDefault() {}, stopPropagation() {} }); });
			assert.equal(reactProps(slider).value, 50);
		}
	});
});

test('modal native-range guard leaves nonmodal, text, number and already-owned keys intact', () => {
	const dom = installReactTestDom();
	try {
		for (const type of ['range', 'text', 'number']) {
			const input = document.createElement('input'); input.setAttribute('type', type);
			for (const modal of [false, true]) {
				const event = { ...key('End', { ctrlKey: true }), target: input };
				guardModalNativeRangeKey(event, modal);
				assert.equal(event.defaultPrevented, modal && type === 'range');
				assert.equal(event.stopped, modal && type === 'range');
			}
			const handled = { ...key('End', { ctrlKey: true }), target: input, defaultPrevented: true };
			guardModalNativeRangeKey(handled, true);
			assert.equal(handled.stopped, false);
		}
	} finally { dom.restore(); }
});

test('modal guard owns every native range navigation key only for command modifiers', () => {
	const dom = installReactTestDom();
	try {
		const input = document.createElement('input'); input.setAttribute('type', 'range');
		for (const navigation of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) {
			for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
				const event = { ...key(navigation, { [modifier]: true }), target: input };
				guardModalNativeRangeKey(event, true);
				assert.equal(event.defaultPrevented, true);
				assert.equal(event.stopped, true);
			}
			for (const shiftKey of [false, true]) {
				const event = { ...key(navigation, { shiftKey }), target: input };
				guardModalNativeRangeKey(event, true);
				assert.equal(event.defaultPrevented, false);
				assert.equal(event.stopped, false);
			}
		}
	} finally { dom.restore(); }
});
