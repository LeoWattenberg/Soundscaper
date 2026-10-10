/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { applyAudacityTruncateSilence } from '../src/common/editor/audacity-effects/basic.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const parameter of ['minimumSilence', 'truncateTo'] as const) for (const originSeconds of [0, 4, 2]) {
	test(`Truncate Silence ${parameter} musical duration measures from its ${originSeconds}s selected interval`, async () => {
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
				frameCount: 288000, sampleRate: 48000, channelCount: 1 });
			const clip = createAudioClip({ id: 'rate-clip', sourceId: source.id, title: 'Recording',
				timelineStartFrame: originSeconds * 48000, durationFrames: 288000,
				sourceStartFrame: 0, sourceDurationFrames: 288000 });
			const track = createAudioTrack({ id: 'rate-track', name: 'Recording', clipIds: [clip.id] });
			const project = createSoundscaperProject({ id: `rate-${originSeconds}`, sources: [source], clips: [clip], tracks: [track],
				tempoMap: { mode: 'musical', events: [
					{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
					{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
				] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
			});
			const snapshot = { ready: true, project, selectedClipId: clip.id, selectedTrackId: track.id,
				effects: { selectionType: 'audacity-truncate-silence', selectionParams: { action: 'truncate', minimumSilence: .5, truncateTo: .5 }, presets: [] } };
			const controller = { project, getSnapshot: () => snapshot, subscribe: () => () => undefined,
				actions: { effects: { setSelectionParams: (next: Readonly<Record<string, number>>) => changes.push(next),
					setControlTrack: () => undefined, cancelPreview: () => undefined,
					previewSelection: () => undefined, applySelection: () => undefined } } };
			await act(async () => root.render(<EditorMusicalTimeCodeProvider controller={controller}>
				<SelectionEffectsDialog isOpen controller={controller} snapshot={snapshot}
					copy={ENGLISH_COPY} fileService={null} onClose={() => undefined} />
			</EditorMusicalTimeCodeProvider>));
			const desired = dom.one(`[data-effect-param="${parameter}"]`);
			await enterDigits(desired, '000002000');
			assert.deepEqual(changes.at(-1), { [parameter]: 2 }, 'ordinary seconds entry retains the physical duration');
			const secondsCommits = changes.length;
			await musicalFormat(desired);
			assert.equal(changes.length, secondsCommits, 'format changes do not author the effect');
			await enterDigits(desired, '0011');
			const seconds = originSeconds === 0 ? 4 : originSeconds === 4 ? 2 : 3;
			assert.deepEqual(changes.at(-1), { [parameter]: seconds },
				'a local bar follows the interval origin, including an interval crossing the tempo event');
			if (originSeconds === 4) {
				const pcm = new Float32Array(288000);
				for (let frame = 0; frame < pcm.length; frame++) {
					if (frame < 72000 || frame >= 216000) pcm[frame] = .4 * Math.sin(frame * Math.PI / 24);
				}
				const params = Object.assign({ minimumSilence: 2, truncateTo: .5 }, ...changes);
				const healthy = applyAudacityTruncateSilence([pcm], 48000, { ...params, [parameter]: 2 });
				const musical = applyAudacityTruncateSilence([pcm], 48000, params);
				assert.ok(healthy[0] && musical[0]);
				assert.equal(musical[0].length, healthy[0].length, 'the same musical duration produces the same physical silence edit');
			}

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
