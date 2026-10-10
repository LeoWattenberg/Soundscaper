/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RegularIntervalAnnotationDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RegularIntervalAnnotationOptions } from '../src/common/editor/controller/document/regular-interval-annotation-service.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const originSeconds of [0, 4, 2]) {
	test(`regular annotation musical interval measures from its authored ${originSeconds}s start`, async () => {
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
		document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
		document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
		const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Tone', frameCount: 384_000, sampleRate: 48_000, channelCount: 1 });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Tone', timelineStartFrame: 0,
			durationFrames: 384_000, sourceStartFrame: 0, sourceDurationFrames: 384_000 });
		const project = createSoundscaperProject({ id: 'interval-project', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'track', name: 'Tone', clipIds: [clip.id] })],
			tempoMap: { mode: 'musical', events: [
				{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
				{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
			] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
		});
		const snapshot = { project };
		const submissions: RegularIntervalAnnotationOptions[] = [];
		const controller = { project, getSnapshot: () => snapshot, subscribe: () => () => undefined,
			actions: { project: { importFiles: () => undefined }, timelineAnnotations: { regularInterval: (request: RegularIntervalAnnotationOptions) => { submissions.push(request); } } } };
		try {
			await act(async () => root.render(<EditorMusicalTimeCodeProvider controller={controller}>
				<RegularIntervalAnnotationDialog controller={controller} snapshot={snapshot} copy={ENGLISH_COPY}
					run={operation => operation()} onClose={() => undefined} />
			</EditorMusicalTimeCodeProvider>));
			const start = dom.one('[aria-label="Start frame"]');
			await enter(start, `00000${originSeconds}000`);
			const interval = dom.one('[aria-label="Interval in frames"]');
			await enter(interval, '000002000');
			await submit();
			assert.equal(submissions.at(-1)?.anchor, 'sample');
			assert.deepEqual(submissions.at(-1), { kind: 'marker', anchor: 'sample', sequenceId: project.primarySequenceId,
				startFrame: originSeconds * 48_000, endFrame: 384_000, intervalFrames: 96_000, namePrefix: 'Cue', color: 'auto' },
				'explicit elapsed seconds and both absolute endpoints remain exact');
			const format = interval.querySelector('.timecode__format-button'); assert.ok(format);
			await act(async () => { reactProps(format).onClick({ detail: 1 }); });
			const beats = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'beats:bars'); assert.ok(beats);
			await act(async () => { reactProps(beats).onClick({}); });
			await enter(interval, '0011');
			await submit();
			const request = submissions.at(-1); assert.ok(request && request.anchor === 'sample');
			assert.equal(request.startFrame, originSeconds * 48_000);
			assert.equal(request.endFrame, 384_000);
			assert.equal(request.intervalFrames, originSeconds === 0 ? 192_000 : originSeconds === 4 ? 96_000 : 144_000,
				'one bar follows the authored interval start and any crossed tempo event');
		} finally {
			await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
			if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver'); dom.restore();
		}
		async function submit(): Promise<void> {
			await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); });
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
