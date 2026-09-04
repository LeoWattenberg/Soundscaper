/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import EditorHelpTooltip from '../src/common/editor/ui/EditorHelpTooltip.tsx';
import SoundActivationPreferences from '../src/common/editor/ui/SoundActivationPreferences.tsx';
import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type {
	SoundActivationPolicySnapshot,
} from '../src/common/editor/controller/sound-activation-policy-service.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

// An effect dialog states its effect once, in the title bar, and says nothing
// about how effects work in general: that prose was never about this dialog.
test('the selection effect dialog carries no standing prose beside its parameters', async () => {
	const mounted = await mount(<SelectionEffectsDialog
		isOpen
		controller={effectController()}
		snapshot={effectSnapshot()}
		copy={ENGLISH_COPY}
		fileService={null}
		onClose={() => undefined}
	/>);
	try {
		const panel = mounted.dom.one('[data-audacity-effect-panel]');
		assert.equal(panel.querySelectorAll('.audio-editor-panel-hint').length, 0);
		assert.equal(panel.querySelectorAll('[data-audacity-effect-hint]').length, 0);
		const headings = panel.querySelectorAll('h3').map(({ textContent }) => textContent);
		assert.equal(headings.includes(ENGLISH_COPY.audacityAmplify), false,
			'the dialog header already names the effect.');
		const prose = mounted.dom.container.querySelectorAll('p').map(({ textContent }) => textContent);
		assert.equal(prose.includes(ENGLISH_COPY.audacitySelectionHint), false);
	} finally {
		await mounted.cleanup();
	}
});

// A slider explains itself through its own help affordance, so the description
// stays reachable without occupying a line under every control.
test('sound activation parameters describe themselves through help tooltips', async () => {
	const mounted = await mount(<SoundActivationPreferences
		productId="soundscaper"
		locale="en"
		readOnly={false}
		soundActivation={soundActivationPolicy()}
		copy={ENGLISH_COPY}
		controller={soundActivationController()}
		run={(operation: () => unknown) => operation()}
	/>);
	try {
		const container = mounted.dom.container;
		assert.equal(container.querySelectorAll('small').length, 0);
		for (const [hook, description] of [
			['sound-activation', ENGLISH_COPY.soundActivationDescription],
			['sound-activation-threshold', ENGLISH_COPY.soundActivationThresholdDescription],
			['sound-activation-hysteresis', ENGLISH_COPY.soundActivationHysteresisDescription],
			['sound-activation-hold', ENGLISH_COPY.soundActivationHoldDescription],
		] as const) {
			const trigger = container.querySelector(`[data-editor-help="${hook}"]`);
			assert.ok(trigger, `Missing help trigger ${hook}.`);
			const describedBy = trigger.getAttribute('aria-describedby');
			assert.ok(describedBy, `Help trigger ${hook} must point at its description.`);
			const target = container.querySelector(`[id="${describedBy}"]`);
			assert.ok(target, `Missing description for ${hook}.`);
			assert.equal(target.textContent, description);
			assert.equal(target.getAttribute('class'), 'kw-audio-editor-sr-only');
		}
		const prose = container.querySelectorAll('p').map(({ textContent }) => textContent);
		assert.equal(prose.includes(ENGLISH_COPY.soundActivationDescription), false);
	} finally {
		await mounted.cleanup();
	}
});

// The trigger commonly sits inside the label of the control it explains, and a
// label forwards its clicks, so asking for help must not also flip the setting.
test('pressing a help trigger inside a label does not activate that label', async () => {
	const mounted = await mount(<EditorHelpTooltip
		subject="Activation threshold"
		description="Capture begins at or above this input level."
		helpLabel="Help"
		hook="threshold"
	/>);
	try {
		const trigger = mounted.dom.one('[data-editor-help="threshold"]');
		let defaultPrevented = false;
		let propagationStopped = false;
		await act(async () => {
			reactProps(trigger).onClick({
				currentTarget: trigger,
				preventDefault: () => { defaultPrevented = true; },
				stopPropagation: () => { propagationStopped = true; },
			});
			await Promise.resolve();
		});
		assert.equal(defaultPrevented, true);
		assert.equal(propagationStopped, true);
	} finally {
		await mounted.cleanup();
	}
});

async function mount(element: React.ReactElement) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(element));
	return {
		dom,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function effectController() {
	return {
		project: { id: 'help-tooltips' },
		actions: {
			effects: {
				setSelectionParams: () => undefined,
				setControlTrack: () => undefined,
				cancelPreview: () => undefined,
				previewSelection: () => undefined,
				captureNoiseProfile: () => undefined,
				applySelection: () => undefined,
				presets: {
					apply: () => undefined,
					save: () => undefined,
					import: () => undefined,
					export: () => '',
					delete: () => undefined,
				},
			},
		},
	};
}

function effectSnapshot() {
	return {
		ready: true,
		project: {
			id: 'help-tooltips',
			sampleRate: 48_000,
			clips: [],
			tracks: [{ id: 'audio', type: 'audio', name: 'Audio', clipIds: [] }],
		},
		selectedTrackId: 'audio',
		effects: {
			selectionType: 'audacity-amplify',
			selectionParams: { gainDb: 0, allowClipping: false },
			controlTrackId: null,
			presets: [],
			previewing: false,
			noiseProfileReady: false,
		},
	};
}

function soundActivationPolicy(): SoundActivationPolicySnapshot {
	return Object.freeze({
		preferences: Object.freeze({
			enabled: false,
			thresholdDb: -40,
			hysteresisDb: 6,
			holdMilliseconds: 250,
		}),
		preferenceMutationBlocked: false,
		preferenceMutationBlockReason: null,
		sources: Object.freeze([]),
	});
}

function soundActivationController() {
	return {
		actions: {
			recording: {
				soundActivation: {
					setEnabled: () => undefined,
					setThresholdDb: () => undefined,
					setHysteresisDb: () => undefined,
					setHoldMilliseconds: () => undefined,
				},
			},
		},
	};
}
