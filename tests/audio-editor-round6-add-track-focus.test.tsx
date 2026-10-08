/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerAddTrackFlyout } from '../src/common/editor/ui/timeline/TimelineFlyouts.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const detail of [0, 1]) test(`Add track completion restores keyboard focus only for keyboard activation: detail ${detail}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const selected: string[] = [];
	function Control() {
		const [open, setOpen] = useState(true);
		const triggerRef = useRef<HTMLButtonElement>(null);
		return <><button ref={triggerRef} data-add-track-trigger>Add track</button>
			<ContainerAddTrackFlyout isOpen={open} x={0} y={0} autoFocus={false}
				mutationsBlocked={false} copy={ENGLISH_COPY} triggerRef={triggerRef}
				showMasterTrack={false} onToggleMasterTrack={() => undefined}
				markersAvailable={false} showMarkers={false} onToggleMarkers={() => undefined}
				onClose={() => setOpen(false)} onSelectTrackType={(type: string) => { selected.push(type); setOpen(false); }} />
		</>;
	}
	try {
		await act(async () => { root.render(<Control />); });
		const item = dom.one('.add-track-flyout__option');
		const trigger = dom.one('[data-add-track-trigger]');
		item.focus();
		await act(async () => { reactProps(item).onClick?.({ detail, currentTarget: item }); });
		assert.deepEqual(selected, ['audio']);
		assert.equal(item.isConnected, false);
		assert.equal(trigger.ownerDocument.activeElement === trigger, detail === 0);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
