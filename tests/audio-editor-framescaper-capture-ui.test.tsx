/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import type { CapturePhase } from '../src/common/editor/framescaper-capture-domain.ts';
import FramescaperCaptureRecordControl from '../src/common/editor/ui/toolbar/FramescaperCaptureRecordControl.tsx';
import RecordingSetupPanel from '../src/common/editor/ui/workspace/RecordingSetupPanel.tsx';
import { assignCapturePreviewStream } from '../src/common/editor/ui/workspace/FramescaperCaptureSources.tsx';
import {
	FRAMESCAPER_CAPTURE_PANEL_ID,
	capturePrimaryAction,
	framescaperCaptureRecordRequired,
	framescaperCaptureRecordVisible,
	workspacePanelAvailable,
	type FramescaperCaptureUiSnapshot,
} from '../src/common/editor/ui/framescaper-capture-ui-model.ts';
import {
	WORKSPACE_PANEL_IDS,
	workspacePanelLabel,
} from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';

test('recording setup stays retained but has no selected-product panel route', () => {
	assert.equal(FRAMESCAPER_CAPTURE_PANEL_ID, 'recording-setup');
	assert.ok(WORKSPACE_PANEL_IDS.includes(FRAMESCAPER_CAPTURE_PANEL_ID));
	assert.deepEqual(DEFAULT_PANELS[FRAMESCAPER_CAPTURE_PANEL_ID], {
		visible: false, dock: 'bottom', order: 11, size: 420,
	});
	assert.equal(workspacePanelLabel(ENGLISH_COPY, FRAMESCAPER_CAPTURE_PANEL_ID), 'Recording setup');
	assert.equal(workspacePanelAvailable('framescaper', FRAMESCAPER_CAPTURE_PANEL_ID), false);
	assert.equal(workspacePanelAvailable('soundscaper', FRAMESCAPER_CAPTURE_PANEL_ID), false);
});

test('View > Panels exposes no recording setup entry on either selected product', () => {
	const menus = [{
		id: 'view', items: [{
			id: 'panels', items: [
				{ id: 'panel-history', label: 'History' },
				{ id: 'panel-recording-setup', label: 'Recording setup' },
			],
		}],
	}];
	const capabilities = { audioGenerators: true, audioEffects: true, audioAnalysis: true, audioMacros: true, audioRecording: true };
	const soundscaper = filterProductMenus(menus, capabilities, 'soundscaper');
	const framescaper = filterProductMenus(menus, capabilities, 'framescaper');
	assert.equal(findMenuItem(soundscaper, 'panel-recording-setup'), null);
	assert.equal(findMenuItem(framescaper, 'panel-recording-setup'), null);
});

test('record control ignores stale opt-in and survives only historical active or recovery ownership', () => {
	assert.equal(framescaperCaptureRecordVisible('framescaper', capture('inactive'), false), false);
	assert.equal(framescaperCaptureRecordVisible('framescaper', capture('inactive'), true), false);
	assert.equal(framescaperCaptureRecordVisible('framescaper', capture('recording'), false), true);
	assert.equal(framescaperCaptureRecordVisible('framescaper', capture('recovery'), false), true);
	assert.equal(framescaperCaptureRecordVisible('soundscaper', capture('recording'), true), false);
});

test('active media ownership overrides a hidden customized Record slot', () => {
	for (const phase of [
		'permission-pending', 'previewing', 'armed', 'countdown',
		'recording', 'paused', 'finalizing', 'recovery',
	] as const) {
		assert.equal(framescaperCaptureRecordRequired(capture(phase)), true, phase);
	}
	assert.equal(framescaperCaptureRecordRequired(capture('inactive')), false);
});

test('record primary action focuses setup until armed and never implicitly requests media', () => {
	assert.deepEqual(capturePrimaryAction(capture('inactive')), { kind: 'open-setup', disabled: false });
	assert.deepEqual(capturePrimaryAction(capture('previewing')), { kind: 'open-setup', disabled: false });
	assert.deepEqual(capturePrimaryAction(capture('armed')), { kind: 'start', disabled: false });
	assert.deepEqual(capturePrimaryAction(capture('recording')), { kind: 'stop', disabled: false });
	assert.deepEqual(capturePrimaryAction(capture('paused')), { kind: 'stop', disabled: false });
	assert.deepEqual(capturePrimaryAction(capture('finalizing')), { kind: 'finalizing', disabled: true });
	assert.deepEqual(capturePrimaryAction(capture('recovery')), { kind: 'open-setup', disabled: false });
	assert.deepEqual(capturePrimaryAction(capture('inactive', 'unavailable')), { kind: 'open-setup', disabled: false });
});

test('selected route refuses an idle recording setup panel without opening any source', () => {
	const calls: string[] = [];
	const markup = render(<RecordingSetupPanel
		controller={controller(calls)}
		snapshot={{ productId: 'framescaper', capture: capture('inactive', 'unavailable') }}
		copy={ENGLISH_COPY}
		locale="en"
		run={(operation) => operation()}
	/>);

	assert.deepEqual(calls, []);
	assert.doesNotMatch(markup, /data-framescaper-recording-setup/u);
});

test('recording setup presents explicit sources, destinations, capture controls and live status', () => {
	const previewing = render(<RecordingSetupPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', capture: {
			...capture('previewing'),
			requestedRoles: ['camera', 'microphone'],
			sources: [
				{ sourceId: 'camera-1', role: 'camera', label: 'Camera 1', settings: { width: 1920, height: 1080 } },
				{ sourceId: 'mic-1', role: 'microphone', label: 'Microphone 1', level: 0.5 },
			],
		} }}
		copy={ENGLISH_COPY}
		locale="en"
		run={(operation) => operation()}
	/>);
	assert.match(previewing, /<fieldset[^>]*><legend>Sources<\/legend>/u);
	assert.match(previewing, /Camera 1/u);
	assert.match(previewing, /1920 × 1080/u);
	assert.match(previewing, /role="meter"/u);
	assert.match(previewing, /<legend>Destination<\/legend>/u);
	assert.match(previewing, />Arm capture</u);
	assert.match(previewing, />Release sources</u);

	const recording = render(<RecordingSetupPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', capture: {
			...capture('recording'),
			elapsedTimeMs: 65_000,
			metrics: [{ streamId: 'camera-1', role: 'camera', droppedRatio: { value: 0.001, confidence: 'estimated' }, currentDriftUs: { value: 12_000, confidence: 'exact' } }],
		} }}
		copy={ENGLISH_COPY}
		locale="en"
		run={(operation) => operation()}
	/>);
	assert.match(recording, /aria-live="polite"/u);
	assert.match(recording, /01:05/u);
	assert.match(recording, />Pause capture</u);
	assert.match(recording, />Stop and import</u);
	assert.match(recording, /Estimated/u);

	const recovery = render(<RecordingSetupPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', capture: capture('recovery', 'unavailable') }}
		copy={ENGLISH_COPY}
		locale="en"
		run={(operation) => operation()}
	/>);
	for (const label of ['Recover capture', 'Import playable data as-is', 'Delete capture']) {
		assert.match(recovery, new RegExp(`>${label}<`, 'u'));
	}
});

test('recording setup cannot arm or start without a writable destination project', () => {
	const readOnly = render(<RecordingSetupPanel
		controller={controller([])}
		snapshot={{
			productId: 'framescaper', readOnly: true, project: { id: 'project-a' },
			capture: { ...capture('previewing'), requestedRoles: ['camera', 'microphone'] },
		}}
		copy={ENGLISH_COPY} locale="en" run={(operation) => operation()}
	/>);
	assert.match(readOnly, /<button[^>]*disabled=""[^>]*><span[^>]*>Arm capture<\/span><\/button>/u);
	assert.doesNotMatch(
		readOnly,
		/<button[^>]*disabled=""[^>]*><span[^>]*>Release sources<\/span><\/button>/u,
	);

	for (const state of [
		{ readOnly: true, blocked: false, project: { id: 'project-a' } },
		{ readOnly: false, blocked: true, project: { id: 'project-a' } },
		{ readOnly: false, blocked: false, project: undefined },
	] as const) {
		const armed = render(<RecordingSetupPanel
			controller={controller([])} blocked={state.blocked}
			snapshot={{
				productId: 'framescaper', readOnly: state.readOnly, project: state.project,
				capture: capture('armed'),
			}}
			copy={ENGLISH_COPY} locale="en" run={(operation) => operation()}
		/>);
		assert.match(armed, /<button[^>]*disabled=""[^>]*><span[^>]*>Start capture<\/span><\/button>/u);
		assert.doesNotMatch(
			armed,
			/<button[^>]*disabled=""[^>]*><span[^>]*>Release sources<\/span><\/button>/u,
		);
	}

	const active = render(<RecordingSetupPanel
		controller={controller([])}
		blocked
		snapshot={{ productId: 'framescaper', readOnly: true, capture: capture('recording') }}
		copy={ENGLISH_COPY} locale="en" run={(operation) => operation()}
	/>);
	assert.doesNotMatch(active, /<button[^>]*disabled=""[^>]*><span[^>]*>Stop and import<\/span><\/button>/u);
});

test('recording setup recovery follows its frozen origin rather than the active project', () => {
	for (const state of [
		{ readOnly: true, blocked: false, project: { id: 'project-a' } },
		{ readOnly: false, blocked: true, project: { id: 'project-a' } },
		{ readOnly: false, blocked: false, project: undefined },
	] as const) {
		const markup = render(<RecordingSetupPanel
			controller={controller([])}
			blocked={state.blocked}
			snapshot={{
				productId: 'framescaper', readOnly: state.readOnly, project: state.project,
				capture: capture('recovery', 'unavailable'),
			}}
			copy={ENGLISH_COPY} locale="en" run={(operation) => operation()}
		/>);
		for (const label of ['Recover capture', 'Import playable data as-is']) {
			const disabled = new RegExp(
				`<button[^>]*disabled=""[^>]*><span[^>]*>${label}<\\/span><\\/button>`, 'u',
			);
			if (state.blocked) assert.match(markup, disabled);
			else assert.doesNotMatch(markup, disabled);
		}
		assert.doesNotMatch(
			markup,
			/<button[^>]*disabled=""[^>]*><span[^>]*>Delete capture<\/span><\/button>/u,
		);
	}
});

test('recording setup exposes only permission-returned devices and supported source settings', () => {
	const markup = render(<RecordingSetupPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', capture: {
			...capture('previewing'),
			requestedRoles: ['camera', 'microphone'],
			devices: [
				{ id: 'camera-a', kind: 'camera', label: 'Front camera' },
				{ id: 'camera-b', kind: 'camera', label: 'Document camera' },
				{ id: 'microphone-a', kind: 'microphone', label: 'Desk microphone' },
			],
			selectedDeviceIds: { camera: 'camera-a', microphone: 'microphone-a' },
			sources: [
				{
					sourceId: 'camera-track', role: 'camera', label: 'Front camera',
					previewUrl: 'blob:camera-preview',
					settings: { deviceId: 'camera-a', width: 1280, height: 720, frameRate: 30 },
					capabilities: {
						width: { min: 640, max: 1920 }, height: { min: 480, max: 1080 },
						frameRate: { min: 24, max: 60 },
					},
				},
				{
					sourceId: 'microphone-track', role: 'microphone', label: 'Desk microphone', level: 0.375,
					settings: { deviceId: 'microphone-a', sampleRate: 48000, channelCount: 1 },
					capabilities: {
						sampleRate: { min: 44100, max: 96000 }, channelCount: { min: 1, max: 2 },
					},
				},
			],
		} }}
		copy={ENGLISH_COPY}
		locale="en"
		run={(operation) => operation()}
	/>);

	assert.match(markup, /<select[^>]*aria-label="Camera device"/u);
	assert.match(markup, /Document camera/u);
	assert.match(markup, /<select[^>]*aria-label="Microphone device"/u);
	assert.match(markup, /src="blob:camera-preview"/u);
	assert.match(markup, />Resolution</u);
	assert.match(markup, />Frame rate</u);
	assert.match(markup, />Sample rate</u);
	assert.match(markup, />Channels</u);
	assert.match(markup, /aria-valuetext="38%"/u);
	assert.doesNotMatch(markup, /System or tab audio device/u);
});

test('desktop screen inventory requires an explicit pathless source choice', () => {
	const calls: string[] = [];
	const markup = render(<RecordingSetupPanel
		controller={controller(calls)}
		snapshot={{ productId: 'framescaper', capture: {
			...capture('permission-pending'),
			availability: { status: 'available', sourceRoles: ['display'] },
			displaySelectionMode: 'source-list',
			displaySources: [
				{ token: 'opaque-screen', name: 'Main screen', kind: 'screen' },
				{ token: 'opaque-window', name: 'Slides', kind: 'window' },
			],
			selectedDisplaySourceToken: null,
		} }}
		copy={ENGLISH_COPY} locale="en" run={(operation) => operation()}
	/>);

	assert.deepEqual(calls, []);
	assert.match(markup, /aria-label="Screen or window source"/u);
	assert.match(markup, /Select a screen or window/u);
	assert.match(markup, /Main screen · Screen/u);
	assert.match(markup, /Slides · Window/u);
	assert.match(markup, /Choose a screen or window/u);
	assert.match(markup, /<button[^>]*disabled=""[^>]*>.*Preview sources.*<\/button>/u);
});

test('live preview stream cleanup never clears a replacement stream', () => {
	const element: { srcObject: unknown } = { srcObject: null };
	const first = { id: 'first' };
	const second = { id: 'second' };
	const cleanupFirst = assignCapturePreviewStream(element as Pick<HTMLVideoElement, 'srcObject'>, first);
	assert.equal(element.srcObject, first);
	element.srcObject = second;
	cleanupFirst();
	assert.equal(element.srcObject, second);
	const cleanupSecond = assignCapturePreviewStream(element as Pick<HTMLVideoElement, 'srcObject'>, second);
	cleanupSecond();
	assert.equal(element.srcObject, null);
});

test('Framescaper record split control exposes phase-correct accessible actions', () => {
	const armed = render(<FramescaperCaptureRecordControl
		controller={controller([])} snapshot={{ capture: capture('armed') }} copy={ENGLISH_COPY}
		run={(operation) => operation()} blocked={false}
	/>);
	assert.match(armed, /data-transport="framescaper-record"/u);
	assert.match(armed, /aria-label="Start capture"/u);
	assert.match(armed, /aria-label="Capture options"/u);

	const active = render(<FramescaperCaptureRecordControl
		controller={controller([])} snapshot={{ capture: capture('recording') }} copy={ENGLISH_COPY}
		run={(operation) => operation()} blocked={false}
	/>);
	assert.match(active, /aria-label="Stop and import"/u);
	assert.match(active, /data-capture-active="true"/u);
});

test('Framescaper record control gates starts by the active project and recovery by its origin', () => {
	for (const policy of [
		{ readOnly: true, blocked: false },
		{ readOnly: false, blocked: true },
	] as const) {
		const armed = inspectRecordControl(capture('armed'), policy);
		assert.equal(armed.primaryDisabled, true);
		assert.equal(armed.menuDisabled.get('Start capture'), true);

		const recovery = inspectRecordControl(capture('recovery'), policy);
		assert.equal(recovery.menuDisabled.get('Recover capture'), policy.blocked);
		assert.equal(recovery.menuDisabled.get('Import playable data as-is'), policy.blocked);
		assert.equal(recovery.menuDisabled.get('Delete capture'), false);
	}
});

function capture(
	phase: CapturePhase,
	availabilityStatus: 'available' | 'unavailable' = 'available',
): FramescaperCaptureUiSnapshot {
	return {
		phase,
		availability: availabilityStatus === 'available'
			? { status: 'available', sourceRoles: ['camera', 'microphone', 'display', 'system-audio'] as const }
			: { status: 'unavailable', reason: 'embedded-route', detail: 'Embedded capture is disabled.' },
		requestedRoles: [], sources: [], sourcesFrozen: phase !== 'inactive', destination: null,
		countdownMs: null, permissionRequestGeneration: null, failure: null,
	};
}

function controller(calls: string[]) {
	const captureActions = new Proxy({}, {
		get: (_target, property) => (..._args: unknown[]) => calls.push(String(property)),
	});
	return {
		actions: {
			capture: captureActions,
			preferences: { setPanel: () => calls.push('setPanel') },
		},
	};
}

function inspectRecordControl(
	captureSnapshot: FramescaperCaptureUiSnapshot,
	policy: Readonly<{ readOnly: boolean; blocked: boolean }>,
): Readonly<{ primaryDisabled: boolean; menuDisabled: ReadonlyMap<string, boolean> }> {
	const tree = FramescaperCaptureRecordControl({
		controller: controller([]),
		snapshot: { capture: captureSnapshot, readOnly: policy.readOnly },
		copy: ENGLISH_COPY,
		blocked: policy.blocked,
		run: (operation) => operation(),
	});
	assert.ok(React.isValidElement<{ readonly children: React.ReactNode }>(tree));
	const split = React.Children.only(tree.props.children);
	assert.ok(React.isValidElement<{
		readonly disabled?: boolean;
		readonly children: (controls: Readonly<{ close(): void }>) => React.ReactNode;
	}>(split));
	const menu = split.props.children({ close: () => undefined });
	const menuDisabled = new Map<string, boolean>();
	visitMenuElements(menu, menuDisabled);
	return { primaryDisabled: Boolean(split.props.disabled), menuDisabled };
}

function visitMenuElements(node: React.ReactNode, disabledByLabel: Map<string, boolean>): void {
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<{
			readonly label?: unknown;
			readonly disabled?: boolean;
			readonly children?: React.ReactNode;
		}>(child)) return;
		if (typeof child.props.label === 'string') {
			disabledByLabel.set(child.props.label, Boolean(child.props.disabled));
		}
		visitMenuElements(child.props.children, disabledByLabel);
	});
}

interface MenuItem {
	readonly id?: string;
	readonly items?: readonly MenuItem[];
}

function findMenuItem(values: unknown, id: string): MenuItem | null {
	for (const item of values as readonly MenuItem[]) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function render(node: React.ReactNode): string {
	return renderToStaticMarkup(<div id="kw-audio-editor-design-system">{node}</div>);
}
