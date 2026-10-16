/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationCurveMenu } from '../src/common/editor/ui/timeline/TrackAutomationCurveMenu.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const owner of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'plain'] as const) {
	test(`automation curve menu respects existing keyboard ownership: ${owner}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		try {
			const returnFocus = dom.container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
			await act(async () => { root.render(<svg><TrackAutomationCurveMenu
				menu={{ x: 0, y: 0, segmentIndex: 0, returnFocus: returnFocus as unknown as SVGPathElement }}
				lane={null} descriptor={stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' })} width={500} height={250} bodyTop={0}
				copy={{}} onKind={() => undefined} onDelete={() => undefined} onClose={() => undefined} />
			</svg>); });
			const surface = dom.one('[role="menu"]');
			const first = dom.one('[role="menuitemradio"]');
			const close = dom.one('[role="menuitem"]');
			assert.equal(first.ownerDocument.activeElement, first);
			let prevented = false; let stopped = false;
			await act(async () => { reactProps(surface).onKeyDown?.({
				key: 'End', target: first, [owner]: owner !== 'plain',
				preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; },
			}); });
			assert.equal(prevented, owner === 'plain');
			assert.equal(stopped, owner === 'plain');
			assert.equal(first.ownerDocument.activeElement, owner === 'plain' ? close : first);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
