/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import SoundActivationSettings from '../src/common/editor/ui/SoundActivationSettings.tsx';
import RecordFlyout from '../src/common/editor/ui/toolbar/RecordFlyout.jsx';
import type { SoundActivationPolicySnapshot } from '../src/common/editor/controller/recording/sound-activation-policy-service.ts';

test('Soundscaper renders three accessible sound activation settings over the public snapshot', () => {
	const markup = render(false, policy());

	assert.match(markup, /data-sound-activation-settings="true"/u);
	assert.match(markup, /data-sound-activation-threshold-db="-40"/u);
	assert.match(markup, /data-sound-activation-hysteresis-db="6"/u);
	assert.match(markup, /data-sound-activation-hold-milliseconds="250"/u);
	assert.doesNotMatch(markup, /role="switch"/u);
	assert.match(markup, /type="range"[^>]+data-sound-activation-threshold="true"/u);
	assert.match(markup, /aria-label="Activation threshold"/u);
	assert.match(markup, /aria-valuetext="-40 dB"/u);
	assert.match(markup, /aria-label="Release hysteresis"/u);
	assert.match(markup, /aria-valuetext="6 dB"/u);
	assert.match(markup, /aria-label="Hold after silence"/u);
	assert.match(markup, /aria-description="250 ms"/u);
	assert.match(markup, /role="status"[^>]+aria-live="polite"/u);
	assert.doesNotMatch(markup, /Sound-activated recording is off/u);
});

test('guarded sound activation controls are disabled and expose the exact active reason', () => {
	const markup = render(false, policy('recording-active'));

	assert.match(markup, /data-sound-activation-block-reason="recording-active"/u);
	assert.match(markup, /Recording is active/u);
	assert.equal((markup.match(/ disabled=""/gu) || []).length, 3);
	assert.match(markup, /aria-disabled="true"/u);
});

test('Framescaper never renders the Soundscaper activation settings', () => {
	assert.equal(render(false, policy(), 'framescaper'), '');
});

test('record flyout includes real Soundscaper actions and omits them for Framescaper', () => {
	const soundscaper = renderRecordFlyout('soundscaper');
	assert.match(soundscaper, /Sound-activated recording/u);
	assert.match(soundscaper, /aria-label="Sound activation"/u);
	const framescaper = renderRecordFlyout('framescaper');
	assert.doesNotMatch(framescaper, /Sound-activated recording/u);
	assert.doesNotMatch(framescaper, /Sound activation settings/u);
});

test('record flyout omits controls moved to the toolbar, audio setup, and preferences', () => {
	const markup = renderRecordFlyout('soundscaper');
	assert.match(markup, /Record to new track/u);
	assert.match(markup, /Timed recording/u);
	assert.match(markup, /Lead-in time/u);
	assert.match(markup, /Monitor input/u);
	assert.doesNotMatch(markup, />Stop</u);
	assert.doesNotMatch(markup, /Pause recording/u);
	assert.doesNotMatch(markup, /Refresh devices/u);
	assert.doesNotMatch(markup, /Recording offset/u);
});

function render(
	readOnly: boolean,
	soundActivation: SoundActivationPolicySnapshot,
	productId = 'soundscaper',
): string {
	const action = () => undefined;
	return renderToStaticMarkup(React.createElement(SoundActivationSettings, {
		productId,
		locale: 'en',
		readOnly,
		soundActivation,
		copy: ENGLISH_COPY,
		controller: { actions: { recording: { soundActivation: {
			setThresholdDb: action,
			setHysteresisDb: action,
			setHoldMilliseconds: action,
		} } } },
		run: (operation: () => unknown) => operation(),
	}));
}

function policy(
	reason: SoundActivationPolicySnapshot['preferenceMutationBlockReason'] = null,
): SoundActivationPolicySnapshot {
	return Object.freeze({
		preferences: Object.freeze({
			enabled: false,
			thresholdDb: -40,
			hysteresisDb: 6,
			holdMilliseconds: 250,
		}),
		preferenceMutationBlocked: reason !== null,
		preferenceMutationBlockReason: reason,
		sources: Object.freeze([]),
	});
}

function renderRecordFlyout(
	productId: string,
): string {
	const action = () => undefined;
	const runtimeGlobal = globalThis as typeof globalThis & { React?: typeof React };
	const priorReact = Object.getOwnPropertyDescriptor(runtimeGlobal, 'React');
	runtimeGlobal.React = React;
	const element = React.createElement(RecordFlyout, {
		copy: ENGLISH_COPY,
		snapshot: {
			productId,
			preferences: {},
			readOnly: false,
			recording: false,
			recordingStarting: false,
			recordingScheduling: false,
			scheduledRecording: null,
			transportState: 'stopped',
			recordingOptions: { paused: false, leadIn: false },
			recordingInputs: { hasOpenInputs: false, soundActivation: policy() },
			monitor: { enabled: false },
		},
		controller: { actions: { recording: {
			startNewTrack: action,
			startSoundActivated: action,
			setMonitoring: action,
			toggleLeadIn: action,
		} } },
		run: (operation: () => unknown) => operation(),
		onOpenTimedRecording: action,
		onClose: action,
	});
	try {
		return renderToStaticMarkup(element);
	} finally {
		if (priorReact) Object.defineProperty(runtimeGlobal, 'React', priorReact);
		else Reflect.deleteProperty(runtimeGlobal, 'React');
	}
}
