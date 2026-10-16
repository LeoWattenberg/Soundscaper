/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const effect of [
	{ type: 'audacity-change-tempo', parameter: 'tempoPercent' },
	{ type: 'audacity-change-speed-pitch', parameter: 'speedPercent' },
] as const) for (const originSeconds of [0, 4, 2]) {
	test(`${effect.type} desired musical duration measures from its ${originSeconds}s selected interval`, async () => {
		const dom = installReactTestDom();
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const keys = new Set<EventListenerOrEventListenerObject>();
		document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
			if (kind === 'keydown' && listener) keys.add(listener);
		};
		document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
			if (kind === 'keydown' && listener) keys.delete(listener);
		};
		const changes: Readonly<Record<string, number>>[] = [];
		try {
			const source = createAudioSource({ id: 'rate-source', storageKey: 'rate-source', name: 'Recording',
				frameCount: 144000, sampleRate: 48000, channelCount: 1 });
			const clip = createAudioClip({ id: 'rate-clip', sourceId: source.id, title: 'Recording',
				timelineStartFrame: originSeconds * 48000, durationFrames: 144000,
				sourceStartFrame: 0, sourceDurationFrames: 144000 });
			const track = createAudioTrack({ id: 'rate-track', name: 'Recording', clipIds: [clip.id] });
			const project = createSoundscaperProject({ id: `rate-${originSeconds}`, sources: [source], clips: [clip], tracks: [track],
				tempoMap: { mode: 'musical', events: [
					{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
					{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
				] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
			});
			const snapshot = { ready: true, project, selectedClipId: clip.id, selectedTrackId: track.id,
				effects: { selectionType: effect.type, selectionParams: { [effect.parameter]: 0 }, presets: [] } };
			const controller = { project, getSnapshot: () => snapshot, subscribe: () => () => undefined,
				actions: { effects: { setSelectionParams: (next: Readonly<Record<string, number>>) => changes.push(next),
					setControlTrack: () => undefined, cancelPreview: () => undefined,
					previewSelection: () => undefined, applySelection: () => undefined } } };
			await act(async () => root.render(<EditorMusicalTimeCodeProvider controller={controller}>
				<SelectionEffectsDialog isOpen controller={controller} snapshot={snapshot}
					copy={ENGLISH_COPY} fileService={null} onClose={() => undefined} />
			</EditorMusicalTimeCodeProvider>));
			const desired = dom.one('[data-effect-param="effectAudacityNewLength"]');
			await enterDigits(desired, '000002000');
			assert.deepEqual(changes.at(-1), { [effect.parameter]: 50 }, 'ordinary seconds entry retains the physical rate');
			const secondsCommits = changes.length;
			await musicalFormat(desired);
			assert.equal(changes.length, secondsCommits, 'format changes do not author the effect');
			await enterDigits(desired, '0011');
			const percent = originSeconds === 0 ? -25 : originSeconds === 4 ? 50 : 0;
			assert.deepEqual(changes.at(-1), { [effect.parameter]: percent },
				'a local bar follows the interval origin, including an interval crossing the tempo event');
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
			if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
			dom.restore();
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
	});
}
