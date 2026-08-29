/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { ExportDialog } from '../src/common/editor/ui/inspector/ExportDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('export dialog replaces project defaults on a project switch without resetting same-project edits', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const requests: Readonly<Record<string, unknown>>[] = [];
	const controller = exportController(requests);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (project: ReturnType<typeof exportProject>) => <ExportDialog
		isOpen
		controller={controller}
		snapshot={exportSnapshot(project)}
		copy={ENGLISH_COPY}
		productId="soundscaper"
		fileService={{ isDesktop: false }}
		onClose={() => undefined}
	/>;
	try {
		const projectA = exportProject('project-a', 44_100, 'Project A', 'Artist A', { client: 'A' });
		await act(async () => root.render(renderDialog(projectA)));
		const sampleRate = descendantByTag(dom.one('[data-export-field="sampleRate"]'), 'input');
		await act(async () => {
			reactProps(sampleRate).onChange({ currentTarget: { value: '88200' } });
		});
		assert.equal(sampleRate.value, '88200');

		await act(async () => root.render(renderDialog({
			...projectA,
			revision: 2,
			metadata: { ...projectA.metadata, title: 'Revised project A' },
		})));
		assert.equal(
			descendantByTag(dom.one('[data-export-field="sampleRate"]'), 'input').value,
			'88200',
			'a revision of the same project must preserve an operator edit',
		);

		const projectB = exportProject('project-b', 96_000, 'Project B', 'Artist B', { client: 'B' });
		await act(async () => root.render(renderDialog(projectB)));
		assert.equal(
			descendantByTag(dom.one('[data-export-field="sampleRate"]'), 'input').value,
			'96000',
			'a new project must replace project A sample-rate state',
		);

		await act(async () => {
			reactProps(descendantByTag(dom.one('[data-export-action="start"]'), 'button')).onClick({});
			await Promise.resolve();
		});
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.sampleRate, 96_000);
		assert.deepEqual(requests[0]?.metadata, {
			client: 'B',
			title: 'Project B',
			artist: 'Artist B',
			album: 'Project B album',
			trackNumber: 'project-b track',
			year: 'project-b year',
			genre: 'project-b genre',
			comments: 'Project B comments',
			copyright: 'Project B copyright',
		});
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function descendantByTag(root: ReactTestElement, tagName: string): ReactTestElement {
	const expected = tagName.toUpperCase();
	const pending = [...root.childNodes];
	while (pending.length > 0) {
		const node = pending.shift();
		if (node && 'tagName' in node && node.tagName === expected) return node as ReactTestElement;
		if (node) pending.push(...node.childNodes);
	}
	throw new Error(`Missing ${tagName} below mounted test node.`);
}

function exportProject(
	id: string,
	sampleRate: number,
	title: string,
	artist: string,
	tags: Readonly<Record<string, string>>,
) {
	return {
		id,
		revision: 1,
		title,
		sampleRate,
		masterChannels: 2,
		metadata: {
			title,
			artist,
			album: `${title} album`,
			trackNumber: `${id} track`,
			year: `${id} year`,
			genre: `${id} genre`,
			comments: `${title} comments`,
			copyright: `${title} copyright`,
			tags,
		},
		clips: [{ id: `${id}-clip`, kind: 'audio' }],
		tracks: [{ id: `${id}-track`, type: 'audio', clipIds: [`${id}-clip`] }],
		loop: { enabled: false },
	};
}

function exportSnapshot(project: ReturnType<typeof exportProject>) {
	return {
		ready: true,
		importing: false,
		recording: false,
		processingEffect: false,
		missingSourceIds: [],
		exporting: false,
		export: { progress: 0, output: null },
		selection: null,
		masteringSequences: { sequences: [] },
		project,
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
