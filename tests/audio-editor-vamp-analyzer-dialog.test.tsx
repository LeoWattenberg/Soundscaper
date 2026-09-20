/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import type {
	VampAnalysisRequest,
	VampAnalysisResult,
} from '../src/common/editor/vamp-analysis.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const BINARY_SHA256 = 'ab'.repeat(32);

test('the lazy Vamp dialog builds a canonical request and publishes only validated results', async () => {
	const pending = deferred<unknown>();
	const requests: VampAnalysisRequest[] = [];
	const publications: Array<Readonly<{ result: VampAnalysisResult; trackName: string }>> = [];
	const mounted = await mountDialog({
		analyze: (request) => { requests.push(request); return pending.promise; },
		publishLabels: (result, trackName) => { publications.push({ result, trackName }); },
	});
	try {
		assert.equal(mounted.dom.one('[role="dialog"]').getAttribute('aria-label'), 'Vamp Analyzer');
		assert.equal(reactProps(select(mounted.dom.container, 'Analyzer')).value, 'installed-onsets');
		assert.equal(reactProps(select(mounted.dom.container, 'Output')).value, 'onsets');
		await change(select(mounted.dom.container, 'Scope'), 'master');
		await change(select(mounted.dom.container, 'Program'), 'Percussive');
		await change(input(mounted.dom.container, 'Threshold'), '0.75');
		await submit(mounted.dom.container);
		await submit(mounted.dom.container);
		assert.equal(requests.length, 1, 'rapid submits share one admitted operation');
		assert.deepEqual(requests[0], {
			schemaVersion: 1,
			analyzerId: 'installed-onsets',
			stableId: 'example:onsets',
			binarySha256: BINARY_SHA256,
			outputId: 'onsets',
			program: 'Percussive',
			parameters: [{ id: 'threshold', value: 0.75 }],
			scope: 'master',
			startFrame: 1_000,
			endFrame: 49_000,
			sampleRate: 48_000,
		});

		await act(async () => {
			pending.resolve(resultFor(requests[0]!, 'Kick'));
			await pending.promise;
			await Promise.resolve();
		});
		assert.match(mounted.dom.container.textContent, /1 feature/iu);
		await change(input(mounted.dom.container, 'Label track name'), 'Percussion hits');
		await click(mounted.dom.container, 'Publish labels');
		assert.equal(publications.length, 1);
		assert.equal(publications[0]?.trackName, 'Percussion hits');
		assert.equal(publications[0]?.result.features[0]?.label, 'Kick');
		assert.equal(mounted.closes(), 1);
	} finally {
		pending.resolve(resultFor(requests[0] ?? requestFixture(), 'Kick'));
		await mounted.unmount();
	}
});

test('Vamp dialog aborts on close and ignores completion from a replaced project', async () => {
	const pending = deferred<unknown>();
	const signals: AbortSignal[] = [];
	const mounted = await mountDialog({
		analyze: (request, nextSignal) => {
			signals.push(nextSignal);
			return pending.promise.then(() => resultFor(request));
		},
	});
	try {
		await submit(mounted.dom.container);
		assert.equal(signals[0]?.aborted, false);
		await mounted.render('project-b');
		assert.equal(signals[0]?.aborted, true);
		await act(async () => {
			pending.resolve(undefined);
			await pending.promise;
			await Promise.resolve();
		});
		assert.doesNotMatch(mounted.dom.container.textContent, /feature/iu);
		assert.equal(mounted.closes(), 0);
	} finally {
		pending.resolve(undefined);
		await mounted.unmount();
	}
});

test('Vamp dialog surfaces malformed analyzer output without publishing it', async () => {
	let publications = 0;
	const mounted = await mountDialog({
		analyze: async (request) => ({
			...resultFor(request),
			features: [{
				timestamp: { seconds: 2, nanoseconds: 0 }, duration: null, values: [], label: '',
			}],
		}),
		publishLabels: () => { publications += 1; },
	});
	try {
		await submit(mounted.dom.container);
		assert.match(mounted.dom.one('[role="alert"]').textContent, /outside.*range/iu);
		assert.equal(button(mounted.dom.container, 'Publish labels'), null);
		assert.equal(publications, 0);
	} finally {
		await mounted.unmount();
	}
});

async function mountDialog(overrides: Readonly<{
	analyze?: (request: VampAnalysisRequest, signal: AbortSignal) => Promise<unknown>;
	publishLabels?: (result: VampAnalysisResult, trackName: string) => PromiseLike<void> | void;
}> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const [{ createRoot }, { default: VampAnalyzerDialog }] = await Promise.all([
		import('react-dom/client'),
		import('../src/common/editor/ui/dialogs/VampAnalyzerDialog.tsx'),
	]);
	const root = createRoot(dom.container as unknown as Element);
	let closeCount = 0;
	const render = async (projectId: string) => act(async () => root.render(<VampAnalyzerDialog
		catalog={[analyzer()]}
		projectId={projectId}
		scope="track"
		startFrame={1_000}
		endFrame={49_000}
		sampleRate={48_000}
		analyze={overrides.analyze ?? (async (request) => resultFor(request))}
		publishLabels={overrides.publishLabels ?? (() => undefined)}
		onClose={() => { closeCount += 1; }}
	/>));
	await render('project-a');
	return {
		dom,
		render,
		closes: () => closeCount,
		unmount: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function analyzer() {
	return {
		analyzerId: 'installed-onsets', stableId: 'example:onsets', binarySha256: BINARY_SHA256,
		name: 'Percussion Onsets', maker: 'Example', programs: ['Percussive'],
		parameters: [{
			id: 'threshold', name: 'Threshold', description: 'Detection threshold', unit: '',
			minValue: 0, maxValue: 1, defaultValue: 0.5, quantizeStep: null,
		}],
		outputs: [{
			id: 'onsets', name: 'Onsets', description: 'Detected onsets', unit: '',
			sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false,
		}],
	};
}

function requestFixture(): VampAnalysisRequest {
	return {
		schemaVersion: 1, analyzerId: 'installed-onsets', stableId: 'example:onsets',
		binarySha256: BINARY_SHA256, outputId: 'onsets', program: null,
		parameters: [{ id: 'threshold', value: 0.5 }], scope: 'track',
		startFrame: 1_000, endFrame: 49_000, sampleRate: 48_000,
	};
}

function resultFor(request: VampAnalysisRequest, label = '') {
	return {
		schemaVersion: 1,
		request,
		features: [{
			timestamp: { seconds: 0, nanoseconds: 500_000_000 },
			duration: null,
			values: [0.8],
			label,
		}],
	};
}

async function submit(root: ReactTestElement): Promise<void> {
	await act(async () => {
		void reactProps(root.querySelector('form')!).onSubmit({ preventDefault() {} });
		await Promise.resolve();
	});
}

async function change(element: ReactTestElement, value: string): Promise<void> {
	await act(async () => {
		void reactProps(element).onChange({ currentTarget: { value } });
	});
}

async function click(root: ReactTestElement, text: string): Promise<void> {
	const candidate = button(root, text);
	if (!candidate) throw new Error(`Missing button ${text}.`);
	await act(async () => { void reactProps(candidate).onClick({}); await Promise.resolve(); });
}

function select(root: ReactTestElement, label: string): ReactTestElement {
	const candidate = root.querySelectorAll('label').find((element) => element.textContent.startsWith(label));
	const control = candidate?.querySelector('select');
	if (!control) throw new Error(`Missing select ${label}.`);
	return control;
}

function input(root: ReactTestElement, label: string): ReactTestElement {
	const candidate = root.querySelectorAll('label').find((element) => element.textContent.startsWith(label));
	const control = candidate?.querySelector('input');
	if (!control) throw new Error(`Missing input ${label}.`);
	return control;
}

function button(root: ReactTestElement, text: string): ReactTestElement | null {
	return root.querySelectorAll('button').find((candidate) => candidate.textContent === text) ?? null;
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}
