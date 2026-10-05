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
import { AccessibleTimeCode, PlaySpeedFlyout, TelemetryTimeCode } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';

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

function render(buttons: readonly string[], audioRecording = true, toolbarButtons: Record<string, boolean> = {}, recording = false, framescaper = false) {
	return renderToStaticMarkup(
		<TransportToolbarGroup
			buttons={buttons}
			blocked={false}
			capabilities={{ audioRecording, sequenceTiming: framescaper }}
			controller={{
				actions: { transport: {}, recording: {}, video: { sourceTimecodeAtSample: () => null } },
				getTelemetrySnapshot: () => ({ transportState: 'stopped' }),
				subscribeTelemetry: () => () => undefined,
			}}
			copy={ENGLISH_COPY}
			locale="en"
			onJumpToEnd={() => undefined}
			onJumpToStart={() => undefined}
			onOpenTakeCycleRecovery={() => undefined}
			onOpenTimedRecording={() => undefined}
			recordLabel={ENGLISH_COPY.record}
			run={() => undefined}
			snapshot={{ ...snapshot, recording, ...(framescaper ? {
				productId: 'framescaper', project: { ...snapshot.project, sampleRate: 48_000, primarySequenceId: 'main', sequences: [{
					id: 'main', name: 'Main sequence', rate: { num: 30, den: 1 }, dropFrame: false,
					startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
				}] },
			} : {}) }}
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

test('Framescaper frame steps use transport buttons between the project endpoints', () => {
	const markup = render(DRAWER_TRANSPORT_BUTTONS, false, {}, false, true);
	const labels = [ENGLISH_COPY.jumpStart, ENGLISH_COPY.previousFrame, ENGLISH_COPY.nextFrame, ENGLISH_COPY.jumpEnd];
	const offsets = labels.map((label) => markup.indexOf(`aria-label="${label}"`));
	assert.ok(offsets.every((offset) => offset >= 0));
	assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
	for (const label of labels) assert.match(markup, new RegExp(`<button[^>]*class="transport-button[^>]*aria-label="${label}"`, 'u'));
	assert.doesNotMatch(render(COMPACT_BAR_TRANSPORT_BUTTONS, false, {}, false, true), /data-sequence-step/u);
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

test('the play dropdown separates selection playback from its speed controls', () => {
	const markup = renderToStaticMarkup(
		<ThemeProvider>
			<PlaySpeedFlyout
				copy={ENGLISH_COPY}
				snapshot={{ ...snapshot, selection: { startFrame: 10, endFrame: 20 } }}
				blocked={false}
				controller={{
					actions: { transport: { playSelection: () => undefined }, preferences: { update: () => undefined } },
					getTelemetrySnapshot: () => ({ transportState: 'stopped' }),
					subscribeTelemetry: () => () => undefined,
				}}
				run={() => undefined}
			/>
		</ThemeProvider>,
	);

	const selection = markup.indexOf(`>${ENGLISH_COPY.playSelection}<`);
	const divider = markup.indexOf('role="separator"');
	const pitch = markup.indexOf(`>${ENGLISH_COPY.playAtSpeedPreservePitch}<`);
	assert.ok(selection >= 0 && selection < divider && divider < pitch);
	assert.equal(GERMAN_COPY.playSelection, 'Auswahl abspielen');
});

test('the Play Selection menu displays stored shortcut alternatives and respects removals', () => {
	for (const [shortcuts, expected] of [
		[createAudioEditorPreferencesV1().shortcuts, 'W'],
		[{ 'action://playback/play-selection': ['Alt+W', 'Ctrl+Alt+W'] }, 'Alt+W, Ctrl+Alt+W'],
		[{}, null],
	] as const) {
		const markup = renderToStaticMarkup(<ThemeProvider><PlaySpeedFlyout
			copy={ENGLISH_COPY}
			snapshot={{ ...snapshot, preferences: { ...snapshot.preferences, shortcuts } }}
			blocked={false}
			controller={{
				actions: { transport: { playSelection: () => undefined }, preferences: { update: () => undefined } },
				getTelemetrySnapshot: () => ({ transportState: 'stopped' }),
				subscribeTelemetry: () => () => undefined,
			}}
			run={() => undefined}
		/></ThemeProvider>);
		const selectionItem = markup.match(/<span class="context-menu-item-label">Play selection<\/span>([^]*?)<\/div>/u)?.[1];
		assert.ok(selectionItem !== undefined);
		if (expected) assert.ok(selectionItem.includes(`class="context-menu-item-shortcut">${expected}</span>`));
		else assert.doesNotMatch(selectionItem, /context-menu-item-shortcut/u);
	}
});

test('transport icons use upstream idle accents and white while recording', () => {
	const idle = render(COMPACT_BAR_TRANSPORT_BUTTONS);
	assert.match(idle, /--transport-icon-color:#74BE59/u);
	assert.match(idle, /--transport-icon-color:#F08080/u);
	const recording = render(COMPACT_BAR_TRANSPORT_BUTTONS, true, {}, true);
	assert.match(recording, /--transport-icon-color:#FFFFFF/u);
	assert.doesNotMatch(recording, /--transport-icon-color:#F08080/u);
});

test('the playhead format control receives its localized label declaratively', () => {
	const markup = renderToStaticMarkup(<AccessibleTimeCode
		ariaLabel="Wiedergabeposition: Format" value={0} showFormatSelector
	/>);
	assert.match(markup, /aria-label="Wiedergabeposition: Format"/u);
});

test('the playhead displays hours, minutes, seconds, and hundredths by default', () => {
	const markup = renderToStaticMarkup(<TelemetryTimeCode
		controller={{
			getTelemetrySnapshot: () => ({ positionFrame: 0 }),
			subscribeTelemetry: () => () => undefined,
		}}
		copy={ENGLISH_COPY}
		project={{ sampleRate: 48_000 }}
		durationFrames={48_000}
		isCompact={false}
		recording={false}
		run={() => undefined}
	/>);
	assert.match(markup, /class="timecode__separator">\.<\/span>/u);
	assert.equal((markup.match(/class="timecode-digit /gu) || []).length, 8);
});
