/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import WorkspacePanelDock from '../src/common/editor/ui/workspace/WorkspacePanelDock.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const buttons of [2, 4]) test(`the mounted workspace resize completes its primary release with buttons ${buttons} remaining`, async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const events = new EventTarget();
	window.addEventListener = events.addEventListener.bind(events);
	window.removeEventListener = events.removeEventListener.bind(events);
	const saved: { id: string; geometry: { width: number; height: number } }[] = [];
	const controller = { actions: { preferences: {
		setPanel(id: string, geometry: { width: number; height: number }) { saved.push({ id, geometry }); },
	} } };
	const snapshot = { productId: 'soundscaper', capabilities: {}, history: {}, preferences: { workspace: {
		panels: { history: { visible: true, dock: 'floating', order: 1, x: 100, y: 100, width: 360, height: 220, size: 220 } },
	} } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<WorkspacePanelDock dock="floating" controller={controller} snapshot={snapshot}
			copy={{ panelHistory: 'History', optionsFor: 'Options: {name}', resizeFor: 'Resize: {name}' }}
			run={(operation: () => unknown) => operation()} locale="en" fileService={undefined}
			confirmFileSizeWarning={undefined} playbackMeterSettings={undefined} showArmControls={false}
			displayAudioSupported={false} onOpenEffects={() => {}} effectsPanelTarget={null}
			onEffectWindowChange={() => {}} draggedPanelId={null} onPanelDragStart={() => {}}
			onPanelDragEnd={() => {}} onPanelMove={() => {}} onTogglePanel={() => {}}
			projectBinEffectivelyOpen={false} blocked={false} />));
		const dock = dom.one('[data-panel-dock]');
		Object.defineProperty(dock, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }) });
		await act(async () => { events.dispatchEvent(new Event('resize')); });
		const panel = dom.one('[data-workspace-panel="history"]');
		const handle = dom.one('.kw-audio-editor__workspace-resize-handle');
		const style = (panel as unknown as HTMLElement).style;
		Object.defineProperty(panel, 'getBoundingClientRect', { value: () => ({ left: 100, top: 100,
			width: parseFloat(style.width), height: parseFloat(style.height),
			right: 100 + parseFloat(style.width), bottom: 100 + parseFloat(style.height) }) });
		const begin = async (pointerId: number, clientX: number) => {
			await act(async () => reactProps(dock).onPointerDownCapture({ target: handle, currentTarget: dock,
				button: 0, pointerId, clientX, clientY: 310, isPrimary: true, preventDefault() {} }));
		};
		const dispatch = (type: string, pointerId: number, clientX: number, button = -1, held = 1, pointerType = 'mouse') => {
			events.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
				pointerId, clientX, clientY: 310, button, buttons: held, pointerType,
			}));
		};
		await begin(1, 450);
		dispatch('pointermove', 1, 460);
		dispatch('pointerup', 1, 460, 0, 0);
		assert.equal(saved[0]!.geometry.width, 370, 'healthy primary completion publishes its ordinary geometry');
		await begin(2, 460);
		dispatch('pointermove', 2, 472);
		assert.equal(style.width, '382px');
		dispatch('pointermove', 3, 472, 0, buttons);
		assert.equal(saved.length, 1, 'another pointer cannot finish the active primary resize');
		dispatch('pointermove', 2, 472, 0, buttons);
		assert.equal(saved.length, 2, 'native primary release is a pointermove while another mouse button remains held');
		assert.equal(saved[1]!.geometry.width, 382);
		dispatch('pointermove', 2, 492, -1, buttons);
		dispatch('pointerup', 2, 492, buttons === 4 ? 1 : 2, 0);
		assert.equal(style.width, '382px', 'later auxiliary movement cannot change the completed resize');
		assert.equal(saved.length, 2);
		await begin(4, 472);
		dispatch('pointermove', 4, 482, -1, 1, 'touch');
		dispatch('pointerup', 4, 482, 0, 0, 'touch');
		assert.equal(saved[2]!.geometry.width, 392, 'a subsequent ordinary touch resize still publishes once');
	} finally {
		await act(async () => root.unmount());
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
