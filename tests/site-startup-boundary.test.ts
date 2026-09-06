/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	SITE_COPY_BY_LOCALE,
	bundledSiteCopyForLocale,
} from '../src/common/i18n/site-copy.js';
import {
	APPLICATION_READY_SELECTOR,
	createApplicationReadyScheduler,
} from '../src/common/site/application-ready-scheduler.js';

const ROOT = new URL('../', import.meta.url);

test('site copy is a strict localized subset of the complete editor catalogs', () => {
	assert.deepEqual(Object.keys(SITE_COPY_BY_LOCALE.de), Object.keys(SITE_COPY_BY_LOCALE.en));
	assert.ok(Object.keys(SITE_COPY_BY_LOCALE.en).length < Object.keys(ENGLISH_COPY).length / 10);
	assert.equal(bundledSiteCopyForLocale('en'), SITE_COPY_BY_LOCALE.en);
	assert.equal(bundledSiteCopyForLocale('de'), SITE_COPY_BY_LOCALE.de);
	for (const [locale, catalog] of Object.entries({ en: ENGLISH_COPY, de: GERMAN_COPY })) {
		for (const [key, value] of Object.entries(SITE_COPY_BY_LOCALE[locale])) {
			assert.equal(catalog[key], value, `${locale}.${key}`);
		}
	}
});

test('the site entry owns no editor CSS or complete catalog edge', async () => {
	const app = await source('src/common/site/App.jsx');
	const sidebar = await source('src/common/site/BrandSidebar.jsx');
	const siteCopy = await source('src/common/site/use-site-copy.js');
	const editor = await source('src/common/editor/ui/AudioEditorApp.jsx');
	assert.doesNotMatch(app, /i18n\/catalogs\.js|audio-editor-design-system\.css/u);
	assert.doesNotMatch(sidebar, /i18n\/catalogs\.js/u);
	assert.match(app, /bundledSiteCopyForLocale/u);
	assert.match(app, /useSiteCopy\(locale\)/u);
	assert.match(sidebar, /useSiteCopy\(/u);
	assert.match(siteCopy, /bundledSiteCopyForLocale\(locale\)/u);
	assert.match(siteCopy, /SITE_COPY_BY_LOCALE\.en/u);
	assert.match(editor, /audio-editor-design-system\.css/u);
});

// The complete catalogs must stay out of the static entry graph however they
// are reached: an indirect edge through the machine-catalog layer would carry
// every copy module into a graph budgeted at ten requests.
test('the static closure of the site shell never reaches the complete catalogs', async () => {
	const closure = await staticClosure([
		'src/common/site/App.jsx',
		'src/common/site/BrandSidebar.jsx',
		'src/common/site/use-site-copy.js',
	]);
	assert.ok(closure.has(resolve(fileURLToPath(ROOT), 'src/common/i18n/machine-catalog.js')));
	assert.ok(closure.has(resolve(fileURLToPath(ROOT), 'src/common/i18n/machine/index.js')));
	assert.ok(!closure.has(resolve(fileURLToPath(ROOT), 'src/common/i18n/catalogs.js')));
	for (const path of closure) assert.doesNotMatch(path, /src\/common\/i18n\/(?!site-copy\.js|site-sidebar-copy\.js)[^/]*-copy\.js$|canonical-extras/u, path);
});

async function staticClosure(roots: readonly string[]): Promise<ReadonlySet<string>> {
	const pending = roots.map((path) => resolve(fileURLToPath(ROOT), path));
	const seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop() as string;
		if (seen.has(path)) continue;
		seen.add(path);
		let text: string;
		try {
			text = await readFile(path, 'utf8');
		} catch {
			continue;
		}
		for (const specifier of staticRelativeSpecifiers(text)) pending.push(resolve(dirname(path), specifier));
	}
	return seen;
}

/**
 * Every relative module a file imports or re-exports statically, however the
 * clause is laid out. Dynamic `import()` is a lazy edge and is left out.
 */
function staticRelativeSpecifiers(text: string): readonly string[] {
	const specifiers = new Set<string>();
	for (const match of text.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) specifiers.add(match[1]);
	for (const match of text.matchAll(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) specifiers.add(match[1]);
	return [...specifiers];
}

test('the closure walk follows multi-line import clauses, bare imports and re-exports, not lazy imports', () => {
	assert.deepEqual(staticRelativeSpecifiers([
		"import {",
		"\tENGLISH_COPY,",
		"} from '../i18n/catalogs.js';",
		"import './site.css';",
		"export * from './x.js';",
		"export { a } from \"./y.js\";",
		"const lazy = () => import('./lazy.js');",
		"import React from 'react';",
	].join('\n')), ['../i18n/catalogs.js', './x.js', './y.js', './site.css']);
});

test('route application localizes the initial-load progressbar before the editor mounts', async () => {
	const app = await source('src/common/site/App.jsx');
	assert.match(app, /querySelector\('\[data-initial-load-progress\]'\)/u);
	assert.match(app, /setAttribute\(\s*'aria-label',\s*bundledSiteCopyForLocale\(route\.locale\)\.loading,?\s*\)/u);
});

test('selected product bootstraps construct full bundled English copy internally', async () => {
	for (const path of [
		'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx',
		'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
	]) {
		const bootstrap = await source(path);
		assert.match(bootstrap, /bundledCatalogForLocale/u, path);
		assert.match(bootstrap, /locale === 'en'[\s\S]*bundledCatalogForLocale\('en'\)/u, path);
	}
});

test('feature CSS is imported only by its owning editor surface', async () => {
	const manifest = await source('src/common/editor/ui/audio-editor-design-system.css');
	const ownership = new Map([
		['15-adm.css', 'src/common/editor/ui/AdmMetadataFields.tsx'],
		['18-musical-timeline.css', 'src/common/editor/ui/toolbar/MusicalTimelineControls.jsx'],
		['20-sound-activation.css', 'src/common/editor/ui/SoundActivationPreferences.tsx'],
		['23-source-monitor.css', 'src/common/editor/ui/workspace/SourceMonitorPanel.jsx'],
		['25-spectral-brush.css', 'src/common/editor/ui/timeline/SpectralBrushOverlay.jsx'],
		['26-take-comp.css', 'src/common/editor/ui/dialogs/TakeCompDialog.tsx'],
		['27-audio-warp.css', 'src/common/editor/ui/dialogs/AudioWarpDialog.tsx'],
		['28-take-cycle-recovery.css', 'src/common/editor/ui/dialogs/TakeCycleRecoveryDialog.tsx'],
		['29-framescaper-capture.css', 'src/common/editor/ui/workspace/RecordingSetupPanel.tsx'],
		['30-framescaper-web-vcr.css', 'src/common/editor/ui/workspace/WebVcrPanel.tsx'],
		['33-workspace-onboarding.css', 'src/common/editor/ui/dialogs/WorkspaceOnboardingDialog.tsx'],
	]);
	for (const [css, owner] of ownership) {
		assert.doesNotMatch(manifest, new RegExp(css.replace('.', '\\.')), css);
		assert.match(await source(owner), new RegExp(`audio-editor-design-system/${css.replace('.', '\\.')}`), owner);
	}
});

test('application-ready scheduling waits for readiness, idles once, and supports an immediate request', () => {
	assert.match(APPLICATION_READY_SELECTOR, /\[data-privacy-policy-dialog="true"\]/u);
	const first = schedulerFixture(false);
	const deferred = createApplicationReadyScheduler(first.options);
	assert.equal(first.tasks, 0);
	assert.equal(first.idleCallbacks.size, 0);
	first.windowObject.dispatchEvent(new Event('scape:application-ready'));
	assert.equal(first.idleCallbacks.size, 1);
	assert.equal(first.tasks, 0);
	first.runIdle();
	assert.equal(first.tasks, 1);
	deferred.request();
	assert.equal(first.tasks, 1);
	deferred.dispose();

	const second = schedulerFixture(true);
	const immediate = createApplicationReadyScheduler(second.options);
	assert.equal(second.idleCallbacks.size, 1);
	immediate.request();
	assert.equal(second.tasks, 1);
	assert.equal(second.cancelledIdleCallbacks, 1);
	second.runIdle();
	assert.equal(second.tasks, 1);
	immediate.dispose();
});

test('application-ready scheduling uses a one-second fallback without requestIdleCallback', () => {
	const windowObject = new EventTarget() as EventTarget & {
		setTimeout: (callback: () => void, delay: number) => number;
		clearTimeout: (handle: number) => void;
	};
	let scheduledDelay = -1;
	let scheduledTask = () => {};
	windowObject.setTimeout = (callback, delay) => {
		scheduledTask = callback;
		scheduledDelay = delay;
		return 1;
	};
	windowObject.clearTimeout = () => {};
	let tasks = 0;
	const scheduler = createApplicationReadyScheduler({
		windowObject,
		documentObject: { querySelector: () => ({}) },
		task: () => { tasks += 1; },
	});
	assert.equal(scheduledDelay, 1_000);
	assert.equal(tasks, 0);
	scheduledTask();
	assert.equal(tasks, 1);
	scheduler.dispose();
});

function schedulerFixture(ready: boolean) {
	const windowObject = new EventTarget() as EventTarget & {
		requestIdleCallback: (callback: () => void) => number;
		cancelIdleCallback: (handle: number) => void;
		setTimeout: (callback: () => void, delay: number) => number;
		clearTimeout: (handle: number) => void;
	};
	const idleCallbacks = new Map<number, () => void>();
	let nextHandle = 1;
	let tasks = 0;
	let cancelledIdleCallbacks = 0;
	windowObject.requestIdleCallback = (callback) => {
		const handle = nextHandle++;
		idleCallbacks.set(handle, callback);
		return handle;
	};
	windowObject.cancelIdleCallback = (handle) => {
		if (idleCallbacks.delete(handle)) cancelledIdleCallbacks += 1;
	};
	windowObject.setTimeout = () => 1;
	windowObject.clearTimeout = () => {};
	const documentObject = {
		querySelector: () => ready ? {} : null,
	};
	return {
		windowObject,
		idleCallbacks,
		get tasks() { return tasks; },
		get cancelledIdleCallbacks() { return cancelledIdleCallbacks; },
		runIdle() {
			for (const [handle, callback] of idleCallbacks) {
				idleCallbacks.delete(handle);
				callback();
			}
		},
		options: {
			windowObject,
			documentObject,
			task: () => { tasks += 1; },
		},
	};
}

async function source(path: string): Promise<string> {
	return readFile(new URL(path, ROOT), 'utf8');
}
