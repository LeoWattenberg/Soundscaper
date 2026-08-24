/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import FramescaperNativeProjectActionPanel from '../src/common/editor/ui/dialogs/FramescaperNativeProjectActionPanel.tsx';
import { FRAMESCAPER_NATIVE_SERVICES_COPY } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { createFramescaperNativeProjectActionSubsetRuntime } from '../src/common/editor/ui/framescaper-native-project-actions.ts';

test('mounted delivery form submits exact 60000/1001 intent and reports alpha refusal', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[] = [];
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(
		['render-queue-enqueue'], {
			'render-queue-enqueue': async (request) => {
				calls.push(request);
				if (record(request).preserveAlpha === false) throw new Error('Alpha delivery was refused.');
			},
		},
	);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperNativeProjectActionPanel
			copy={FRAMESCAPER_NATIVE_SERVICES_COPY}
			surface="render-queue-enqueue"
			projectActions={runtime}
			title="Add to render queue"
		/>));
		const select = dom.one('[data-framescaper-render-delivery="true"]');
		const numerator = dom.one('[data-framescaper-render-rate-num="true"]');
		const denominator = dom.one('[data-framescaper-render-rate-den="true"]');
		const alpha = dom.elements('input').find((node) => node.type === 'checkbox');
		const form = dom.one('form');
		assert.ok(alpha);
		await change(select, 'openexr');
		await change(numerator, '60000');
		await change(denominator, '1001');
		await submit(form);
		assert.deepEqual(calls[0], {
			kind: 'image-sequence', format: 'openexr',
			frameRate: { num: 60_000, den: 1_001 }, preserveAlpha: true,
		});
		await check(alpha, false);
		await submit(form);
		assert.deepEqual(calls[1], {
			kind: 'image-sequence', format: 'openexr',
			frameRate: { num: 60_000, den: 1_001 }, preserveAlpha: false,
		});
		assert.match(dom.one('[role="status"]').textContent, /alpha delivery was refused/iu);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

async function change(node: TestElement, value: string): Promise<void> {
	await act(async () => {
		node.value = value;
		props(node).onChange({ currentTarget: node, target: node });
	});
}

async function check(node: TestElement, checked: boolean): Promise<void> {
	await act(async () => {
		node.checked = checked;
		props(node).onChange({ currentTarget: node, target: node });
	});
}

async function submit(node: TestElement): Promise<void> {
	await act(async () => {
		props(node).onSubmit({ preventDefault() {} });
		await Promise.resolve();
	});
}

function props(node: TestElement): Record<string, (...args: unknown[]) => unknown> {
	const key = Reflect.ownKeys(node).find((candidate) => (
		typeof candidate === 'string' && candidate.startsWith('__reactProps$')
	));
	assert.equal(typeof key, 'string');
	return node[key as keyof TestElement] as Record<string, (...args: unknown[]) => unknown>;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}

interface TestDom {
	readonly container: TestElement;
	one(selector: string): TestElement;
	elements(tagName: string): TestElement[];
	restore(): void;
}

function installTestDom(): TestDom {
	const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
	const document = new TestDocument();
	const window = {
		document, Node: TestNode, Element: TestElement, HTMLElement: TestElement,
		HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {},
		getSelection: () => null, location: { protocol: 'http:' },
	};
	document.defaultView = window;
	for (const [key, value] of Object.entries({
		window, document, Node: TestNode, Element: TestElement, HTMLElement: TestElement,
		navigator: { userAgent: 'node-test' },
	})) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const container = document.createElement('div');
	document.body.appendChild(container);
	return Object.freeze({
		container,
		one(selector: string) {
			const found = descendants(container).find((node) => matches(node, selector));
			assert.ok(found, `Missing mounted node ${selector}`);
			return found;
		},
		elements(tagName: string) {
			return descendants(container).filter((node) => node.tagName.toLowerCase() === tagName);
		},
		restore() {
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	});
}

class TestNode {
	readonly childNodes: TestNode[] = [];
	parentNode: TestNode | null = null;
	ownerDocument!: TestDocument;
	constructor(readonly nodeType: number, readonly nodeName: string) {}
	get firstChild(): TestNode | null { return this.childNodes[0] ?? null; }
	get lastChild(): TestNode | null { return this.childNodes.at(-1) ?? null; }
	appendChild<Value extends TestNode>(child: Value): Value { return this.insertBefore(child, null); }
	insertBefore<Value extends TestNode>(child: Value, before: TestNode | null): Value {
		child.parentNode?.removeChild(child);
		const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
		if (index < 0) throw new Error('Mounted DOM insertion point is absent.');
		this.childNodes.splice(index, 0, child); child.parentNode = this; return child;
	}
	removeChild<Value extends TestNode>(child: Value): Value {
		const index = this.childNodes.indexOf(child);
		if (index < 0) throw new Error('Mounted DOM child is absent.');
		this.childNodes.splice(index, 1); child.parentNode = null; return child;
	}
	addEventListener(): void {}
	removeEventListener(): void {}
	get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
	set textContent(value: string) {
		for (const child of this.childNodes) child.parentNode = null;
		this.childNodes.length = 0;
		if (value) this.appendChild(this.ownerDocument.createTextNode(value));
	}
}

class TestText extends TestNode {
	constructor(owner: TestDocument, public nodeValue: string) {
		super(3, '#text'); this.ownerDocument = owner;
	}
	override get textContent(): string { return this.nodeValue; }
	override set textContent(value: string) { this.nodeValue = value; }
}

class TestElement extends TestNode {
	readonly tagName: string;
	readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
	readonly style: Record<string, unknown> = {};
	readonly attributes = new Map<string, string>();
	value = '';
	checked = false;
	disabled = false;
	selected = false;
	multiple = false;
	type = '';
	name = '';
	constructor(owner: TestDocument, tagName: string) {
		super(1, tagName.toUpperCase()); this.ownerDocument = owner; this.tagName = this.nodeName;
	}
	get options(): TestElement[] { return descendants(this).filter((node) => node.tagName === 'OPTION'); }
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
		if (name === 'value') this.value = String(value);
		if (name === 'type') this.type = String(value);
		if (name === 'name') this.name = String(value);
	}
	removeAttribute(name: string): void { this.attributes.delete(name); }
	getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
	hasAttribute(name: string): boolean { return this.attributes.has(name); }
	focus(): void { this.ownerDocument.activeElement = this; }
}

class TestDocument extends TestNode {
	readonly documentElement: TestElement;
	readonly body: TestElement;
	defaultView: unknown;
	activeElement: TestElement | null = null;
	constructor() {
		super(9, '#document'); this.ownerDocument = this;
		this.documentElement = this.createElement('html'); this.body = this.createElement('body');
		this.documentElement.appendChild(this.body); this.appendChild(this.documentElement);
	}
	createElement(tagName: string): TestElement { return new TestElement(this, tagName); }
	createElementNS(_namespace: string, tagName: string): TestElement { return this.createElement(tagName); }
	createTextNode(value: string): TestText { return new TestText(this, value); }
	createComment(value: string): TestText { const node = new TestText(this, value); return node; }
}

function descendants(root: TestNode): TestElement[] {
	return root.childNodes.flatMap((node) => [
		...(node instanceof TestElement ? [node] : []), ...descendants(node),
	]);
}

function matches(node: TestElement, selector: string): boolean {
	const attribute = /^\[([^=]+)="([^"]*)"\]$/u.exec(selector);
	return attribute ? node.getAttribute(attribute[1]!) === attribute[2]!
		: node.tagName.toLowerCase() === selector.toLowerCase();
}
