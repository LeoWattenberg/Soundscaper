/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelDock from '../src/common/editor/ui/workspace/WorkspacePanelDock.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const dock of ['left', 'right', 'top', 'bottom', 'floating']) {
	for (const modified of [true, false]) {
		test(`${dock} workspace geometry preserves ${modified ? 'modified commands' : 'plain and accelerated editing'}`, async () => {
			const dom = installReactTestDom();
			const root = createRoot(dom.container as unknown as HTMLElement);
			const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
			const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
			actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
			Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
			Object.defineProperty(window, 'getComputedStyle', { value: () => ({ direction: 'ltr', display: '', visibility: '' }) });
			Object.defineProperty(window, 'innerWidth', { value: 1000 });
			dom.container.getBoundingClientRect = () => ({ width: 1000, height: 800 });
			const edits: Readonly<Record<string, number>>[] = [];
			const moves: string[] = [];
			const preferences = {
				setPanel(_id: string, geometry: Readonly<Record<string, number>>) { edits.push(geometry); },
				setPanelDockExtent(_dock: string, geometry: Readonly<Record<string, number>>) { edits.push(geometry); },
				setPanelFrameSize() {}, activatePanelTab() {},
			};
			const noop = (): void => undefined;
			try {
				await act(async () => { root.render(<WorkspacePanelDock dock={dock}
					controller={{ actions: { preferences, edit: { undo: noop, redo: noop } } }}
					snapshot={{ productId: 'soundscaper', capabilities: {}, project: { sampleRate: 48000, tracks: [] }, history: {},
						preferences: { workspace: { panels: { history: { visible: true, dock, order: 0,
							size: 320, width: 400, height: 320, x: 100, y: 100 }, labels: { visible: dock === 'floating', dock, order: 1,
								size: 320, width: 400, height: 320, x: 500, y: 100 } } } } }}
					copy={ENGLISH_COPY} locale="en" fileService={null} confirmFileSizeWarning={undefined}
					playbackMeterSettings={undefined} run={(operation: () => unknown) => operation()}
					showArmControls={false} displayAudioSupported={false} onOpenEffects={noop}
					effectsPanelTarget={null} onEffectWindowChange={noop} draggedPanelId={null}
					onPanelDragStart={noop} onPanelDragEnd={noop} onPanelMove={(id: string) => { moves.push(id); }}
					onTogglePanel={noop} projectBinEffectivelyOpen={false} blocked={false} />); });
				const element = dom.one(`[data-panel-dock="${dock}"]`);
				element.getBoundingClientRect = () => ({ width: dock === 'floating' ? 1000 : 400, height: dock === 'floating' ? 800 : 320 });
				const handles = dock === 'floating'
					? [dom.one('[data-floating-panel-resize-handle="history"]'), dom.one('[data-workspace-panel-drag-handle="history"]')]
					: [dom.one(`[data-workspace-dock-resize-handle="${dock}"]`)];
				const key = dock === 'left' || dock === 'right' ? 'ArrowRight' : 'ArrowDown';
				for (const handle of handles) {
					for (const modifier of modified ? ['ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'] : ['plain', 'shiftKey']) {
						edits.length = 0; moves.length = 0; let prevented = false; handle.focus();
						await act(async () => { reactProps(handle).onKeyDown?.({ key, currentTarget: handle,
							ctrlKey: modifier === 'ctrlKey', altKey: modifier === 'altKey', metaKey: modifier === 'metaKey',
							defaultPrevented: modifier === 'defaultPrevented', shiftKey: modifier === 'shiftKey',
							preventDefault() { prevented = true; } }); });
						assert.equal(prevented, !modified, modifier);
						assert.equal(edits.length, modified ? 0 : 1, modifier);
						assert.deepEqual(moves, [], modifier);
						assert.equal(document.activeElement, handle);
						if (!modified) {
							const step = modifier === 'shiftKey' ? 48 : 16;
							const expected = dock === 'left' ? { width: 400 + step } : dock === 'right' ? { width: 400 - step }
								: dock === 'top' ? { size: 320 + step } : dock === 'bottom' ? { size: 320 - step }
									: handle === handles[0] ? { x: 100, y: 100, width: 400, height: 320 + step }
										: { x: 100, y: 100 + step, width: 400, height: 320 };
							assert.deepEqual(edits[0], expected);
						}
					}
				}
			} finally {
				await act(async () => { root.unmount(); });
				if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
				dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			}
		});
	}
}
