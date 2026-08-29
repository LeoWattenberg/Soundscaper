/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import type { FramescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import FramescaperOpenFxAddPanel from '../src/common/editor/ui/dialogs/FramescaperOpenFxAddPanel.tsx';
import FramescaperOpenFxManagePanel from '../src/common/editor/ui/dialogs/FramescaperOpenFxManagePanel.tsx';
import FramescaperNativeProjectActionPanel from '../src/common/editor/ui/dialogs/FramescaperNativeProjectActionPanel.tsx';
import type {
	FramescaperNativeServicesBridge,
	FramescaperNativeServicesRendererSnapshot,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import { FRAMESCAPER_NATIVE_SERVICES_COPY } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { createFramescaperNativeProjectActionSubsetRuntime } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import type { FramescaperNativeOpenFxAuthoringRuntimeNativeMedia } from '../src/framescaper/editor-native-openfx-action.ts';
import type { FramescaperOpenFxAuthoringModelNativeMedia } from '../src/framescaper/editor-native-openfx-authoring-model.ts';

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

test('mounted OpenFX manager ignores an older list response after a scan refresh', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const initial = deferred<readonly FramescaperOpenFxPluginProjectionV1[]>();
	const scanned = deferred<readonly FramescaperOpenFxPluginProjectionV1[]>();
	let listCalls = 0;
	const bridge = {
		listOpenFxPlugins: () => (++listCalls === 1 ? initial.promise : scanned.promise),
		scanOpenFxPlugin: async () => null,
		controlOpenFxPlugin: async () => undefined,
	} as unknown as FramescaperNativeServicesBridge;
	const snapshot = {
		services: { snapshotVersion: 1, runtimeAvailable: false, nativeMediaEnabled: false,
			queue: [], roots: [], watchRules: [] },
		capabilitySnapshot: null,
		preferences: { nativeMediaEnabled: false, hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false, ofxConsentEnabled: false },
		controllablePreferences: [], externalDisplays: [], activeExternalDisplayId: null,
	} satisfies FramescaperNativeServicesRendererSnapshot;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperOpenFxManagePanel bridge={bridge}
			copy={FRAMESCAPER_NATIVE_SERVICES_COPY} snapshot={snapshot} busy={false}
			setConsent={() => undefined} />));
		assert.equal(listCalls, 1);
		await act(async () => {
			props(dom.one('[data-framescaper-openfx-scan="true"]')).onClick();
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(listCalls, 2);
		await act(async () => {
			scanned.resolve([openFxPlugin('22', 'net.example.Fresh')]);
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /net\.example\.Fresh/u);
		await act(async () => {
			initial.resolve([openFxPlugin('11', 'net.example.Stale')]);
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /net\.example\.Fresh/u);
		assert.doesNotMatch(dom.container.textContent, /net\.example\.Stale/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('mounted OpenFX authoring retires the prior runtime model while its replacement loads', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const replacement = deferred<FramescaperOpenFxAuthoringModelNativeMedia>();
	const firstRuntime = openFxRuntime(Promise.resolve(openFxAuthoringModel('11', 'Old effect')));
	const replacementRuntime = openFxRuntime(replacement.promise);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => {
			root.render(<FramescaperOpenFxAddPanel runtime={firstRuntime}
				copy={FRAMESCAPER_NATIVE_SERVICES_COPY} />);
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /Old effect/u);

		await act(async () => {
			root.render(<FramescaperOpenFxAddPanel runtime={replacementRuntime}
				copy={FRAMESCAPER_NATIVE_SERVICES_COPY} />);
		});
		assert.doesNotMatch(dom.container.textContent, /Old effect/u);
		assert.match(dom.container.textContent, /loading/iu);

		await act(async () => {
			replacement.resolve(openFxAuthoringModel('22', 'Replacement effect'));
			await replacement.promise;
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /Replacement effect/u);
		assert.doesNotMatch(dom.container.textContent, /Old effect/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function openFxRuntime(
	modelPromise: Promise<FramescaperOpenFxAuthoringModelNativeMedia>,
): FramescaperNativeOpenFxAuthoringRuntimeNativeMedia {
	return {
		model: () => modelPromise,
		author: async () => undefined,
		interactModel: async () => ({ instances: [] }),
		commitInteract: async () => { throw new Error('Interact is not used by this fixture.'); },
	};
}

function openFxAuthoringModel(
	handleByte: string,
	pluginId: string,
): FramescaperOpenFxAuthoringModelNativeMedia {
	return {
		plugins: [openFxPlugin(handleByte, pluginId)],
		targets: [{
			context: 'filter', targetId: `${pluginId}-target`, label: `${pluginId} target`,
			instanceId: null, inputs: [{ name: 'Source', sourceRef: `${pluginId}-source` }],
		}],
	};
}

function openFxPlugin(
	handleByte: string,
	pluginId: string,
): FramescaperOpenFxPluginProjectionV1 {
	return {
		pluginHandle: handleByte.repeat(20), pluginId, vendor: 'Example', version: { major: 1, minor: 0 },
		binarySha256: handleByte.repeat(32), supportedContexts: ['filter'], parameters: [],
		components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
		state: 'consented', quarantined: false,
	};
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}

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
