/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import {
	COMPACT_LAYOUT_VIEWPORT_QUERY,
	resolveWorkspaceLayoutMode,
	useWorkspaceCompactLayout,
} from '../src/common/editor/ui/workspace/useWorkspaceCompactLayout.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

type LayoutPreference = 'auto' | 'compact' | 'desktop';
type MediaListener = (event: { matches: boolean }) => void;

test('the layout preference decides the chrome and auto follows the viewport', () => {
	const table: Array<[LayoutPreference | undefined, boolean, 'compact' | 'desktop']> = [
		['auto', true, 'compact'],
		['auto', false, 'desktop'],
		[undefined, true, 'compact'],
		[undefined, false, 'desktop'],
		['compact', true, 'compact'],
		['compact', false, 'compact'],
		['desktop', true, 'desktop'],
		['desktop', false, 'desktop'],
	];
	for (const [preference, narrow, expected] of table) {
		assert.equal(resolveWorkspaceLayoutMode(preference, narrow), expected, `${preference} at narrow=${narrow}`);
	}
});

// A stand-in for window.matchMedia: each query keeps its own match state and
// change listeners so the test can resize the viewport the way a browser does.
function fakeMatchMedia() {
	const lists = new Map<string, { matches: boolean; listeners: Set<MediaListener> }>();
	const list = (query: string) => {
		let entry = lists.get(query);
		if (!entry) {
			entry = { matches: false, listeners: new Set() };
			lists.set(query, entry);
		}
		return entry;
	};
	return {
		matchMedia(query: string) {
			const entry = list(query);
			return {
				get matches() { return entry.matches; },
				addEventListener(_type: string, listener: MediaListener) { entry.listeners.add(listener); },
				removeEventListener(_type: string, listener: MediaListener) { entry.listeners.delete(listener); },
			};
		},
		set(query: string, matches: boolean) {
			const entry = list(query);
			entry.matches = matches;
			for (const listener of [...entry.listeners]) listener({ matches });
		},
		listenerCount(query: string) {
			return list(query).listeners.size;
		},
	};
}

async function mountLayoutHook(media: ReturnType<typeof fakeMatchMedia>) {
	const dom = installReactTestDom();
	Object.assign(globalThis.window as unknown as Record<string, unknown>, { matchMedia: media.matchMedia });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let latest: ReturnType<typeof useWorkspaceCompactLayout> | null = null;
	function Harness({ layoutPreference }: { layoutPreference?: LayoutPreference }) {
		latest = useWorkspaceCompactLayout({ layoutPreference });
		return null;
	}
	const render = async (layoutPreference?: LayoutPreference) => {
		await act(async () => root.render(<Harness layoutPreference={layoutPreference} />));
	};
	return {
		render,
		current: () => {
			assert.ok(latest, 'the hook rendered');
			return latest as ReturnType<typeof useWorkspaceCompactLayout>;
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

test('useWorkspaceCompactLayout follows the viewport in auto mode and the preference otherwise', async () => {
	const media = fakeMatchMedia();
	const hook = await mountLayoutHook(media);
	try {
		await hook.render('auto');
		assert.equal(hook.current().compactLayout, false);
		assert.equal(hook.current().isCompact, false);
		assert.equal(media.listenerCount(COMPACT_LAYOUT_VIEWPORT_QUERY), 1);

		await act(async () => media.set(COMPACT_LAYOUT_VIEWPORT_QUERY, true));
		assert.equal(hook.current().isCompact, true);
		assert.equal(hook.current().compactLayout, true);

		await hook.render('desktop');
		assert.equal(hook.current().isCompact, true, 'the viewport flag keeps reporting the media query');
		assert.equal(hook.current().compactLayout, false, 'the explicit desktop preference wins on a narrow viewport');

		await act(async () => media.set(COMPACT_LAYOUT_VIEWPORT_QUERY, false));
		await hook.render('compact');
		assert.equal(hook.current().compactLayout, true, 'the explicit compact preference wins on a wide viewport');
	} finally {
		await hook.cleanup();
	}
	assert.equal(media.listenerCount(COMPACT_LAYOUT_VIEWPORT_QUERY), 0, 'unmounting removes the media listener');
});

test('the chrome drawer is session state that closes when the layout leaves compact', async () => {
	const media = fakeMatchMedia();
	media.set(COMPACT_LAYOUT_VIEWPORT_QUERY, true);
	const hook = await mountLayoutHook(media);
	try {
		await hook.render('auto');
		assert.equal(hook.current().chromeDrawer.isOpen, false);
		await act(async () => { hook.current().chromeDrawer.toggle(); });
		assert.equal(hook.current().chromeDrawer.isOpen, true);
		await act(async () => { hook.current().chromeDrawer.close(); });
		assert.equal(hook.current().chromeDrawer.isOpen, false);
		await act(async () => { hook.current().chromeDrawer.open(); });
		assert.equal(hook.current().chromeDrawer.isOpen, true);

		await act(async () => media.set(COMPACT_LAYOUT_VIEWPORT_QUERY, false));
		assert.equal(hook.current().compactLayout, false);
		assert.equal(hook.current().chromeDrawer.isOpen, false, 'leaving the compact layout closes the drawer');

		await act(async () => media.set(COMPACT_LAYOUT_VIEWPORT_QUERY, true));
		assert.equal(hook.current().chromeDrawer.isOpen, false, 'returning to compact does not reopen it');
	} finally {
		await hook.cleanup();
	}
});

test('the hook renders without matchMedia and reports the desktop layout', async () => {
	const dom = installReactTestDom();
	try {
		let markup = '';
		function Harness() {
			const { compactLayout, isCompact } = useWorkspaceCompactLayout({ layoutPreference: 'auto' });
			return <div data-layout={compactLayout ? 'compact' : 'desktop'} data-narrow={String(isCompact)} />;
		}
		markup = renderToStaticMarkup(<Harness />);
		assert.match(markup, /data-layout="desktop"/u);
		assert.match(markup, /data-narrow="false"/u);
	} finally {
		dom.restore();
	}
});

test('the appearance preferences page shows the stored layout mode in a labelled field', () => {
	const labels: Record<'auto' | 'compact' | 'desktop', string> = {
		auto: ENGLISH_COPY.layoutAuto,
		compact: ENGLISH_COPY.layoutCompact,
		desktop: ENGLISH_COPY.layoutDesktop,
	};
	for (const layout of ['auto', 'compact', 'desktop'] as const) {
		const preferences = createAudioEditorPreferencesV1({ appearance: { layout } });
		const markup = renderToStaticMarkup(
			<WorkspacePreferencesDialog
				controller={{ actions: { preferences: {} } }}
				snapshot={{ preferences }}
				copy={ENGLISH_COPY}
				locale="en"
				fileService={{ isDesktop: false }}
				menus={[]}
				run={() => undefined}
				initialPage="appearance"
				onTogglePanel={() => undefined}
				onClose={() => undefined}
			/>,
		);
		const field = /role="group" aria-label="Layout">.*?<\/button>/u.exec(markup)?.[0] ?? '';
		assert.ok(field, 'renders the Layout field');
		// The vendored dropdown lists its options only once opened; the closed
		// trigger shows the stored value's label.
		assert.ok(field.includes(labels[layout]), `${layout} shows ${labels[layout]}`);
	}
});
