/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { ExportDialog } from '../src/common/editor/ui/inspector/ExportDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

const SAMPLE_RATE = 48_000;

test('the dialog asks what is delivered once, and the answer states both form and span', async () => {
	const fixture = await mountedExportDialog();
	try {
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputStems);
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.mode, 'stems');
		assert.equal(fixture.requests[0]?.range, 'project');

		await fixture.chooseOutput(ENGLISH_COPY.exportOutputChapters);
		await fixture.startExport();
		assert.equal(fixture.requests[1]?.mode, 'chapters');
		assert.equal(fixture.requests[1]?.range, 'project');

		await fixture.chooseOutput(ENGLISH_COPY.exportOutputLoop);
		await fixture.startExport();
		assert.equal(fixture.requests[2]?.mode, 'mix');
		assert.equal(fixture.requests[2]?.range, 'loop');

		await fixture.chooseOutput(ENGLISH_COPY.entireProject);
		await fixture.startExport();
		assert.equal(fixture.requests[3]?.mode, 'mix');
		assert.equal(fixture.requests[3]?.range, 'project');
	} finally {
		await fixture.unmount();
	}
});

test('a project with no labels is not offered a chapter split', async () => {
	const fixture = await mountedExportDialog({ labels: [] });
	try {
		assert.deepEqual(
			await fixture.outputOptionLabels(),
			[ENGLISH_COPY.entireProject, ENGLISH_COPY.exportOutputStems, ENGLISH_COPY.exportOutputLoop],
			'the loop is enabled and there is no selection, so only those three are deliverable',
		);
	} finally {
		await fixture.unmount();
	}
});

test('the channel choice is radio buttons, and only a custom one opens the mapping editor', async () => {
	const fixture = await mountedExportDialog();
	try {
		assert.deepEqual(fixture.channelOptionLabels(), [
			ENGLISH_COPY.preserveChannels, ENGLISH_COPY.mono, ENGLISH_COPY.stereo, ENGLISH_COPY.customChannelMapping,
		]);
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), true);

		await fixture.chooseChannels('mono');
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.channelMapping, 'mono');
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), true);

		await fixture.chooseChannels('custom');
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), false);
	} finally {
		await fixture.unmount();
	}
});

test('the mapping editor writes the checked routing into the delivered request', async () => {
	const fixture = await mountedExportDialog();
	try {
		await fixture.chooseChannels('custom');
		await fixture.click(fixture.editMappingButton());
		// The grid opens on the identity routing this project would deliver.
		assert.equal(fixture.mappingCell(0, 0).getAttribute('aria-checked'), 'true');
		assert.equal(fixture.mappingCell(1, 0).getAttribute('aria-checked'), 'false');

		await fixture.click(fixture.mappingCell(1, 0));
		await fixture.click(fixture.mappingCell(1, 1));
		await fixture.click(elementByTag(
			fixture.dom.one('[data-export-channel-mapping-action="apply"]'), 'button',
		));
		assert.equal(fixture.dom.find('[data-export-channel-mapping]'), null);

		await fixture.startExport();
		assert.deepEqual(fixture.requests[0]?.channelMapping, {
			channels: [
				{ inputs: [{ channel: 0, gain: 1 }, { channel: 1, gain: 1 }] },
				{ inputs: [] },
			],
		});
	} finally {
		await fixture.unmount();
	}
});

test('dither and loudness normalization are rendering decisions, not audio-format ones', async () => {
	const fixture = await mountedExportDialog();
	try {
		const sections = fixture.sectionFields();
		assert.deepEqual(sections[ENGLISH_COPY.audioOptionsSection], ['channelMapping', 'bitDepth', 'sampleRate']);
		assert.deepEqual(sections[ENGLISH_COPY.exportSection], ['format', 'output']);
		assert.deepEqual(sections[ENGLISH_COPY.renderingSection], ['loudnessNormalization', 'dither', 'tails']);
	} finally {
		await fixture.unmount();
	}
});

test('a finished export starts its own download exactly once', async () => {
	const fixture = await mountedExportDialog();
	try {
		const link = fixture.dom.one('[data-export-download]');
		assert.equal(link.clickCount, 0);

		await fixture.publish({ url: 'blob:one', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 1);
		// The same output re-rendering is not a second delivery.
		await fixture.publish({ url: 'blob:one', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 1);

		await fixture.publish({ url: 'blob:two', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 2);

		// A direct save writes the file itself and publishes no link to press.
		await fixture.publish({ url: null, fileName: 'mix.wav' });
		assert.equal(link.clickCount, 2);
	} finally {
		await fixture.unmount();
	}
});

interface ExportDialogFixtureOptions {
	readonly labels?: readonly Readonly<Record<string, unknown>>[];
}

async function mountedExportDialog(options: ExportDialogFixtureOptions = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const requests: Readonly<Record<string, unknown>>[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const project = exportProject(options.labels ?? [
		{ id: 'one', title: 'Intro', startFrame: 0, endFrame: SAMPLE_RATE },
	]);
	const render = async (output: Readonly<Record<string, unknown>> | null = null) => {
		await act(async () => root.render(<ExportDialog
			isOpen
			controller={exportController(requests)}
			snapshot={{
				ready: true,
				importing: false,
				recording: false,
				processingEffect: false,
				missingSourceIds: [],
				exporting: false,
				export: { progress: 0, output },
				selection: null,
				masteringSequences: { sequences: [] },
				project,
			}}
			copy={ENGLISH_COPY}
			productId="soundscaper"
			fileService={{ isDesktop: false }}
			onClose={() => undefined}
		/>));
	};
	await render();
	const click = async (element: ReactTestElement) => {
		await act(async () => {
			reactProps(element).onClick({});
			await Promise.resolve();
		});
	};
	const outputDropdownOptions = async () => {
		const trigger = elementByTag(dom.one('[data-export-field="output"]'), 'button');
		await click(trigger);
		const body = document.body as unknown as ReactTestElement;
		return descendants(body).filter((candidate) => candidate.getAttribute('role') === 'option');
	};
	return {
		dom,
		requests,
		click,
		async unmount() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
		publish: (output: Readonly<Record<string, unknown>>) => render(output),
		async outputOptionLabels() {
			const options = await outputDropdownOptions();
			const labels = options.map((option) => option.textContent);
			await click(options[0]);
			return labels;
		},
		async chooseOutput(label: string) {
			const options = await outputDropdownOptions();
			const option = options.find((candidate) => candidate.textContent === label);
			assert.ok(option, `Missing mounted output option ${label}.`);
			await click(option);
		},
		channelOptionLabels() {
			return descendants(dom.one('[data-export-field="channelMapping"]'))
				.filter((node) => node.getAttribute('data-export-channel-option'))
				.map((node) => node.textContent);
		},
		async chooseChannels(value: string) {
			const radio = elementByTag(dom.one(`[data-export-channel-option="${value}"]`), 'input');
			await act(async () => {
				reactProps(radio).onChange({ currentTarget: { value } });
				await Promise.resolve();
			});
		},
		editMappingButton() {
			return elementByTag(dom.one('[data-export-channel-action="edit-mapping"]'), 'button');
		},
		mappingCell(input: number, output: number) {
			return elementWithAttribute(
				dom.one(`[data-export-channel-mapping-cell="${input}-${output}"]`), 'role', 'checkbox',
			);
		},
		sectionFields() {
			const sections: Record<string, string[]> = {};
			for (const section of dom.container.querySelectorAll('.audio-editor-export-section')) {
				const heading = descendants(section).find((node) => node.tagName === 'H3');
				if (!heading) continue;
				sections[heading.textContent] = descendants(section)
					.map((node) => node.getAttribute('data-export-field'))
					.filter((name): name is string => Boolean(name));
			}
			return sections;
		},
		startExport() {
			return click(elementByTag(dom.one('[data-export-action="start"]'), 'button'));
		},
	};
}

function exportProject(labels: readonly Readonly<Record<string, unknown>>[]) {
	return {
		id: 'export-surface',
		revision: 1,
		title: 'Export surface',
		sampleRate: SAMPLE_RATE,
		masterChannels: 2,
		metadata: {},
		clips: [{ id: 'clip', kind: 'audio' }],
		tracks: [
			{ id: 'track', type: 'audio', clipIds: ['clip'] },
			{ id: 'labels', type: 'label', labels },
		],
		loop: { enabled: true, startFrame: 0, endFrame: SAMPLE_RATE },
	};
}

function exportController(requests: Readonly<Record<string, unknown>>[]) {
	return {
		subscribeTelemetry: () => () => undefined,
		getTelemetrySnapshot: () => ({ exportProgress: 0 }),
		actions: {
			export: {
				presets: {
					list: () => [],
					apply: () => { throw new Error('not used'); },
					save: () => { throw new Error('not used'); },
					delete: () => { throw new Error('not used'); },
					import: () => { throw new Error('not used'); },
					saveToFile: () => { throw new Error('not used'); },
				},
				previewDeliveryCanvas: () => undefined,
				start: (request: Readonly<Record<string, unknown>>) => { requests.push(request); },
				cancel: () => undefined,
			},
		},
	};
}

function elementByTag(root: ReactTestElement, tagName: string): ReactTestElement {
	const expected = tagName.toUpperCase();
	const element = descendants(root).find((candidate) => candidate.tagName === expected);
	assert.ok(element, `Missing mounted ${tagName}.`);
	return element;
}

function elementWithAttribute(
	root: ReactTestElement,
	name: string,
	value: string,
): ReactTestElement {
	const element = descendants(root).find((candidate) => candidate.getAttribute(name) === value);
	assert.ok(element, `Missing mounted node with ${name}="${value}".`);
	return element;
}

function descendants(root: ReactTestElement): ReactTestElement[] {
	const children = root.childNodes.filter((node): node is ReactTestElement => 'tagName' in node);
	return children.flatMap((child) => [child, ...descendants(child)]);
}

declare const document: Readonly<{ body: unknown }>;
