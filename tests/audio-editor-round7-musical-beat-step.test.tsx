/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { TimeCodeMusicalContext, type TimeCodeMusicalMap } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts';
import { createMusicalTimeCodeMap, createMusicalDurationTimeCodeMap,
	type MusicalTimeCodeProject } from '../src/common/editor/ui/time-code-musical-map.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const mode of ['musical', 'sampleLocked'] as const) test(`native beat stepping crosses back through a ${mode} bar with a changed meter`, async () => {
	const project: MusicalTimeCodeProject = { sampleRate: 48000,
		tempoMap: { mode, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 },
			...(mode === 'sampleLocked' ? { samplePosition: secondsToSampleFrame(0, 48000) } : {}) }] },
		signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }, { bar: 1, numerator: 3, denominator: 8 }] },
	};
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	let current = 0;
	function Clock({ initial, map }: { initial: number; map: TimeCodeMusicalMap }) {
		const [value, setValue] = useState(initial);
		current = value;
		return <TimeCodeMusicalContext.Provider value={map}><TimeCode
			value={value} format="beats:bars" showFormatSelector={false} onChange={setValue} />
		</TimeCodeMusicalContext.Provider>;
	}
	const absolute = createMusicalTimeCodeMap(project);
	const open = async (initial: number, key: string, map = absolute) => {
		await act(async () => { root.render(<Clock key={key} initial={initial} map={map} />); });
		const beat = dom.container.querySelectorAll('.timecode-digit').at(-1);
		assert.ok(beat);
		beat.focus();
		await act(async () => { reactProps(beat).onClick(); });
	};
	const press = async (key: string) => {
		const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
		await act(async () => {
			for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		});
		assert.equal(event.defaultPrevented, true);
	};
	try {
		await open(2, 'healthy');
		await press('ArrowDown');
		assert.equal(current, 1);
		await press('ArrowUp');
		assert.equal(current, 2);
		await open(0, 'minimum');
		await press('ArrowDown');
		assert.equal(current, 0, 'the project beginning retains its lower bound');
		await open(4, 'new-meter');
		await press('0');
		assert.equal(current, 4, 'literal zero entry retains the existing one-based beat contract');
		await open(4, 'new-meter-stepping');
		await press('ArrowUp');
		assert.equal(current, 4.5, 'the current meter supplies its native half-quarter beat');
		await press('ArrowDown');
		assert.equal(current, 4);
		await open(3, 'crossing');
		await press('ArrowUp');
		assert.equal(current, 4, 'forward stepping reaches the next bar');
		await press('ArrowDown');
		assert.equal(current, 3, 'backward stepping returns the previous meter’s last beat');
		await open(4.125, 'phase');
		await press('ArrowDown');
		assert.equal(current, 3.125, 'native digit stepping retains the sub-beat sample phase');
		await open(4, 'duration', createMusicalDurationTimeCodeMap(project, 0));
		await press('ArrowDown');
		assert.equal(current, 3, 'duration consumers use the same local beat stepping contract');
		const wideMeter = createMusicalTimeCodeMap({ ...project, signatureMap: { events: [
			{ bar: 0, numerator: 4, denominator: 4 }, { bar: 1, numerator: 12, denominator: 8 },
		] } });
		await open(4, 'padded-beat', wideMeter);
		await press('ArrowDown');
		assert.equal(current, 3, 'a two-digit meter still crosses backward from its padded beat01');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
