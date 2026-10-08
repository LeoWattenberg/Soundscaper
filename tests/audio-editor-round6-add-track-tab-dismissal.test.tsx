/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerAddTrackFlyout } from '../src/common/editor/ui/timeline/TimelineFlyouts.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const target of ['inside', 'outside'] as const) for (const shiftKey of [false, true]) {
	test(`Add track Tab preserves the browser origin: ${target}, Shift ${shiftKey}`, async context => {
		context.mock.timers.enable({ apis: ['setTimeout'] });
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const listeners = new Set<EventListenerOrEventListenerObject>();
		const owner = dom.container.ownerDocument as unknown as Document;
		owner.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) listeners.add(listener); };
		owner.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) listeners.delete(listener); };
		const root = createRoot(dom.container as unknown as Element);
		let focusedAtClose: Element | null = null;
		let prevented = false;
		function Control() {
			const [open, setOpen] = useState(true);
			const triggerRef = useRef<HTMLButtonElement>(null);
			return <><button ref={triggerRef} data-add-track-trigger>Add track</button>
				<button data-next-control>Next control</button>
				<ContainerAddTrackFlyout isOpen={open} x={0} y={0} autoFocus={false}
					mutationsBlocked={false} copy={ENGLISH_COPY} triggerRef={triggerRef}
					showMasterTrack={false} onToggleMasterTrack={() => undefined}
					markersAvailable={false} showMarkers={false} onToggleMarkers={() => undefined}
					onClose={() => { focusedAtClose = owner.activeElement; setOpen(false); }}
					onSelectTrackType={() => undefined} /></>;
		}
		try {
			await act(async () => { root.render(<Control />); });
			const trigger = dom.one('[data-add-track-trigger]');
			const next = dom.one('[data-next-control]');
			const item = dom.one('.add-track-flyout__option');
			(target === 'inside' ? item : next).focus();
			const event = { key: 'Tab', shiftKey, preventDefault: () => { prevented = true; } } as KeyboardEvent;
			await act(async () => {
				for (const listener of [...listeners]) {
					if (typeof listener === 'function') listener(event);
					else listener.handleEvent(event);
				}
			});
			assert.equal(item.isConnected, false, 'Tab closes the popup');
			assert.equal(prevented, false, 'native Tab must advance focus');
			assert.equal(focusedAtClose, target === 'inside' ? trigger : next,
				'publish the surviving browser origin before removing the focused popup');
			assert.equal(owner.activeElement, target === 'inside' ? trigger : next);
		} finally {
			await act(async () => { root.unmount(); });
			context.mock.timers.reset();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
