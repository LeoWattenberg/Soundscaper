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
		// Components that defer work through the window timers rather than the
		// bare globals still have to run under the fake document.
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
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
	declare parentNode: ReactTestNode | null;
	declare ownerDocument: ReactTestDocument;
	constructor(readonly nodeType: number, readonly nodeName: string) {
		// The upward links stay hidden from inspection so a printed node shows
		// its own subtree rather than the whole document above it.
		Object.defineProperty(this, 'parentNode', { value: null, writable: true, configurable: true, enumerable: false });
		Object.defineProperty(this, 'ownerDocument', { value: undefined, writable: true, configurable: true, enumerable: false });
	}
	// A failing assertion prints its operands with util.inspect. Mounted nodes
	// carry React's fiber links, so the default deep inspection walks the whole
	// reconciler graph and exhausts memory before the message is ever shown.
	[Symbol.for('nodejs.util.inspect.custom')](): string { return this.nodeName; }
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

// React attaches its fiber and props records to every host node as plain
// own properties (`__reactFiber$…`, `__reactProps$…`). Those keys reach the
// whole reconciler graph, and Node's assertion errors print operands with
// `customInspect: false` at depth 1000, so a failed comparison against a
// mounted node once walked that graph until the process ran out of memory.
// A proxy in the prototype chain sees every assignment of a missing property
// and records React's keys as non-enumerable, which keeps them out of inspect.
Object.setPrototypeOf(ReactTestNode.prototype, new Proxy(Object.create(Object.prototype) as object, {
	set(target, key, value, receiver: object) {
		if (typeof key === 'string' && key.startsWith('__react')) {
			Object.defineProperty(receiver, key, { value, writable: true, configurable: true, enumerable: false });
			return true;
		}
		return Reflect.set(target, key, value, receiver);
	},
}));

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
	clickCount = 0;
	constructor(owner: ReactTestDocument, tagName: string) {
		super(1, tagName.toUpperCase());
		this.ownerDocument = owner;
		this.tagName = this.nodeName;
	}
	get options(): ReactTestElement[] {
		return descendants(this).filter((node) => node.tagName === 'OPTION');
	}
	// The fake tree has no layout, so every box is empty at the origin. Real
	// elements always answer this, and overlays that measure themselves would
	// otherwise throw rather than simply position at zero.
	getBoundingClientRect(): Readonly<Record<string, number>> {
		return Object.freeze({
			x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
		});
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
	// Nothing dispatches here, so a programmatic click is only ever recorded.
	// A surface that starts a download by pressing its own link is verified by
	// counting the presses rather than by a navigation the fake tree cannot make.
	click(): void { this.clickCount += 1; }
	// TypeScript forbids `override` on a computed name; this still replaces the
	// node-level inspector above.
	[Symbol.for('nodejs.util.inspect.custom')](): string {
		const attributes = [...this.attributes].map(([name, value]) => ` ${name}="${value}"`).join('');
		return `<${this.tagName.toLowerCase()}${attributes}>`;
	}
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
