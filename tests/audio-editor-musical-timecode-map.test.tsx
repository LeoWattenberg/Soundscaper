/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createMusicalTimeCodeMap, type MusicalTimeCodeProject } from '../src/common/editor/ui/time-code-musical-map.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';

const project: MusicalTimeCodeProject = {
	sampleRate: 48_000,
	tempoMap: { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
		{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
	] },
	signatureMap: { events: [
		{ bar: 0, numerator: 4, denominator: 4 },
		{ bar: 2, numerator: 3, denominator: 8 },
	] },
};

test('musical timecode follows secondary tempo and signature events in both directions', () => {
	const map = createMusicalTimeCodeMap(project);
	assert.deepEqual(map.fromSeconds(2), { bar: 0, beat: 3, beatsPerBar: 4 });
	assert.deepEqual(map.fromSeconds(6), { bar: 2, beat: 1, beatsPerBar: 3 });
	assert.deepEqual(map.fromSeconds(6.5), { bar: 2, beat: 3, beatsPerBar: 3 });
	assert.equal(map.toSeconds(0, 3), 2);
	assert.equal(map.toSeconds(2, 3), 6.5);
	const sampleLocked = createMusicalTimeCodeMap({ ...project, tempoMap: {
		mode: 'sampleLocked', events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 }, samplePosition: secondsToSampleFrame(0, 48_000) },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: secondsToSampleFrame(4, 48_000) },
		],
	} });
	assert.deepEqual(sampleLocked.fromSeconds(6.5), map.fromSeconds(6.5));
	assert.equal(sampleLocked.toSeconds(2, 3), 6.5);
});

test('the editor project supplies its musical map to every nested timecode', () => {
	const controller = { subscribe: () => () => undefined, getSnapshot: () => ({ project }) };
	const markup = renderToStaticMarkup(<EditorMusicalTimeCodeProvider controller={controller}>
		<TimeCode value={2} format="beats:bars" />
	</EditorMusicalTimeCodeProvider>);
	const digits = [...markup.matchAll(/class="timecode-digit[^"]*"[^>]*>(\d)<\/span>/gu)]
		.map((match) => match[1]).join('');
	assert.equal(digits, '0003');
});
