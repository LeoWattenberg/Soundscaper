/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import ProjectFeatureCompatibilityNotice from '../src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx';
import { hasProjectFeatureCompatibilityReport } from '../src/common/editor/ui/workspace/project-feature-compatibility-notice.ts';

const incompatible: ProjectFeatureRequirementsReport = {
	schemaVersion: 1,
	format: 'soundscaper-project',
	compatible: false,
	counts: { available: 0, unavailable: 1, unknown: 0 },
	items: [{
		requirementId: 'unavailable-audio',
		featureId: 'org.example.future-audio',
		displayName: 'Future audio',
		availability: 'unavailable',
		declaredDisposition: 'bypass',
		disposition: 'bypassed',
	}],
} as unknown as ProjectFeatureRequirementsReport;

test('project and AUP4 compatibility reports have no permanent menu entry', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const productId of ['soundscaper', 'framescaper']) {
			const menus = createApplicationMenus({
				productId, copy, aboutLabel: 'About', capabilities: {}, locale: 'en',
				project: null,
				snapshot: {
					project: null, selectedTrackId: null, deliveryReport: null,
					featureRequirementsCompatibility: incompatible,
					aup4Compatibility: { counts: { converted: 0, missing: 1, omitted: 0 } },
					preferences: createAudioEditorPreferencesV1(),
					history: { canUndo: false, canRedo: false, hasClipboard: false },
					effects: { selectionTypes: [], canRepeatLast: false },
				},
				blocked: false, editBlocked: false, handoffBlocked: false,
				showArmControls: false, selectionActive: false, selectedClip: null,
				durationFrames: 0, effectsPanelOpen: false, projectBinEffectivelyOpen: false,
				uiFlags: {}, actionRuntime: null,
				actions: new Proxy({}, { get: () => () => undefined }),
			});
			assert.doesNotMatch(JSON.stringify(menus), /"(?:project-compatibility-report|aup4-compatibility-report|audacity-projects)"/u);
		}
	}
});

test('project compatibility notification refuses absent, compatible, and native-only reports', () => {
	assert.equal(hasProjectFeatureCompatibilityReport(incompatible), true);
	for (const candidate of [
		null,
		undefined,
		{ ...incompatible, compatible: true },
		{ ...incompatible, items: [] },
		{ ...incompatible, items: incompatible.items.map((item) => ({ ...item, availability: 'available' as const, disposition: 'native' as const })) },
	]) {
		assert.equal(hasProjectFeatureCompatibilityReport(candidate), false);
	}
});


test('the default compatibility notification is a localized toast with an opt-in report', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		const markup = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
			report: incompatible,
			copy,
			onOpenReport: () => undefined,
		}));
		assert.match(markup, /data-project-feature-compatibility-summary/u);
		assert.match(markup, /data-editor-toast="project-feature-compatibility"/u);
		assert.ok(markup.includes(copy.scapeCompatibilityTitle));
		assert.ok(markup.includes(copy.aup4CompatibilityViewReport));
		assert.ok(markup.includes(copy.aup4CompatibilityDismiss));
		assert.doesNotMatch(markup, /data-project-feature-compatibility[ =>]|data-project-feature-requirement=/u);
		assert.doesNotMatch(markup, /role="dialog"/u);
	}
});

test('opening the report defers its modal body until the requested surface loads', () => {
	const markup = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		reportOpen: true,
		onOpenReport: () => undefined,
		onCloseReport: () => undefined,
	}));
	assert.ok(markup.includes(ENGLISH_COPY.loading));
	assert.match(markup, /role="status"/u);
	assert.doesNotMatch(markup, /role="dialog"|data-project-feature-requirement=/u);
});


test('dismissal stays with its project when switching A to B and back to A', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (id: string) => {
		await act(async () => root.render(React.createElement(ProjectFeatureCompatibilityNotice, {
			project: { id },
			report: incompatible,
			copy: ENGLISH_COPY,
			onOpenReport: () => undefined,
		})));
	};
	try {
		await render('project-a');
		assert.ok(dom.find('[data-project-feature-compatibility-summary]'));
		const dismiss = dom.container.querySelectorAll('button').find((button) => (
			button.textContent === `×${ENGLISH_COPY.aup4CompatibilityDismiss}`
		));
		assert.ok(dismiss);
		await act(async () => { reactProps(dismiss).onClick({ currentTarget: dismiss }); });
		assert.equal(dom.find('[data-project-feature-compatibility-summary]'), null);
		await render('project-b');
		assert.ok(dom.find('[data-project-feature-compatibility-summary]'), 'B has its own notification');
		await render('project-a');
		assert.equal(dom.find('[data-project-feature-compatibility-summary]'), null, 'A stays dismissed');
		await render('project-b');
		assert.ok(dom.find('[data-project-feature-compatibility-summary]'), 'B remains available');
		await act(async () => { context.mock.timers.tick(10_000); });
		assert.equal(dom.find('[data-project-feature-compatibility-summary]'), null, 'B expires automatically');
		await render('project-a');
		await render('project-b');
		assert.equal(dom.find('[data-project-feature-compatibility-summary]'), null, 'B stays dismissed after expiry');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
