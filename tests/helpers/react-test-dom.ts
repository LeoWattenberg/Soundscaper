/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

export interface ReactTestDom {
	readonly container: ReactTestElement;
	find(selector: string): ReactTestElement | null;
	one(selector: string): ReactTestElement;
	restore(): void;
}

export function installReactTestDom(): ReactTestDom {
	const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
	const document = new ReactTestDocument();
	const window = {
		document, Node: ReactTestNode, Element: ReactTestElement, HTMLElement: ReactTestElement,
		HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {},
		getSelection: () => null, location: { protocol: 'http:' },
	};
	document.defaultView = window;
	for (const [key, value] of Object.entries({
		window, document, Node: ReactTestNode, Element: ReactTestElement,
		HTMLElement: ReactTestElement, navigator: { userAgent: 'node-test' },
		requestAnimationFrame: (): number => 1,
		cancelAnimationFrame: (_handle: number): void => undefined,
	})) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const container = document.createElement('div');
	document.body.appendChild(container);
	const find = (selector: string): ReactTestElement | null => (
		descendants(container).find((node) => matches(node, selector)) ?? null
	);
	return Object.freeze({
		container,
		find,
		one(selector: string) {
			const found = find(selector);
			assert.ok(found, `Missing mounted node ${selector}`);
			return found;
		},
		restore() {
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	});
}

export function reactProps(
	node: ReactTestElement,
): Readonly<Record<string, (...args: unknown[]) => unknown>> {
	const key = Reflect.ownKeys(node).find((candidate) => (
		typeof candidate === 'string' && candidate.startsWith('__reactProps$')
	));
	assert.equal(typeof key, 'string');
	return node[key as keyof ReactTestElement] as unknown as Readonly<Record<string, (...args: unknown[]) => unknown>>;
}

class ReactTestNode {
	readonly childNodes: ReactTestNode[] = [];
	parentNode: ReactTestNode | null = null;
	ownerDocument!: ReactTestDocument;
	constructor(readonly nodeType: number, readonly nodeName: string) {}
	get firstChild(): ReactTestNode | null { return this.childNodes[0] ?? null; }
	get lastChild(): ReactTestNode | null { return this.childNodes.at(-1) ?? null; }
	get isConnected(): boolean {
		return this.parentNode ? this.parentNode.isConnected : this.nodeType === 9;
	}
	contains(candidate: unknown): boolean {
		return candidate === this || this.childNodes.some((child) => child.contains(candidate));
	}
	appendChild<Value extends ReactTestNode>(child: Value): Value { return this.insertBefore(child, null); }
	insertBefore<Value extends ReactTestNode>(child: Value, before: ReactTestNode | null): Value {
		child.parentNode?.removeChild(child);
		const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
		if (index < 0) throw new Error('Mounted DOM insertion point is absent.');
		this.childNodes.splice(index, 0, child);
		child.parentNode = this;
		return child;
	}
	removeChild<Value extends ReactTestNode>(child: Value): Value {
		const index = this.childNodes.indexOf(child);
		if (index < 0) throw new Error('Mounted DOM child is absent.');
		this.childNodes.splice(index, 1);
		child.parentNode = null;
		return child;
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

class ReactTestText extends ReactTestNode {
	constructor(owner: ReactTestDocument, public nodeValue: string) {
		super(3, '#text');
		this.ownerDocument = owner;
	}
	override get textContent(): string { return this.nodeValue; }
	override set textContent(value: string) { this.nodeValue = value; }
}

export class ReactTestElement extends ReactTestNode {
	readonly tagName: string;
	readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
	readonly style = new ReactTestStyle();
	readonly attributes = new Map<string, string>();
	value = '';
	checked = false;
	disabled = false;
	selected = false;
	multiple = false;
	type = '';
	name = '';
	constructor(owner: ReactTestDocument, tagName: string) {
		super(1, tagName.toUpperCase());
		this.ownerDocument = owner;
		this.tagName = this.nodeName;
	}
	get options(): ReactTestElement[] {
		return descendants(this).filter((node) => node.tagName === 'OPTION');
	}
	querySelector(selector: string): ReactTestElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	querySelectorAll(selector: string): ReactTestElement[] {
		return descendants(this).filter((node) => matchesSelectorList(node, selector));
	}
	closest(selector: string): ReactTestElement | null {
		if (matchesSelectorList(this, selector)) return this;
		return this.parentNode instanceof ReactTestElement ? this.parentNode.closest(selector) : null;
	}
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

class ReactTestStyle {
	readonly values = new Map<string, string>();
	setProperty(name: string, value: string): void { this.values.set(name, value); }
	removeProperty(name: string): string {
		const value = this.values.get(name) ?? '';
		this.values.delete(name);
		return value;
	}
}

class ReactTestDocument extends ReactTestNode {
	readonly documentElement: ReactTestElement;
	readonly body: ReactTestElement;
	defaultView: unknown;
	activeElement: ReactTestElement | null = null;
	constructor() {
		super(9, '#document');
		this.ownerDocument = this;
		this.documentElement = this.createElement('html');
		this.body = this.createElement('body');
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
	}
	createElement(tagName: string): ReactTestElement { return new ReactTestElement(this, tagName); }
	createElementNS(_namespace: string, tagName: string): ReactTestElement {
		return this.createElement(tagName);
	}
	createTextNode(value: string): ReactTestText { return new ReactTestText(this, value); }
	createComment(value: string): ReactTestText { return new ReactTestText(this, value); }
}

function descendants(root: ReactTestNode): ReactTestElement[] {
	return root.childNodes.flatMap((node) => [
		...(node instanceof ReactTestElement ? [node] : []), ...descendants(node),
	]);
}

function matches(node: ReactTestElement, selector: string): boolean {
	const negated = /^(.*):not\((.*)\)$/u.exec(selector);
	if (negated) return matches(node, negated[1]!) && !matches(node, negated[2]!);
	const attribute = /^\[([^=]+)="([^"]*)"\]$/u.exec(selector);
	if (attribute) return node.getAttribute(attribute[1]!) === attribute[2]!;
	const presentAttribute = /^\[([^\]]+)\]$/u.exec(selector);
	if (presentAttribute) return node.hasAttribute(presentAttribute[1]!);
	if (selector.startsWith('.')) {
		return (node.getAttribute('class') ?? '').split(/\s+/u).includes(selector.slice(1));
	}
	return node.tagName.toLowerCase() === selector.toLowerCase();
}

function matchesSelectorList(node: ReactTestElement, selectors: string): boolean {
	return selectors.split(',').some((selector) => matches(node, selector.trim()));
}
