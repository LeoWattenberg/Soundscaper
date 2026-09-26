/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MetadataEditorTabs from '../src/common/editor/ui/MetadataEditorTabs.tsx';
import { SequenceTimingProjectProperties } from '../src/common/editor/ui/toolbar/SequenceTimingControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const render = (element: ReturnType<typeof React.createElement>): string => renderToStaticMarkup(element);
const rate = { num: 25, den: 1 };
const startTimecode = { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 };

test('the sequence tab is offered only by project properties', () => {
	const ordinary = render(<MetadataEditorTabs activeTab="general" showBext copy={ENGLISH_COPY}
		onChange={() => undefined} />);
	assert.doesNotMatch(ordinary, />Sequence timing</u);

	const framescaper = render(<MetadataEditorTabs activeTab="sequence" showSequence showBext
		copy={ENGLISH_COPY} onChange={() => undefined} />);
	assert.match(framescaper, /aria-selected="true"[^>]*>Sequence timing</u);
});

test('project properties can choose and edit either timeline sequence', () => {
	const project = {
		primarySequenceId: 'primary',
		timeDisplay: { format: 'timecode' },
		sequences: [
			{ id: 'primary', name: 'Main timeline', rate, startTimecode, dropFrame: false },
			{ id: 'nested', name: 'Cutaway', rate, startTimecode, dropFrame: false },
		],
	};
	const markup = render(<SequenceTimingProjectProperties project={project}
		snapshot={{ readOnly: false, recording: false }} controller={{ actions: {} }}
		copy={ENGLISH_COPY} run={() => undefined} />);
	assert.match(markup, /data-project-sequence-properties/u);
	assert.match(markup, /<option value="primary" selected="">Main timeline<\/option>/u);
	assert.match(markup, /<option value="nested">Cutaway<\/option>/u);
	assert.match(markup, /data-sequence-rate="25\/1"/u);
});
