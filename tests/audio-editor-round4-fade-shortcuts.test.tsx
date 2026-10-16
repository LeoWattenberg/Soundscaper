/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipFadeOverlays } from '../src/common/editor/ui/timeline/ClipFadeOverlays.tsx';
import type { ClipFadeChanges } from '../src/common/editor/ui/timeline/ClipFadeOverlays.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const shape of [false, true]) {
	test(`${shape ? 'shape' : 'duration'} fade handles claim only their own keyboard commands`, async context => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		context.after(async () => {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		});
		const changes: ClipFadeChanges[] = [];
		const rootRef = { current: dom.container as unknown as HTMLDivElement };
		function Probe() {
			return <><div data-clip-id="recording" role="group" tabIndex={0} />
				<ClipFadeOverlays rootRef={rootRef} clips={[{ id: 'recording', kind: 'audio', timelineStartFrame: 0,
					durationFrames: 48_000, fadeInFrames: 24_000, fadeInShape: 1 }]}
					selectedIds={new Set(['recording'])} startFrame={0} endFrame={48_000}
					pixelsPerSecond={120} sampleRate={48_000} blocked={false}
					showFadeShapeHandles crossfadedFadeEdges={new Set()}
					copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out', fadeInShape: 'Fade in shape',
						fadeOutShape: 'Fade out shape', legacyLinearFadeShape: 'Linear' }}
					onChange={(_id, change) => changes.push(change)} onTabOut={() => {}} />
			</>;
		}
		await act(async () => root.render(<Probe />));
		const selector = shape ? '[data-clip-fade-shape-handle="in"]' : '[data-clip-fade-handle="in"]';
		const control = dom.one(selector);
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) for (const key of ['b', 'Tab']) {
			let stopped = 0;
			let prevented = 0;
			await act(async () => reactProps(control).onKeyDown({ key, currentTarget: control,
				ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, [modifier]: true,
				stopPropagation() { stopped += 1; }, preventDefault() { prevented += 1; } }));
			assert.equal(stopped, 0, `${modifier} shortcuts belong to the editor`);
			assert.equal(prevented, 0);
			assert.deepEqual(changes, []);
		}
		let stopped = 0;
		let prevented = 0;
		await act(async () => reactProps(control).onKeyDown({ key: 'ArrowRight', currentTarget: control,
			ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
			stopPropagation() { stopped += 1; }, preventDefault() { prevented += 1; } }));
		assert.deepEqual(changes, [shape ? { fadeInShape: 1.1 } : { fadeInFrames: 24_480 }]);
		assert.equal(stopped, 1);
		assert.equal(prevented, 1);
		control.focus();
		await act(async () => reactProps(control).onKeyDown({ key: 'Tab', currentTarget: control,
			ctrlKey: false, metaKey: false, altKey: false, shiftKey: true,
			stopPropagation() { stopped += 1; }, preventDefault() { prevented += 1; } }));
		assert.equal(stopped, 2);
		assert.equal(prevented, 2);
		assert.equal(dom.container.ownerDocument.activeElement, shape
			? dom.one('[data-clip-fade-handle="in"]') : dom.one('[data-clip-id="recording"]'));
	});
}
