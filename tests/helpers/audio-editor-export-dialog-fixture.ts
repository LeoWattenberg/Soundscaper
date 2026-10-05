/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import React, { act } from 'react';

import { ExportDialog } from '../../src/common/editor/ui/inspector/ExportDialog.jsx';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './react-test-dom.ts';

const SAMPLE_RATE = 48_000;

interface ExportDialogFixtureOptions {
	readonly productId?: string;
	readonly labels?: readonly Readonly<Record<string, unknown>>[];
	readonly masteringSequences?: readonly Readonly<Record<string, unknown>>[];
	readonly output?: Readonly<Record<string, unknown>>;
	readonly video?: boolean;
}

export async function mountedExportDialog(options: ExportDialogFixtureOptions = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const requests: Readonly<Record<string, unknown>>[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let project = exportProject(options.labels ?? [
		{ id: 'one', title: 'Intro', startFrame: 0, endFrame: SAMPLE_RATE },
	], options.video === true);
	const render = async (output: Readonly<Record<string, unknown>> | null = null) => {
		await act(async () => root.render(React.createElement(ExportDialog, {
			isOpen: true,
			controller: exportController(requests),
			snapshot: {
				ready: true,
				importing: false,
				recording: false,
				processingEffect: false,
				missingSourceIds: [],
				exporting: false,
				export: { progress: 0, output },
				selection: null,
				masteringSequences: { sequences: options.masteringSequences ?? [] },
				project,
			},
			copy: ENGLISH_COPY,
			productId: options.productId ?? 'soundscaper',
			fileService: { isDesktop: false },
			onClose: () => undefined,
		})));
	};
	await render(options.output ?? null);
	const click = async (element: ReactTestElement) => {
		await act(async () => {
			reactProps(element).onClick({});
			await Promise.resolve();
		});
	};
	const dropdownOptions = async (field: string) => {
		const trigger = elementByTag(dom.one(`[data-export-field="${field}"]`), 'button');
		await click(trigger);
		const body = document.body as unknown as ReactTestElement;
		return descendants(body).filter((candidate) => candidate.getAttribute('role') === 'option');
	};
	const outputDropdownOptions = () => dropdownOptions('output');
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
		async removeAudioClips() {
			project = { ...project, clips: project.clips.filter(({ kind }) => kind !== 'audio') };
			await render();
		},
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
		/** Read a codec dropdown's rows and close it again without choosing one. */
		async fieldOptionLabels(field: string) {
			const options = await dropdownOptions(field);
			const labels = options.map((option) => option.textContent);
			await click(elementByTag(dom.one(`[data-export-field="${field}"]`), 'button'));
			return labels;
		},
		async chooseField(field: string, label: string) {
			const options = await dropdownOptions(field);
			const option = options.find((candidate) => candidate.textContent === label);
			assert.ok(option, `Missing mounted ${field} option ${label}.`);
			await click(option);
		},
		async chooseFormat(label: string) {
			const options = await dropdownOptions('format');
			const option = options.find((candidate) => candidate.textContent === label);
			assert.ok(option, `Missing mounted format option ${label}.`);
			await click(option);
		},
		noLabelsHint() {
			return dom.find('[data-export-no-labels]')?.textContent ?? null;
		},
		chapterCheckbox() {
			return elementWithAttribute(dom.one('[data-export-field="embedLabelChapters"]'), 'role', 'checkbox');
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

function exportProject(labels: readonly Readonly<Record<string, unknown>>[], video: boolean) {
	return {
		id: 'export-surface',
		revision: 1,
		title: 'Export surface',
		sampleRate: SAMPLE_RATE,
		masterChannels: 2,
		metadata: {},
		clips: [
			{ id: 'clip', kind: 'audio', timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0 },
			...(video ? [{ id: 'video-clip', kind: 'video', timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0 }] : []),
		],
		tracks: [
			{ id: 'track', type: 'audio', clipIds: ['clip'] },
			{ id: 'labels', type: 'label', labels },
			...(video ? [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }] : []),
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

export function elementByTag(root: ReactTestElement, tagName: string): ReactTestElement {
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
