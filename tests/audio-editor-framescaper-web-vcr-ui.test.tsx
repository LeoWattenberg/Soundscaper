/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { workspacePanelAvailable } from '../src/common/editor/ui/framescaper-capture-ui-model.ts';
import FramescaperCaptureRecordControl, {
	framescaperCaptureRecordControlVisible,
} from '../src/common/editor/ui/toolbar/FramescaperCaptureRecordControl.tsx';
import {
	WEB_VCR_PANEL_ID,
	adjustWebVcrCropFromKeyboard,
	type WebVcrUiSnapshot,
} from '../src/common/editor/ui/web-vcr-ui-model.ts';
import WebVcrPanel from '../src/common/editor/ui/workspace/WebVcrPanel.tsx';
import {
	normalizeWebVcrPreviewPoint,
	webVcrPreviewKeyDisposition,
} from '../src/common/editor/ui/workspace/WebVcrPreview.tsx';
import {
	WORKSPACE_DISCOVERABLE_PANEL_IDS,
	WORKSPACE_PANEL_IDS,
	workspacePanelLabel,
} from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';

test('Web VCR is renderable but summon-only and hidden by default', () => {
	assert.ok(WORKSPACE_PANEL_IDS.includes(WEB_VCR_PANEL_ID));
	assert.ok(!WORKSPACE_DISCOVERABLE_PANEL_IDS.includes(WEB_VCR_PANEL_ID));
	assert.deepEqual(DEFAULT_PANELS[WEB_VCR_PANEL_ID], {
		visible: false, dock: 'bottom', order: 12, size: 640,
	});
	assert.equal(workspacePanelLabel(ENGLISH_COPY, WEB_VCR_PANEL_ID), 'Web VCR');
	assert.equal(workspacePanelAvailable('soundscaper', WEB_VCR_PANEL_ID, webVcr()), false);
	assert.equal(workspacePanelAvailable('framescaper', WEB_VCR_PANEL_ID, webVcr({
		capability: { status: 'unavailable', reason: 'roadmap-gate' },
	})), false);
	assert.equal(workspacePanelAvailable('framescaper', 'recording-setup', webVcr({
		modeActive: true,
	})), false);

	const menus = [{
		id: 'view', items: [{
			id: 'panels', items: [
				{ id: 'panel-history', label: 'History' },
				{ id: 'panel-web-vcr', label: 'Web VCR' },
			],
		}],
	}];
	const capabilities = {
		audioGenerators: true, audioEffects: true, audioAnalysis: true,
		audioMacros: true, audioRecording: true,
	};
	assert.equal(findMenuItem(filterProductMenus(menus, capabilities, 'framescaper'), 'panel-web-vcr'), null);
});

test('Record options expose Web VCR only when available and activate it with one action', () => {
	const unavailable = inspectRecordControl(webVcr({ capability: {
		status: 'unavailable', reason: 'roadmap-gate',
	} }));
	assert.equal(unavailable.menuItems.has('Web VCR'), false);

	const calls: string[] = [];
	const available = inspectRecordControl(webVcr(), calls);
	assert.equal(available.menuItems.has('Web VCR'), true);
	available.menuItems.get('Web VCR')?.onClick?.();
	assert.deepEqual(calls, ['activate']);
});

test('a stale available Web VCR cannot reveal a Record entry on the selected Framescaper profile', () => {
	const capture = { phase: 'inactive' } as const;
	assert.equal(framescaperCaptureRecordControlVisible({
		productId: 'framescaper', capture, webVcr: webVcr(),
	}, false), false);
	assert.equal(framescaperCaptureRecordControlVisible({
		productId: 'framescaper', capture, webVcr: webVcr({
			capability: { status: 'unavailable', reason: 'roadmap-gate' },
		}),
	}, false), false);
	assert.equal(framescaperCaptureRecordControlVisible({
		productId: 'soundscaper', capture, webVcr: webVcr(),
	}, false), false);
	assert.equal(framescaperCaptureRecordControlVisible({
		productId: 'framescaper', capture, webVcr: webVcr(),
	}, true), true, 'the existing Recording Setup opt-in reveals Record');
	assert.equal(framescaperCaptureRecordControlVisible({
		productId: 'framescaper', capture: { phase: 'recovery' }, webVcr: webVcr(),
	}, false), true, 'recovery remains reachable without a surviving local preference');
});

test('primary Record action follows the active Web VCR lifecycle and never offers pause', () => {
	const readyCalls: string[] = [];
	const ready = inspectRecordControl(webVcr({ modeActive: true, phase: 'ready' }), readyCalls);
	assert.equal(ready.primaryLabel, 'Record web capture');
	ready.onPrimary?.();
	assert.deepEqual(readyCalls, ['record']);
	assert.equal(ready.menuItems.has('Pause capture'), false);

	const recordingCalls: string[] = [];
	const recording = inspectRecordControl(webVcr({ modeActive: true, phase: 'recording' }), recordingCalls);
	assert.equal(recording.primaryLabel, 'Stop and import');
	recording.onPrimary?.();
	assert.deepEqual(recordingCalls, ['stopAndImport']);
	assert.equal(recording.primaryDisabled, false);

	const loading = inspectRecordControl(webVcr({ modeActive: true, navigation: {
		url: 'https://example.test/', canGoBack: false, canGoForward: false, loading: true, generation: 2,
	} }));
	assert.equal(loading.primaryDisabled, true);
	assert.equal(loading.menuItems.get('Record web capture')?.disabled, true);
});

test('Web VCR panel presents supported defaults, browser controls and capture dimensions', () => {
	const markup = render(<WebVcrPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', webVcr: webVcr({
			navigation: {
				url: 'https://example.test/watch', canGoBack: true, canGoForward: false,
				loading: false, generation: 4,
			},
			surface: { width: 1920, height: 1080 },
			output: { width: 1280, height: 720 },
			intrinsic: { width: 1280, height: 720 },
			lowerResolutionWarning: true,
		}) }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		blocked={false}
	/>);

	assert.match(markup, /data-framescaper-web-vcr="true"/u);
	assert.match(markup, /aria-label="Back"/u);
	assert.match(markup, /aria-label="Forward"[^>]*disabled=""/u);
	assert.match(markup, /aria-label="HTTPS address"[^>]*value="https:\/\/example\.test\/watch"/u);
	assert.match(markup, /role="application"[^>]*aria-label="Interact with web page"/u);
	assert.match(markup, /<option value="1080p" selected="">1080p<\/option>/u);
	assert.match(markup, /<input[^>]*type="checkbox"[^>]*checked=""[^>]*>.*Auto-crop/u);
	assert.match(markup, /<option value="free" selected="">Free<\/option>/u);
	assert.match(markup, /aria-label="Crop aspect"[^>]*disabled=""/u);
	assert.match(markup, />Record web capture</u);
	assert.match(markup, /Surface.*1920 × 1080/us);
	assert.match(markup, /Output.*1280 × 720/us);
	assert.match(markup, /Source.*1280 × 720/us);
	assert.match(markup, /Source resolution is lower than the capture surface/u);
});

test('scaled preview input maps and clamps panel coordinates to the guest surface', () => {
	const bounds = { left: 100, top: 50, width: 800, height: 450 };
	assert.deepEqual(normalizeWebVcrPreviewPoint(bounds, { x: 500, y: 275 }), { x: 0.5, y: 0.5 });
	assert.deepEqual(normalizeWebVcrPreviewPoint(bounds, { x: -10, y: 900 }), { x: 0, y: 1 });
});

test('preview keyboard forwarding reserves focus escape and native tab navigation', () => {
	assert.equal(webVcrPreviewKeyDisposition('Escape'), 'release-focus');
	assert.equal(webVcrPreviewKeyDisposition('Tab'), 'local-navigation');
	assert.equal(webVcrPreviewKeyDisposition('a'), 'forward');
});

test('recording locks browser, resolution and crop controls but preserves Stop and import', () => {
	const markup = render(<WebVcrPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', readOnly: true, webVcr: webVcr({
			phase: 'recording', modeActive: true, autoCrop: false,
			surface: { width: 1920, height: 1080 },
		}) }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		blocked
	/>);

	for (const label of ['Back', 'Forward', 'Reload', 'Move crop area', 'Resize crop from top left']) {
		assert.match(markup, new RegExp(`aria-label="${label}"[^>]*disabled=""`, 'u'));
	}
	assert.match(markup, /<div class="kw-web-vcr__crop kw-web-vcr__crop--manual"/u);
	assert.match(markup, /<button[^>]*kw-web-vcr__crop-handle--move/u);
	assert.match(markup, /aria-label="HTTPS address"[^>]*disabled=""/u);
	assert.match(markup, /aria-label="Capture resolution"[^>]*disabled=""/u);
	assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*>Stop and import<\/button>/u);
	assert.match(markup, /<button[^>]*>Stop and import<\/button>/u);
});

test('recovery import remains reachable with no writable active project', () => {
	const markup = render(<WebVcrPanel
		controller={controller([])}
		snapshot={{ productId: 'framescaper', readOnly: true,
			webVcr: webVcr({ phase: 'recovery' }), capture: { phase: 'recovery' } }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
	/>);
	assert.match(markup, />Import playable data as-is<\/button>/u);
	assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*>Import playable data as-is<\/button>/u);
});

test('crop keyboard editing uses one or ten surface pixels and preserves aspect lock', () => {
	const surface = { width: 1920, height: 1080 };
	const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
	assert.deepEqual(
		adjustWebVcrCropFromKeyboard(crop, 'move', 'ArrowRight', false, surface, 'free'),
		{ ...crop, x: 0.25 + (1 / 1920) },
	);
	assert.deepEqual(
		adjustWebVcrCropFromKeyboard(crop, 'move', 'ArrowDown', true, surface, 'free'),
		{ ...crop, y: 0.25 + (10 / 1080) },
	);
	const resized = adjustWebVcrCropFromKeyboard(
		crop, 'bottom-right', 'ArrowRight', false, surface, '16:9',
	);
	assert.ok(resized);
	assert.ok(Math.abs((resized.width * surface.width) / (resized.height * surface.height) - (16 / 9)) < 1e-9);
});

function webVcr(overrides: Partial<WebVcrUiSnapshot> = {}): WebVcrUiSnapshot {
	return {
		capability: { status: 'available', reason: null },
		phase: 'ready',
		modeActive: false,
		navigation: {
			url: 'https://', canGoBack: false, canGoForward: false, loading: false, generation: 1,
		},
		resolution: '1080p',
		availableResolutions: ['720p', '1080p'],
		autoCrop: true,
		aspect: 'free',
		crop: { x: 0, y: 0, width: 1, height: 1 },
		monitorMuted: false,
		autoStop: false,
		surface: null,
		output: null,
		intrinsic: null,
		target: null,
		lowerResolutionWarning: false,
		error: null,
		...overrides,
	};
}

function controller(calls: string[]) {
	const actions = new Proxy({}, {
		get: (_target, property) => (..._args: unknown[]) => calls.push(String(property)),
	});
	return {
		actions: {
			capture: actions,
			preferences: { setPanelVisibility: () => calls.push('setPanelVisibility') },
			webVcr: actions,
		},
	};
}

function inspectRecordControl(snapshot: WebVcrUiSnapshot, calls: string[] = []) {
	const tree = FramescaperCaptureRecordControl({
		controller: controller(calls),
		snapshot: {
			capture: {
				phase: 'armed', availability: { status: 'available', sourceRoles: [] },
				requestedRoles: [], sources: [], destination: 'both', countdownMs: 0,
			},
			webVcr: snapshot,
		},
		copy: ENGLISH_COPY,
		blocked: false,
		run: (operation) => operation(),
	});
	assert.ok(React.isValidElement<{ readonly children: React.ReactNode }>(tree));
	const split = React.Children.only(tree.props.children);
	assert.ok(React.isValidElement<{
		readonly 'ariaLabel'?: string;
		readonly disabled?: boolean;
		readonly onClick?: () => void;
		readonly children: (controls: Readonly<{ close(): void }>) => React.ReactNode;
	}>(split));
	const menu = split.props.children({ close: () => undefined });
	const menuItems = new Map<string, Readonly<{ onClick?: () => void; disabled?: boolean }>>();
	visitMenuElements(menu, menuItems);
	return {
		menuItems,
		onPrimary: split.props.onClick,
		primaryDisabled: Boolean(split.props.disabled),
		primaryLabel: split.props.ariaLabel,
	};
}

function visitMenuElements(
	node: React.ReactNode,
	items: Map<string, Readonly<{ onClick?: () => void; disabled?: boolean }>>,
): void {
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<{
			readonly label?: unknown;
			readonly onClick?: () => void;
			readonly disabled?: boolean;
			readonly children?: React.ReactNode;
		}>(child)) return;
		if (typeof child.props.label === 'string') items.set(child.props.label, child.props);
		visitMenuElements(child.props.children, items);
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
