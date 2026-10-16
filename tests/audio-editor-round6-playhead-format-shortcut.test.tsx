/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TimeCodeFormatControl from '../src/common/editor/ui/toolbar/TimeCodeFormatControl.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const variant of ['ctrl', 'meta', 'alt', 'handled', 'ordinary'] as const) {
	test(`playhead format keyboard entry admits its own unmodified chord: ${variant}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => { root.render(<div data-audio-editor>
				<TimeCodeFormatControl label="Playhead: Format" format="hh:mm:ss+milliseconds" frameRate={24}
					onFormatChange={() => undefined}><div className="timecode">00s</div></TimeCodeFormatControl>
			</div>); });
			const host = dom.one('.kw-audio-editor__timecode-format-control');
			let consumed = false;
			await act(async () => { reactProps(host).onKeyDownCapture({ key: 'F10', shiftKey: true,
				ctrlKey: variant === 'ctrl', metaKey: variant === 'meta', altKey: variant === 'alt',
				defaultPrevented: variant === 'handled', preventDefault: () => { consumed = true; },
				stopPropagation: () => { consumed = true; } }); });
			assert.equal(consumed, variant === 'ordinary');
			assert.equal(Boolean(dom.find('[role="menu"]')), variant === 'ordinary');
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
