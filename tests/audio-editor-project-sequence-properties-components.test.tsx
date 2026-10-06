/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MetadataEditorTabs from '../src/common/editor/ui/MetadataEditorTabs.tsx';
import EditorToolToolbar from '../src/common/editor/ui/toolbar/EditorToolToolbar.jsx';
import { SequenceTimingProjectProperties } from '../src/common/editor/ui/toolbar/SequenceTimingControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

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

test('the sequence name refreshes when the authoritative saved name changes', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderName = (name: string) => <SequenceTimingProjectProperties
		project={{ primarySequenceId: 'primary', sequences: [{ id: 'primary', name, rate, startTimecode, dropFrame: false }] }}
		snapshot={{ readOnly: false, recording: false }} controller={{ actions: {} }} copy={ENGLISH_COPY} run={() => undefined} />;
	try {
		await act(async () => root.render(renderName('Main sequence')));
		const field = dom.one('input');
		await act(async () => reactProps(field).onChange({ currentTarget: { value: 'Changed sequence' } }));
		assert.equal(field.value, 'Changed sequence');
		await act(async () => root.render(renderName('Changed sequence')));
		await act(async () => root.render(renderName('Main sequence')));
		assert.equal(field.value, 'Main sequence');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('frame navigation stays Framescaper-only even with a video workspace preference', () => {
	const project = {
		id: 'project', sampleRate: 48_000, tracks: [], primarySequenceId: 'primary',
		sequences: [{ id: 'primary', name: 'Main timeline', rate, startTimecode, dropFrame: false }],
	};
	const markup = (productId: string): string => render(<EditorToolToolbar
		productId={productId}
		capabilities={{ sequenceTiming: true, audioRecording: false, audioSpectralEditing: false }}
		snapshot={{ productId, project, recording: false, preferences: { workspace: { activeId: 'video-editor', panels: {} } } }}
		controller={{
			getTelemetrySnapshot: () => ({ positionFrame: 0 }),
			subscribeTelemetry: () => () => undefined,
			actions: { video: { sourceTimecodeAtSample: () => null } },
		}}
		copy={ENGLISH_COPY}
		locale="en"
		isCompact={false}
		zoomProject={() => undefined}
		blocked={false}
		durationFrames={0}
		executeEdit={() => undefined}
		recordLabel="Record"
		toggleRecording={() => undefined}
		run={() => undefined}
		transportButtons={['jump-start', 'jump-end']}
		toolbarButtons={{ 'time-display': false, snap: false, 'playback-volume': false,
			'volume-automation': false, 'split-tool': false,
			'zoom-in': false, 'zoom-out': false, 'zoom-fit': false }}
		toolbars={{}}
		editItems={[]}
		uiFlags={{}}
		playbackMeterSettings={{ position: 'panel' }}
		onPlaybackMeterSettingsChange={() => undefined}
		recordingMeterSettings={{ position: 'panel' }}
		onRecordingMeterSettingsChange={() => undefined}
		automationToolEnabled={false}
		onToggleAutomationTool={() => undefined}
		onToggleSplitTool={() => undefined}
		actionRuntime={{}}
		onOpenSpectralSelection={() => undefined}
		onOpenTimedRecording={() => undefined}
		onOpenTakeCycleRecovery={() => undefined}
		onJumpToStart={() => undefined}
		onJumpToEnd={() => undefined}
		onGripperMouseDown={() => undefined}
	/>);
	assert.doesNotMatch(markup('soundscaper'), /data-sequence-step=/u);
	const framescaper = markup('framescaper');
	assert.match(framescaper, /data-sequence-step="previous"/u);
	assert.match(framescaper, /data-sequence-step="next"/u);
});
