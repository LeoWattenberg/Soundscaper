/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
} from '../src/framescaper/editor-video-proxy-action-runtime.ts';

test('preview mode changes settle in intent order and ignore an older failure', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const first = deferred<void>();
	const second = deferred<void>();
	const calls: string[] = [];
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: (_sourceId, mode) => {
			calls.push(mode);
			return mode === 'proxy' ? first.promise : second.promise;
		},
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false}
			copy={{}}
			fileService={{}}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		const mode = dom.elements('select')[1];
		assert.ok(mode);
		await change(mode, 'proxy');
		await change(mode, 'original');
		assert.deepEqual(calls, ['proxy'], 'the newer intent waits for the older mutation');
		await act(async () => {
			first.reject(new Error('obsolete proxy failure'));
			await first.promise.catch(() => undefined);
			await Promise.resolve();
		});
		assert.deepEqual(calls, ['proxy', 'original']);
		await act(async () => {
			second.resolve();
			await second.promise;
			await Promise.resolve();
		});
		assert.doesNotMatch(dom.container.textContent, /obsolete proxy failure/u);
		assert.match(dom.container.textContent, /preview mode updated/iu);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a rejected preview mode change restores the mode the runtime still owns', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const mutation = deferred<void>();
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: () => mutation.promise,
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false}
			copy={{}}
			fileService={{}}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		const mode = dom.elements('select')[1];
		assert.ok(mode);
		await change(mode, 'proxy');
		assert.equal(mode.value, 'proxy');

		await act(async () => {
			mutation.reject(new Error('verified proxy unavailable'));
			await mutation.promise.catch(() => undefined);
			await new Promise<void>((resolve) => { setImmediate(resolve); });
		});

		assert.match(dom.container.textContent, /verified proxy unavailable/u);
		assert.equal(dom.elements('select')[1]?.getAttribute('data-video-proxy-preview-mode'), 'auto');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function project() {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		sources: [{ kind: 'video', id: 'video-source', name: 'Camera', proxyAttachment: null }],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source' }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (reason: unknown) => void;
}> {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
	return Object.freeze({ promise, resolve, reject });
}

async function change(node: TestElement, value: string): Promise<void> {
	await act(async () => {
		node.value = value;
		props(node).onChange({ currentTarget: node, target: node });
		await Promise.resolve();
	});
}

function props(node: TestElement): Record<string, (...args: unknown[]) => unknown> {
	const key = Reflect.ownKeys(node).find((candidate) => (
		typeof candidate === 'string' && candidate.startsWith('__reactProps$')
	));
	assert.equal(typeof key, 'string');
	return node[key as keyof TestElement] as unknown as Record<string, (...args: unknown[]) => unknown>;
}

interface TestDom {
	readonly container: TestElement;
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
		navigator: { userAgent: 'node-test' }, requestAnimationFrame: (): number => 1,
		cancelAnimationFrame: (_handle: number): void => undefined,
	})) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const container = document.createElement('div');
	document.body.appendChild(container);
	return Object.freeze({
		container,
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
	readonly style = new TestStyle();
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

class TestStyle {
	readonly values = new Map<string, string>();
	setProperty(name: string, value: string): void { this.values.set(name, value); }
	removeProperty(name: string): string {
		const value = this.values.get(name) ?? '';
		this.values.delete(name);
		return value;
	}
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
	createComment(value: string): TestText { return new TestText(this, value); }
}

function descendants(root: TestNode): TestElement[] {
	return root.childNodes.flatMap((node) => [
		...(node instanceof TestElement ? [node] : []), ...descendants(node),
	]);
}
