/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const originSeconds of [0, 4, 2]) {
	for (const name of ['durationFrame', 'fadeInFrame', 'fadeOutFrame'] as const) {
		test(`Clip properties ${name} measures a bar at placement ${originSeconds}s`, async () => {
			const dom = installReactTestDom();
			const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
			const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
			Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
			Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
			globals.IS_REACT_ACT_ENVIRONMENT = true;
			const root = createRoot(dom.container as unknown as Element);
			const keys = new Set<EventListenerOrEventListenerObject>();
			document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
			document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
			const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Tone', frameCount: 240_000, sampleRate: 48_000, channelCount: 1 });
			const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Tone', timelineStartFrame: originSeconds * 48_000,
				durationFrames: 240_000, sourceStartFrame: 0, sourceDurationFrames: 240_000 });
			const project = createSoundscaperProject({ id: 'duration-project', sources: [source], clips: [clip],
				tracks: [createAudioTrack({ id: 'track', name: 'Tone', clipIds: [clip.id] })],
				tempoMap: { mode: 'musical', events: [
					{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
					{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
				] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
			});
			const snapshot = { project, selectedClipId: clip.id, capabilities: { audioEffects: false } };
			const submissions: { readonly clipId: string; readonly changes: Readonly<Record<string, unknown>> }[] = [];
			const submit = (clipId: string, changes: Readonly<Record<string, unknown>>) => { submissions.push({ clipId, changes }); };
			const controller = { project, getSnapshot: () => snapshot, subscribe: () => () => undefined,
				actions: { clipSourcePreview: { trim: submit }, clip: { update: submit } } };
			try {
				await act(async () => root.render(<EditorMusicalTimeCodeProvider controller={controller}>
					<ClipPropertiesBody controller={controller} snapshot={snapshot} copy={ENGLISH_COPY} />
				</EditorMusicalTimeCodeProvider>));
				const field = dom.one(`[data-clip-field="${name}"]`);
				await enter(field, '000003000');
				const property = name === 'durationFrame' ? 'durationFrames' : name === 'fadeInFrame' ? 'fadeInFrames' : 'fadeOutFrames';
				assert.equal(submissions.at(-1)?.changes[property], 144_000, 'explicit elapsed seconds remain exact');
				assert.equal(submissions.at(-1)?.clipId, clip.id);
				const button = field.querySelector('.timecode__format-button'); assert.ok(button);
				await act(async () => { reactProps(button).onClick({ detail: 1 }); });
				const musical = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'beats:bars'); assert.ok(musical);
				await act(async () => { reactProps(musical).onClick({}); });
				await enter(field, '0011');
				assert.equal(submissions.at(-1)?.changes[property], originSeconds === 0 ? 192_000 : originSeconds === 4 ? 96_000 : 144_000,
					'one elapsed bar follows the tempo at the clip placement, including a crossed event');
			} finally {
				await act(async () => { root.unmount(); }); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
				if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
				if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver'); dom.restore();
			}
			async function enter(field: ReactTestElement, digits: string): Promise<void> {
				const first = field.querySelector('.timecode-digit'); assert.ok(first); first.focus();
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
}
