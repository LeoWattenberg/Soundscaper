/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackControls } from '../src/common/editor/ui/timeline/OutputTrackRows.jsx';
import { AccessibilityProfileProvider } from '../vendor/audacity-design-system/components/src/contexts/AccessibilityProfileContext.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function capture(input: Readonly<Record<string, string | boolean>>, panelBubble = false) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	let prevented = 0, stopped = 0;
	try {
		await act(async () => root.render(<AccessibilityProfileProvider initialProfileId="au4-tab-groups"><ThemeProvider><OutputTrackControls
			controller={{ getTelemetrySnapshot: () => ({}), subscribeTelemetry: () => () => undefined }}
			scope="send" bus={{ id: 'send-1', name: 'Send 1', gain: 1, pan: 0 }}
			trackHeight={150} panelWidth={240} trackHeaderWidth={240} focused
			onFocus={() => undefined} onMenu={() => undefined} onFocusPanel={() => true}
			onTabOut={() => { calls.push('next'); return true; }}
			onShiftTabOut={() => { calls.push('previous'); return true; }}
			onNavigateVertical={() => true} blocked={false} mobile={false}
			copy={{ master: 'Master', trackName: 'Track name' }}
			run={(operation: () => unknown) => operation()} update={() => undefined} onOpenEffects={() => undefined}
		/></ThemeProvider></AccessibilityProfileProvider>));
		const header = dom.one('[data-output-track-header]');
		const target = dom.one('.track-control-panel');
		target.focus();
		const handler = panelBubble ? reactProps(target).onKeyDown : reactProps(header).onKeyDownCapture;
		await act(async () => handler({ ...input, target, currentTarget: target,
			preventDefault() { prevented++; }, stopPropagation() { stopped++; } }));
		return { calls, prevented, stopped };
	} finally {
		await act(async () => root.unmount());
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
	test(`output panel bubble releases Tab with ${modifier} after header capture`, async () => {
		assert.deepEqual(await capture({ key: 'Tab', [modifier]: true }, true), { calls: [], prevented: 0, stopped: 0 });
	});
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
	test(`output header releases Tab with ${modifier} to its existing owner`, async () => {
		assert.deepEqual(await capture({ key: 'Tab', [modifier]: true }), { calls: [], prevented: 0, stopped: 0 });
	});
}

test('ordinary output header Tab and Shift+Tab retain row traversal', async () => {
	assert.deepEqual(await capture({ key: 'Tab' }), { calls: ['next'], prevented: 1, stopped: 1 });
	assert.deepEqual(await capture({ key: 'Tab', shiftKey: true }), { calls: ['previous'], prevented: 1, stopped: 1 });
});
