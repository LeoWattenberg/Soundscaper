/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import WorkspacePanelDock from '../src/common/editor/ui/workspace/WorkspacePanelDock.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const secondary of [false, true]) test(`the mounted resize retains ${secondary ? 'its first of two pointers' : 'one pointer'}`, async () => {
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
		const begin = async (pointerId: number, clientX: number, isPrimary: boolean) => {
			await act(async () => reactProps(dock).onPointerDownCapture({ target: handle, currentTarget: dock,
				button: 0, pointerId, clientX, clientY: 310, isPrimary, preventDefault() {} }));
		};
		const dispatch = (type: string, pointerId: number, clientX: number) => {
			const event = new Event(type, { cancelable: true });
			Object.defineProperties(event, { pointerId: { value: pointerId }, clientX: { value: clientX }, clientY: { value: 310 } });
			events.dispatchEvent(event);
		};
		await begin(1, 450, true);
		dispatch('pointermove', 1, 460);
		assert.equal(style.width, '370px');
		if (secondary) await begin(2, 460, false);
		dispatch('pointermove', 1, 462);
		assert.equal(style.width, '372px', 'the owning finger can continue after another finger begins');
		if (secondary) {
			dispatch('pointerup', 2, 460);
			assert.equal(saved.length, 0, 'a foreign release cannot publish the active resize');
		}
		dispatch('pointerup', 1, 462);
		assert.equal(saved.length, 1);
		assert.equal(saved[0]!.id, 'history');
		assert.equal(saved[0]!.geometry.width, 372);
		await begin(3, 460, true);
		dispatch('pointermove', 3, 470);
		dispatch('pointerup', 3, 470);
		assert.equal(saved[1]!.geometry.width, 382, 'a subsequent ordinary resize still completes');
	} finally {
		await act(async () => root.unmount());
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
