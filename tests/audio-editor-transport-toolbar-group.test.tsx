/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TransportToolbarGroup, {
	COMPACT_BAR_TRANSPORT_BUTTONS,
	DRAWER_TRANSPORT_BUTTONS,
	TRANSPORT_BUTTON_IDS,
	transportToolbarButtonsVisible,
} from '../src/common/editor/ui/toolbar/TransportToolbarGroup.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

const snapshot = {
	productId: 'soundscaper',
	project: { id: 'p1', tracks: [], clips: [], loop: { enabled: false } },
	preferences: { workspace: { panels: {} } },
	transportState: 'stopped',
	recording: null,
	readOnly: false,
};

function render(buttons: readonly string[], audioRecording = true, toolbarButtons: Record<string, boolean> = {}) {
	return renderToStaticMarkup(
		<TransportToolbarGroup
			buttons={buttons}
			actionRuntime={{}}
			blocked={false}
			capabilities={{ audioRecording }}
			controller={{
				actions: { transport: {}, recording: {} },
				getTelemetrySnapshot: () => ({ transportState: 'stopped' }),
				subscribeTelemetry: () => () => undefined,
			}}
			copy={ENGLISH_COPY}
			onJumpToEnd={() => undefined}
			onJumpToStart={() => undefined}
			onOpenRecordingOffset={() => undefined}
			onOpenTakeCycleRecovery={() => undefined}
			onOpenTimedRecording={() => undefined}
			recordLabel={ENGLISH_COPY.record}
			run={() => undefined}
			snapshot={snapshot}
			toggleRecording={() => undefined}
			toolbarButtons={toolbarButtons}
		/>,
	);
}

test('the compact-bar and drawer button sets partition the transport group', () => {
	assert.deepEqual([...COMPACT_BAR_TRANSPORT_BUTTONS, ...DRAWER_TRANSPORT_BUTTONS].sort(), [...TRANSPORT_BUTTON_IDS].sort());
	assert.equal(COMPACT_BAR_TRANSPORT_BUTTONS.some((id) => DRAWER_TRANSPORT_BUTTONS.includes(id)), false);
});

test('the compact-bar set renders play, stop and record and nothing else', () => {
	const markup = render(COMPACT_BAR_TRANSPORT_BUTTONS);
	assert.match(markup, /data-transport="play"/u);
	assert.match(markup, /data-transport="stop"/u);
	assert.match(markup, /data-transport="record"/u);
	for (const label of [ENGLISH_COPY.jumpStart, ENGLISH_COPY.jumpEnd, ENGLISH_COPY.loop, ENGLISH_COPY.metronome]) {
		assert.equal(markup.includes(`aria-label="${label}"`), false, `${label} belongs to the drawer set`);
	}
});

test('the drawer set renders the secondary transport without the primary controls', () => {
	const markup = render(DRAWER_TRANSPORT_BUTTONS);
	assert.doesNotMatch(markup, /data-transport="/u);
	for (const label of [ENGLISH_COPY.jumpStart, ENGLISH_COPY.jumpEnd, ENGLISH_COPY.loop, ENGLISH_COPY.metronome]) {
		assert.ok(markup.includes(`aria-label="${label}"`), `renders ${label}`);
	}
});

test('record needs the audio recording capability and the button preference', () => {
	assert.doesNotMatch(render(COMPACT_BAR_TRANSPORT_BUTTONS, false), /data-transport="record"/u);
	assert.doesNotMatch(render(COMPACT_BAR_TRANSPORT_BUTTONS, true, { record: false }), /data-transport="record"/u);
	assert.doesNotMatch(render(COMPACT_BAR_TRANSPORT_BUTTONS, true, { stop: false }), /data-transport="stop"/u);
});

test('transportToolbarButtonsVisible honours the requested subset and the record fallback', () => {
	const visible = (buttons: readonly string[], overrides: Partial<Parameters<typeof transportToolbarButtonsVisible>[1]> = {}) => (
		transportToolbarButtonsVisible(buttons, {
			capabilities: { audioRecording: false },
			captureRecordRequired: false,
			framescaperCaptureRecordVisible: false,
			isToolbarButtonVisible: () => true,
			...overrides,
		})
	);
	assert.equal(visible(['play']), true);
	assert.equal(visible(['play'], { isToolbarButtonVisible: () => false }), false);
	assert.equal(visible(['record']), false, 'record without any recording capability is hidden');
	assert.equal(visible(['record'], { capabilities: { audioRecording: true } }), true);
	assert.equal(visible(['record'], { capabilities: { audioRecording: true }, isToolbarButtonVisible: () => false }), false);
	assert.equal(visible(['record'], { framescaperCaptureRecordVisible: true, captureRecordRequired: true, isToolbarButtonVisible: () => false }), true);
	assert.equal(visible([]), false);
});
