/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import FramescaperV27FinishingDialog from '../src/common/editor/ui/dialogs/FramescaperV27FinishingDialog.tsx';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from '../src/framescaper/editor-motion-analysis-actions-v27.ts';

test('lazy V27 captions surface exposes pathless file import and common file-service export', () => {
	const markup = render('captions', project(), controller());
	assert.match(markup, /data-v27-caption-file/u);
	assert.match(markup, /Choose sidecar file/u);
	assert.match(markup, /Export selected track/u);
	assert.match(markup, /accept="[^"]*\.srt[^"]*\.vtt[^"]*\.ttml/u);
});

test('lazy V27 motion surface exposes bounded execution, freshness, progress, and cancellation controls', () => {
	const owner = controller();
	bindFramescaperMotionAnalysisActionsV27(owner, createFramescaperMotionAnalysisActionsV27({
		owner,
		store: {
			getMediaAssetMetadata: async () => null,
			writeMediaAsset: async () => undefined,
			deleteMediaAsset: async () => undefined,
		},
		frameProvider: async () => [],
	}));
	const markup = render('motion-tracking', project(), owner);
	assert.match(markup, /Motion-analysis target/u);
	assert.match(markup, /Start frame/u);
	assert.match(markup, /End frame/u);
	assert.match(markup, /Analysis missing/u);
	assert.match(markup, /Analyze motion/u);
	assert.match(markup, /data-v27-motion-cancel/u);
});

test('Framescaper keeps only its motion analysis in Analyze when audio analyzers are unavailable', () => {
	const menus = [{ id: 'analyze', items: [
		{ id: 'analysis' }, { divider: true }, { id: 'framescaper-v27-motion-tracking' },
	] }];
	assert.deepEqual(filterProductMenus(menus, {
		audioAnalysis: false, videoMotionTracking: true,
	}, 'framescaper'), [{ id: 'analyze', items: [{ id: 'framescaper-v27-motion-tracking' }] }]);
	assert.deepEqual(filterProductMenus(menus, {
		audioAnalysis: false, videoMotionTracking: false,
	}, 'framescaper'), []);
});

function render(surface: 'captions' | 'motion-tracking', value: unknown, owner: ReturnType<typeof controller>) {
	return renderToStaticMarkup(<FramescaperV27FinishingDialog
		surface={surface}
		controller={owner}
		project={value}
		editingBlocked={false}
		readOnly={false}
		copy={{}}
		fileService={{ saveFile: async () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
}

function controller() {
	return {
		project: project(),
		actions: { edit: { commit: (_command: unknown) => undefined } },
	};
}

function project() {
	return {
		schemaVersion: 27, id: 'project-1', revision: 1, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', sequences: [{ id: 'main-sequence' }],
		sources: [{
			kind: 'video', id: 'video-source', name: 'Video', storageKey: 'video-source',
			contentSha256: '12'.repeat(32), sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 },
		}],
		videoColorContexts: [], videoSourceColorInterpretations: [], videoVisualPresentations: [],
		videoProcessorStacks: [{
			schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors: [{
				schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
				maximumFeatures: 32, quality: 0.01, minimumDistance: 2,
				windowRadius: 2, pyramidLevels: 2,
			}],
		}],
		videoMotionAnalyses: [], videoFinishingPresets: [], videoCaptionTracks: [],
		automationLanes: [], mixer: {}, tracks: [],
	};
}
