/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';

import { ShortcutEditorRow } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { useWorkspaceMouseShortcuts } from '../src/common/editor/ui/workspace/useWorkspaceMouseShortcuts.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import type { ReactTestDom } from './helpers/react-test-dom.ts';

interface HarnessProps {
	readonly bindings?: readonly string[];
	readonly modal?: boolean;
	readonly disabledField?: boolean;
}

interface WorkspaceFixture {
	readonly dom: ReactTestDom;
	calls(): number;
	render(props?: HarnessProps): Promise<void>;
	clear(): Promise<void>;
	dispatch(name: string, event: ReturnType<typeof mouseEvent>): Promise<void>;
}

test('a modified mouse press still cancels release after the modifier is released', async () => {
	await withWorkspace(async (workspace) => {
		const target = workspace.dom.one('[data-timeline]');
		const pointer = mouseEvent(target, 3, { ctrlKey: true });
		await workspace.dispatch('onPointerDownCapture', pointer);
		assert.deepEqual([pointer.prevented, pointer.stopped, workspace.calls()], [0, 1, 0]);
		const down = mouseEvent(target, 3, { ctrlKey: true });
		await workspace.dispatch('onMouseDownCapture', down);
		assert.deepEqual([down.prevented, down.stopped, workspace.calls()], [1, 1, 1]);
		const release = mouseEvent(target, 3);
		await workspace.dispatch('onMouseUpCapture', release);
		const auxiliary = mouseEvent(target, 3);
		await workspace.dispatch('onAuxClickCapture', auxiliary);
		assert.deepEqual([release.prevented, auxiliary.prevented, workspace.calls()], [1, 1, 1]);
	});
});

test('opening a modal and replacing preferences during a press preserves release suppression', async () => {
	await withWorkspace(async (workspace) => {
		await workspace.dispatch('onMouseDownCapture', mouseEvent(workspace.dom.one('[data-timeline]'), 4));
		assert.equal(workspace.calls(), 1);
		await workspace.render({ bindings: [], modal: true });
		const target = workspace.dom.one('[data-release-target]');
		const release = mouseEvent(target, 4);
		await workspace.dispatch('onMouseUpCapture', release);
		const auxiliary = mouseEvent(target, 4);
		await workspace.dispatch('onAuxClickCapture', auxiliary);
		assert.deepEqual([release.prevented, auxiliary.prevented, workspace.calls()], [1, 1, 1]);
	});
});

test('assigning a field cancels browser navigation when the mouse is released elsewhere in Preferences', async () => {
	await withWorkspace(async (workspace) => {
		await workspace.render({ modal: true });
		const field = workspace.dom.one('[data-shortcut-binding="0"]');
		const down = mouseEvent(field, 4);
		await workspace.dispatch('onMouseDownCapture', down);
		assert.deepEqual([down.prevented, down.stopped, workspace.calls()], [0, 0, 0], 'the row receives its press');
		await act(async () => { reactProps(field).onMouseDown?.(down); });
		assert.equal(field.value, 'Mouse5');
		const otherTarget = workspace.dom.one('[data-release-target]');
		const release = mouseEvent(otherTarget, 4);
		await workspace.dispatch('onMouseUpCapture', release);
		const auxiliary = mouseEvent(otherTarget, 4);
		await workspace.dispatch('onAuxClickCapture', auxiliary);
		assert.deepEqual([release.prevented, auxiliary.prevented, workspace.calls()], [1, 1, 0]);
	});
});

test('unrelated modal controls and disabled fields do not claim mouse gestures', async () => {
	await withWorkspace(async (workspace) => {
		await workspace.render({ modal: true, disabledField: true });
		for (const target of [
			workspace.dom.one('[data-release-target]'),
			workspace.dom.one('[data-timeline]'),
			workspace.dom.one('[data-shortcut-binding="0"]'),
		]) {
			const event = mouseEvent(target, 4);
			await workspace.dispatch('onMouseDownCapture', event);
			await workspace.dispatch('onMouseUpCapture', event);
			await workspace.dispatch('onAuxClickCapture', event);
			assert.deepEqual([event.prevented, event.stopped, workspace.calls()], [0, 0, 0]);
		}
	});
});

test('standard buttons and unassigned extra-button presses preserve native behavior', async () => {
	await withWorkspace(async (workspace) => {
		for (const target of [workspace.dom.one('[data-timeline]'), workspace.dom.one('[data-shortcut-binding="0"]')]) {
			for (const button of [0, 1, 2]) {
				const event = mouseEvent(target, button);
				for (const name of ['onPointerDownCapture', 'onMouseDownCapture', 'onMouseUpCapture', 'onAuxClickCapture']) {
					await workspace.dispatch(name, event);
				}
				assert.deepEqual([event.prevented, event.stopped, workspace.calls()], [0, 0, 0]);
			}
		}
		const unassigned = mouseEvent(workspace.dom.one('[data-timeline]'), 3);
		await workspace.dispatch('onMouseDownCapture', unassigned);
		await workspace.dispatch('onMouseUpCapture', unassigned);
		assert.deepEqual([unassigned.prevented, unassigned.stopped, workspace.calls()], [0, 0, 0]);
	});
});

test('a new unassigned press cannot inherit a claim whose auxiliary click never arrived', async () => {
	await withWorkspace(async (workspace) => {
		const target = workspace.dom.one('[data-timeline]');
		await workspace.dispatch('onMouseDownCapture', mouseEvent(target, 3, { ctrlKey: true }));
		await workspace.dispatch('onMouseUpCapture', mouseEvent(target, 3));
		const nextPress = mouseEvent(target, 3);
		await workspace.dispatch('onMouseDownCapture', nextPress);
		await workspace.dispatch('onMouseUpCapture', nextPress);
		await workspace.dispatch('onAuxClickCapture', nextPress);
		assert.deepEqual([nextPress.prevented, nextPress.stopped, workspace.calls()], [0, 0, 1]);
	});
});

test('unmounting clears a pending claim and a new mount remains usable under StrictMode', async () => {
	await withWorkspace(async (workspace) => {
		const target = workspace.dom.one('[data-timeline]');
		await workspace.dispatch('onMouseDownCapture', mouseEvent(target, 4));
		const oldRelease = reactProps(workspace.dom.one('[data-editor-root]')).onMouseUpCapture;
		await workspace.clear();
		const abandonedRelease = mouseEvent(target, 4);
		oldRelease?.(abandonedRelease);
		assert.equal(abandonedRelease.prevented, 0);
		await workspace.render();
		const newTarget = workspace.dom.one('[data-timeline]');
		const unmatchedRelease = mouseEvent(newTarget, 4);
		await workspace.dispatch('onMouseUpCapture', unmatchedRelease);
		assert.equal(unmatchedRelease.prevented, 0);
		await workspace.dispatch('onMouseDownCapture', mouseEvent(newTarget, 4));
		const completedRelease = mouseEvent(newTarget, 4);
		await workspace.dispatch('onMouseUpCapture', completedRelease);
		assert.deepEqual([completedRelease.prevented, workspace.calls()], [1, 2]);
	});
});

async function withWorkspace(operation: (workspace: WorkspaceFixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let calls = 0;
	function Harness({ bindings = ['Ctrl+Mouse4', 'Mouse5'], modal = false, disabledField = false }: HarnessProps) {
		const preferences = { shortcuts: { 'new-mono-track': bindings } };
		const handlers = useWorkspaceMouseShortcuts({ preferences }, (handler) => handler(), {
			menus: [{ id: 'new-mono-track', onClick: () => { calls += 1; } }],
		});
		return <div data-editor-root {...handlers}>
			<div data-timeline />
			<div role="dialog" aria-modal={modal || undefined}>
				<h2 data-release-target>Preferences</h2>
				<ShortcutEditorRow command={{ id: 'new-label-track', label: 'Add label track', disabled: disabledField }}
					preferences={preferences} controller={{ actions: { preferences: { setShortcut() {} } } }}
					copy={{
						shortcutColumn: 'Shortcut', shortcutAssign: 'Assign', shortcutAddBinding: 'Add shortcut',
						shortcutConflict: '{binding} conflicts with {action}', shortcutInvalid: 'Invalid shortcut',
					}}
					run={(handler) => handler()} />
			</div>
		</div>;
	}
	const render = async (props: HarnessProps = {}): Promise<void> => {
		await act(async () => root.render(<StrictMode><Harness {...props} /></StrictMode>));
	};
	try {
		await render();
		await operation({
			dom,
			calls: () => calls,
			render,
			clear: async () => { await act(async () => root.render(null)); },
			dispatch: async (name, event) => {
				const handler = reactProps(dom.one('[data-editor-root]'))[name];
				assert.ok(handler, `Missing mouse handler ${name}`);
				await act(async () => { handler(event); });
			},
		});
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

function mouseEvent(target: unknown, button: number, options: { ctrlKey?: boolean } = {}) {
	return {
		target,
		currentTarget: target,
		button,
		ctrlKey: options.ctrlKey ?? false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		prevented: 0,
		stopped: 0,
		get defaultPrevented() { return this.prevented > 0; },
		preventDefault() { this.prevented += 1; },
		stopPropagation() { this.stopped += 1; },
	};
}
