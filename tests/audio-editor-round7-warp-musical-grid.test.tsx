/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioWarpDialog from '../src/common/editor/ui/dialogs/AudioWarpDialog.tsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('warp sample-grid musical entry measures from the selected recording rather than project zero', async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	const submissions: unknown[] = [];
	try {
		for (const originSeconds of [0, 4, 2]) {
			const source = createAudioSource({ id: 'drum-source', storageKey: 'drum-source', name: 'Drums',
				frameCount: 240_000, sampleRate: 48_000, channelCount: 1 });
			const clip = createAudioClip({ id: 'drum-clip', sourceId: source.id, title: 'Drums',
				timelineStartFrame: originSeconds * 48_000, durationFrames: 240_000,
				sourceStartFrame: 0, sourceDurationFrames: 240_000 });
			const project = createSoundscaperProject({ id: 'warp-grid', sources: [source], clips: [clip],
				tracks: [createAudioTrack({ id: 'drum-track', name: 'Drums', clipIds: [clip.id] })],
				tempoMap: { mode: 'musical', events: [
					{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
					{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
				] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
			});
			const snapshot = { project, selectedClipId: clip.id };
			const controller = { getSnapshot: () => snapshot, subscribe: () => () => undefined,
				actions: { audioWarp: {
					view: () => ({ renderStatus: { path: 'realtime' as const } }), analyze: () => undefined,
					createIdentityMap: () => undefined, addMarker: () => undefined, moveMarker: () => undefined,
					deleteMarker: () => undefined, clear: () => undefined, applyGroove: () => undefined,
					quantize: (options: unknown) => { submissions.push(options); },
				} } };
			await act(async () => root.render(<EditorMusicalTimeCodeProvider controller={controller}>
				<AudioWarpDialog key={originSeconds} productId="soundscaper" controller={controller} snapshot={snapshot}
					copy={ENGLISH_COPY} run={(operation) => operation()} onClose={() => undefined} />
			</EditorMusicalTimeCodeProvider>));
			const interval = namedField(ENGLISH_COPY.audioWarpGridInterval);
			await enterDigits(interval, '000000096000');
			await submit();
			assert.deepEqual(submissions.at(-1), { grid: { origin: 0, interval: 96_000 }, strength: { num: 50, den: 100 } },
				'explicit sample entry retains its exact native grid at every placement');
			await musicalFormat(interval);
			await enterDigits(interval, '0011');
			const origin = namedField(ENGLISH_COPY.audioWarpGridOrigin);
			await musicalFormat(origin);
			await enterDigits(origin, '0011');
			await submit();
			const barFrames = originSeconds === 0 ? 192_000 : originSeconds === 4 ? 96_000 : 144_000;
			assert.deepEqual(submissions.at(-1), { grid: { origin: barFrames, interval: barFrames }, strength: { num: 50, den: 100 } },
				'origin and interval count a local bar from the real clip placement, including a crossed tempo event');
		}
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}

	function namedField(label: string): ReactTestElement {
		const field = dom.container.querySelectorAll('[role="group"]').find(node => node.getAttribute('aria-label') === label);
		assert.ok(field);
		return field;
	}
	async function musicalFormat(field: ReactTestElement): Promise<void> {
		const button = field.querySelector('.timecode__format-button');
		assert.ok(button);
		await act(async () => { reactProps(button).onClick({ detail: 1 }); });
		const item = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'beats:bars');
		assert.ok(item);
		await act(async () => { reactProps(item).onClick({}); });
	}
	async function enterDigits(field: ReactTestElement, digits: string): Promise<void> {
		const first = field.querySelector('.timecode-digit');
		assert.ok(first);
		first.focus();
		await act(async () => { reactProps(first).onClick(); });
		for (const key of [...digits, 'Enter']) await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
			for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		});
	}
	async function submit(): Promise<void> {
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === ENGLISH_COPY.audioWarpQuantize);
		assert.ok(button);
		await act(async () => { reactProps(button).onClick(); });
	}
});
