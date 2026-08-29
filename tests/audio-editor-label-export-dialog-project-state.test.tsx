/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { LabelExportDialog } from '../src/common/editor/ui/inspector/LabelExportDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('label export resets project tracks and ignores an earlier project success', async () => {
	const fixture = await mountedLabelExportFixture();
	try {
		const projectA = labelProject('project-a', ['a-markers', 'a-captions']);
		await fixture.render(projectA);
		await chooseDropdownOption(fixture.formatDropdown(), ENGLISH_COPY.exportLabelsSrt);
		await click(fixture.checkbox('a-captions'));
		assert.equal(fixture.checkbox('a-captions').getAttribute('aria-checked'), 'false');

		await fixture.render({ ...projectA, revision: 2 });
		assert.equal(
			fixture.checkbox('a-captions').getAttribute('aria-checked'),
			'false',
			'a revision of project A must preserve its track selection',
		);
		await click(fixture.exportButton());
		assert.deepEqual(fixture.calls[0]?.request, { format: 'srt', trackIds: ['a-markers'] });

		await fixture.render(labelProject('project-b', ['b-markers', 'b-captions']));
		assert.equal(fixture.checkbox('b-markers').getAttribute('aria-checked'), 'true');
		assert.equal(fixture.checkbox('b-captions').getAttribute('aria-checked'), 'true');
		assert.equal(fixture.exportButton().hasAttribute('disabled'), false);
		await click(fixture.exportButton());
		assert.deepEqual(fixture.calls[1]?.request, {
			format: 'txt', trackIds: ['b-markers', 'b-captions'],
		});
		assert.equal(fixture.exportButton().hasAttribute('disabled'), true, 'project B starts busy');

		await settle(fixture.calls[0]!.completion, { cancelled: false });
		assert.equal(fixture.closes.count, 0, 'project A must not close project B');
		assert.equal(fixture.exportButton().hasAttribute('disabled'), true, 'project B must remain busy');

		await settle(fixture.calls[1]!.completion, { cancelled: false });
		assert.equal(fixture.closes.count, 1, 'the current project completion may close the dialog');
	} finally {
		await fixture.cleanup();
	}
});

test('label export ignores an earlier project rejection while the new project exports', async () => {
	const fixture = await mountedLabelExportFixture();
	try {
		await fixture.render(labelProject('project-a', ['a-labels']));
		await click(fixture.exportButton());

		await fixture.render(labelProject('project-b', ['b-labels']));
		await click(fixture.exportButton());
		assert.deepEqual(fixture.calls[1]?.request, { format: 'txt', trackIds: ['b-labels'] });
		assert.equal(fixture.exportButton().hasAttribute('disabled'), true, 'project B starts busy');

		await reject(fixture.calls[0]!.completion, new Error('Project A failed'));
		assert.equal(fixture.alert(), null, 'project A must not publish an error onto project B');
		assert.equal(fixture.exportButton().hasAttribute('disabled'), true, 'project B must remain busy');
		assert.equal(fixture.closes.count, 0);

		await reject(fixture.calls[1]!.completion, new Error('Project B failed'));
		assert.equal(fixture.alert()?.textContent, 'Project B failed');
		assert.equal(fixture.exportButton().hasAttribute('disabled'), false);
	} finally {
		await fixture.cleanup();
	}
});

interface LabelExportResult {
	readonly cancelled?: boolean;
}

interface LabelExportRequest {
	readonly format: string;
	readonly trackIds: readonly string[];
}

async function mountedLabelExportFixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const calls: Array<Readonly<{
		request: LabelExportRequest;
		completion: Deferred<LabelExportResult>;
	}>> = [];
	const closes = { count: 0 };
	const controller = {
		actions: {
			labels: {
				export: (request: LabelExportRequest) => {
					const completion = deferred<LabelExportResult>();
					calls.push({ request, completion });
					return completion.promise;
				},
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		calls,
		closes,
		render: async (project: ReturnType<typeof labelProject>) => act(async () => root.render(
			<LabelExportDialog
				isOpen
				controller={controller}
				snapshot={{ project }}
				copy={ENGLISH_COPY}
				onClose={() => { closes.count += 1; }}
			/>,
		)),
		checkbox: (trackId: string) => elementWithAttribute(
			dom.one(`[data-label-export-track="${trackId}"]`), 'role', 'checkbox',
		),
		formatDropdown: () => dom.one('[data-effect-field="label-format"]'),
		exportButton: () => elementNamed(dom.container, 'button', ENGLISH_COPY.exportLabels),
		alert: () => optionalElementWithAttribute(dom.container, 'role', 'alert'),
		cleanup: async () => {
			for (const call of calls) call.completion.resolve({ cancelled: true });
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function labelProject(id: string, labelTrackIds: readonly string[]) {
	return {
		id,
		revision: 1,
		tracks: labelTrackIds.map((trackId) => ({
			id: trackId,
			type: 'label',
			name: trackId,
			labels: [{ id: `${trackId}-label` }],
		})),
	};
}

async function click(element: ReactTestElement): Promise<void> {
	await act(async () => {
		reactProps(element).onClick();
		await Promise.resolve();
	});
}

async function chooseDropdownOption(dropdown: ReactTestElement, optionLabel: string): Promise<void> {
	const trigger = elementByTag(dropdown, 'button');
	Object.defineProperty(trigger, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({ bottom: 28, left: 0, width: 240 }),
	});
	await click(trigger);
	const body = document.body as unknown as ReactTestElement;
	const option = descendants(body).find((candidate) => (
		candidate.getAttribute('role') === 'option' && candidate.textContent === optionLabel
	));
	assert.ok(option, `Missing mounted dropdown option ${optionLabel}.`);
	await click(option);
}

async function settle<Value>(completion: Deferred<Value>, value: Value): Promise<void> {
	await act(async () => {
		completion.resolve(value);
		await completion.promise;
		await Promise.resolve();
	});
}

async function reject<Value>(completion: Deferred<Value>, cause: unknown): Promise<void> {
	await act(async () => {
		completion.reject(cause);
		await completion.promise.catch(() => undefined);
		await Promise.resolve();
	});
}

function elementNamed(root: ReactTestElement, tagName: string, text: string): ReactTestElement {
	const expectedTag = tagName.toUpperCase();
	const element = descendants(root).find((candidate) => (
		candidate.tagName === expectedTag && candidate.textContent === text
	));
	assert.ok(element, `Missing mounted ${tagName} named ${text}.`);
	return element;
}

function elementByTag(root: ReactTestElement, tagName: string): ReactTestElement {
	const expectedTag = tagName.toUpperCase();
	const element = descendants(root).find((candidate) => candidate.tagName === expectedTag);
	assert.ok(element, `Missing mounted ${tagName}.`);
	return element;
}

function elementWithAttribute(
	root: ReactTestElement,
	name: string,
	value: string,
): ReactTestElement {
	const element = optionalElementWithAttribute(root, name, value);
	assert.ok(element, `Missing mounted node [${name}="${value}"].`);
	return element;
}

function optionalElementWithAttribute(
	root: ReactTestElement,
	name: string,
	value: string,
): ReactTestElement | null {
	return descendants(root).find((candidate) => candidate.getAttribute(name) === value) ?? null;
}

function descendants(root: ReactTestElement): ReactTestElement[] {
	const children = root.childNodes.filter((node): node is ReactTestElement => 'tagName' in node);
	return children.flatMap((child) => [child, ...descendants(child)]);
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (cause: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}
