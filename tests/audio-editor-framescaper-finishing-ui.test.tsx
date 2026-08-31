/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import {
	bindFramescaperMotionAnalysisActionsFinishing,
	createFramescaperMotionAnalysisActionsFinishing,
} from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import {
	installReactTestDom,
	reactProps,
	type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('lazy Framescaper captions surface exposes pathless file import and common file-service export', () => {
	const markup = render('captions', project(), controller());
	assert.match(markup, /data-framescaper-caption-file/u);
	assert.match(markup, /Choose sidecar file/u);
	assert.match(markup, /Export selected track/u);
	assert.match(markup, /accept="[^"]*\.srt[^"]*\.vtt[^"]*\.ttml/u);
});

test('lazy Framescaper grading surface exposes exact cube LUT target and pathless file import', () => {
	const markup = render('grading-presets', project(), controller());
	assert.match(markup, /Cube LUT target/u);
	assert.match(markup, /Choose \.cube LUT/u);
	assert.match(markup, /data-framescaper-cube-lut-file/u);
	assert.match(markup, /accept="\.cube,text\/plain"/u);
});

test('lazy Framescaper motion surface exposes bounded execution, freshness, progress, and cancellation controls', () => {
	const owner = controller();
	bindFramescaperMotionAnalysisActionsFinishing(owner, createFramescaperMotionAnalysisActionsFinishing({
		owner,
		store: {
			getMediaAssetMetadata: async () => null,
			beginMediaAssetWrite: async () => ({
				maximumChunkBytes: 1_024,
				bytesWritten: 0,
				write: async () => undefined,
				commitOwned: async () => ({
					metadata: {},
					discardIfCurrent: async () => true,
				}),
				abort: async () => undefined,
			}),
		},
		frameProvider: async () => [],
	}));
	const markup = render('motion-tracking', project(), owner);
	assert.match(markup, /Motion-analysis target/u);
	assert.match(markup, /Start frame/u);
	assert.match(markup, /End frame/u);
	assert.match(markup, /Analysis missing/u);
	assert.match(markup, /Analyze motion/u);
	assert.match(markup, /data-framescaper-motion-cancel/u);
});

test('Framescaper keeps only its motion analysis in Analyze when audio analyzers are unavailable', () => {
	const menus = [{ id: 'analyze', items: [
		{ id: 'analysis' }, { divider: true }, { id: 'framescaper-motion-tracking' },
	] }];
	assert.deepEqual(filterProductMenus(menus, {
		audioAnalysis: false, videoMotionTracking: true,
	}, 'framescaper'), [{ id: 'analyze', items: [{ id: 'framescaper-motion-tracking' }] }]);
	assert.deepEqual(filterProductMenus(menus, {
		audioAnalysis: false, videoMotionTracking: false,
	}, 'framescaper'), []);
});

test('Framescaper omits capability-backed top-level menus whose project items are absent', () => {
	assert.deepEqual(filterProductMenus([
		{ id: 'generate', items: [] },
		{ id: 'analyze', items: [] },
	], {
		audioGenerators: false,
		audioAnalysis: false,
		videoGenerators: true,
		videoStills: true,
		videoMotionTracking: true,
	}, 'framescaper'), []);
});

test('a synchronous finishing commit failure is shown instead of reporting success', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const expected = new Error('finishing commit refused');
	const reported: unknown[] = [];
	const owner = {
		actions: { edit: { commit: () => { throw expected; } } },
	};
	const run = (operation: () => unknown): unknown => {
		try {
			const result = operation();
			if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
				void Promise.resolve(result).catch((error: unknown) => { reported.push(error); });
			}
			return result;
		} catch (error) {
			reported.push(error);
			return undefined;
		}
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperFinishingDialog
			surface="captions"
			controller={owner}
			project={project()}
			editingBlocked={false}
			readOnly={false}
			copy={{}}
			fileService={{ saveFile: async () => undefined }}
			run={run}
			onClose={() => undefined}
		/>));
		const documentInput = dom.one('[data-framescaper-finishing-document]');
		await act(async () => {
			documentInput.value = JSON.stringify([{
				schemaVersion: 1,
				id: 'captions-1',
				sequenceId: 'main-sequence',
				name: 'Captions',
				language: 'und',
				styles: [], regions: [], speakers: [], cues: [],
			}]);
			void reactProps(documentInput).onChange({ currentTarget: documentInput });
		});
		await act(async () => {
			void reactProps(buttonWithText(dom.container, 'Apply')).onClick({});
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /finishing commit refused/u);
		assert.doesNotMatch(dom.container.textContent, /Finishing state updated/u);
		assert.deepEqual(reported, [expected]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function render(surface: 'captions' | 'grading-presets' | 'motion-tracking', value: unknown, owner: ReturnType<typeof controller>) {
	return renderToStaticMarkup(<FramescaperFinishingDialog
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
		schemaFamily: 'framescaper', schemaVersion: 1,
		id: 'project-1', revision: 1, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', sequences: [{ id: 'main-sequence' }],
		sources: [{
			kind: 'video', id: 'video-source', name: 'Video', storageKey: 'video-source',
			contentSha256: '12'.repeat(32), sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 },
		}],
		videoColorContexts: [], videoSourceColorInterpretations: [], videoVisualPresentations: [{
			schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'clip-1' },
			enabled: true, opacity: 1, blendMode: 'normal', grade: null,
			processorStackId: null, maskMatteIds: [],
		}],
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

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
