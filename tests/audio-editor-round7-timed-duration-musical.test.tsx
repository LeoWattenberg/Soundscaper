/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import TimedRecordingDialogFields from '../src/common/editor/ui/dialogs/TimedRecordingDialogFields.tsx';
import { createTimedRecordingDialogValue, timedRecordingDialogRange } from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { RECORDING_COPY_BY_LOCALE } from '../src/common/i18n/recording-copy.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const owner of ['fields', 'dialog']) for (const originSeconds of [0, 4, 2]) {
	test(`Timed recording ${owner} measures an elapsed bar at programme insertion ${originSeconds}s`, async () => {
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
		const project = createSoundscaperProject({ id: 'duration-project',
			tempoMap: { mode: 'musical', events: [
				{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
				{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
			] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
		});
		const snapshot = { project, readOnly: false };
		const controller = { getSnapshot: () => snapshot, subscribe: () => () => undefined,
			getTelemetrySnapshot: () => ({ positionFrame: originSeconds * 48_000 }) };
		let value = createTimedRecordingDialogValue(new Date(2030, 5, 1, 12).getTime());
		const initialStart = value.startTimeMs; assert.equal(typeof initialStart, 'number'); assert.ok(initialStart);
		const render = () => root.render(<EditorMusicalTimeCodeProvider controller={controller}>
			{owner === 'fields' ? <TimedRecordingDialogFields value={value} controller={controller} originFrame={originSeconds * 48_000}
				onValueChange={(next) => { value = next; render(); }} onSubmit={() => undefined}
				copy={RECORDING_COPY_BY_LOCALE.en} locale="en" />
				: <EditorDialog type="timed-recording" value={value} controller={controller} snapshot={snapshot}
					onValueChange={(next: typeof value) => { value = next; render(); }} trackId={undefined}
					copy={{ ...ENGLISH_COPY, ...RECORDING_COPY_BY_LOCALE.en }} locale="en"
					run={(action: () => unknown) => action()} onClose={() => undefined} />}
		</EditorMusicalTimeCodeProvider>);

		try {
			await act(async () => { render(); });
			const field = dom.one('.timecode');
			await enter(field, '000005000');
			assert.equal(value.durationSeconds, 5, 'explicit elapsed seconds remain exact');
			assert.equal(timedRecordingDialogRange(value)?.endTimeMs, initialStart + 5000);
			const button = field.querySelector('.timecode__format-button'); assert.ok(button);
			await act(async () => { reactProps(button).onClick({ detail: 1 }); });
			const musical = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'beats:bars'); assert.ok(musical);
			await act(async () => { reactProps(musical).onClick({}); });
			await enter(field, '0011');
			const expectedSeconds = originSeconds === 0 ? 4 : originSeconds === 4 ? 2 : 3;
			assert.equal(value.durationSeconds, expectedSeconds,
				'one elapsed bar follows tempo at recording insertion, including a crossed event');
			assert.deepEqual(timedRecordingDialogRange(value), { startTimeMs: initialStart, endTimeMs: initialStart + expectedSeconds * 1000 });
			assert.equal(value.endMode, 'duration');

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
