/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A window, a document, and the browser seams the two transfer pages reach for.
 *
 * Hand-rolled rather than a real DOM, because the page's contract with a window
 * is small and a real one would hide which parts of it the page depends on.
 * Shared by every test that drives `mountTransferPage()` against a fake origin
 * pair: the harness is three hundred lines, and a second copy of it is a second
 * place for the page's contract to drift.
 */

import assert from 'node:assert/strict';

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settleWith) => {
		resolve = settleWith;
	});
	return { promise, resolve };
}

/** Let the page's promise chain and the protocol's microtasks run out. */
export async function settle(times = 24): Promise<void> {
	for (let index = 0; index < times; index += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * A clock for the receiving side that cannot make the test wait ten minutes.
 *
 * It exists for the failure mode: if the sender's `ready` is dropped, the
 * receiver waits out its whole acknowledgement budget, and the test needs that
 * to be a fast failure rather than a hang.
 */
export function boundedClock() {
	return {
		setTimeout: (callback: () => void, milliseconds: number): unknown => {
			const handle = setTimeout(callback, Math.min(milliseconds, 250));
			(handle as { unref?: () => void }).unref?.();
			return handle;
		},
		clearTimeout: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
	};
}

/**
 * The sending page arms its own acknowledgement timer on the global clock, and
 * these tests cannot inject one into it. Unreferencing whatever is armed while
 * the body runs keeps a *failing* assertion from leaving a ten-minute timer
 * holding the runner open behind it.
 */
export async function withUnreferencedTimers(run: () => Promise<void>): Promise<void> {
	const real = globalThis.setTimeout;
	globalThis.setTimeout = ((callback: () => void, milliseconds?: number, ...rest: unknown[]) => {
		const handle = (real as (...args: unknown[]) => unknown)(callback, milliseconds, ...rest);
		(handle as { unref?: () => void }).unref?.();
		return handle;
	}) as typeof globalThis.setTimeout;
	try {
		await run();
	} finally {
		globalThis.setTimeout = real;
	}
}

export interface FakeMessageEvent {
	readonly origin: unknown;
	readonly data: unknown;
	readonly source?: unknown;
}

export class FakeWindow {
	readonly listeners = new Set<(event: FakeMessageEvent) => void>();
	readonly document = new FakeDocument();
	readonly location: { pathname: string; origin: string };
	readonly crypto = { randomUUID: () => 'fake-session-id' };
	readonly saved: string[] = [];
	readonly blobs = new BlobLedger();
	opener: unknown = null;
	peer: FakeWindow | null = null;
	closed = false;
	opens: (() => FakeWindow | null) = () => null;
	opened = 0;

	constructor(readonly origin: string) {
		this.location = { pathname: '/transfer/send/', origin };
		this.document.onDownload = (fileName) => this.saved.push(fileName);
	}

	open(): FakeWindow | null {
		this.opened += 1;
		return this.opens();
	}

	postMessage(data: unknown, _targetOrigin: string): void {
		const from = this.peer;
		if (!from) return;
		const cloned = structuredClone(data);
		queueMicrotask(() => {
			for (const listener of [...this.listeners]) {
				listener({ origin: from.origin, data: cloned, source: from });
			}
		});
	}

	addEventListener(_type: 'message', listener: (event: FakeMessageEvent) => void): void {
		this.listeners.add(listener);
	}

	removeEventListener(_type: 'message', listener: (event: FakeMessageEvent) => void): void {
		this.listeners.delete(listener);
	}

	setTimeout(callback: () => void, milliseconds: number): unknown {
		const handle = setTimeout(callback, milliseconds);
		(handle as { unref?: () => void }).unref?.();
		return handle;
	}

	clearTimeout(handle: unknown): void {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	}

	get URL(): { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void } {
		return this.blobs.seam();
	}
}

/** Counts how many archive blobs are reachable through object URLs at once. */
export class BlobLedger {
	readonly revoked: string[] = [];
	live = 0;
	peak = 0;
	#issued = 0;

	seam() {
		return {
			createObjectURL: (): string => {
				this.#issued += 1;
				this.live += 1;
				this.peak = Math.max(this.peak, this.live);
				return `blob:fake/${this.#issued}`;
			},
			revokeObjectURL: (url: string): void => {
				this.revoked.push(url);
				this.live -= 1;
			},
		};
	}
}

export class FakeElement {
	readonly children: FakeElement[] = [];
	readonly dataset: Record<string, string> = {};
	readonly attributes = new Map<string, string>();
	readonly listeners = new Map<string, ((event?: unknown) => void)[]>();
	parent: FakeElement | null = null;
	disabled = false;
	checked = false;
	value = '';
	type = '';
	accept = '';
	multiple = false;
	files: unknown[] | null = null;
	href = '';
	download = '';
	rel = '';
	#text = '';

	constructor(readonly tagName: string) {}

	get textContent(): string {
		return this.#text || this.children.map((child) => child.textContent).join('');
	}

	set textContent(value: string) {
		this.children.length = 0;
		this.#text = String(value);
	}

	append(...nodes: FakeElement[]): void {
		for (const node of nodes) {
			node.parent = this;
			this.children.push(node);
		}
		if (nodes.length) this.#text = '';
	}

	appendChild(node: FakeElement): FakeElement {
		this.append(node);
		return node;
	}

	replaceChildren(...nodes: FakeElement[]): void {
		this.children.length = 0;
		this.#text = '';
		this.append(...nodes);
	}

	insertBefore(node: FakeElement, reference: FakeElement | null): FakeElement {
		const at = reference ? this.children.indexOf(reference) : -1;
		node.parent = this;
		if (at < 0) this.children.push(node);
		else this.children.splice(at, 0, node);
		return node;
	}

	remove(): void {
		const at = this.parent?.children.indexOf(this) ?? -1;
		if (at >= 0) this.parent?.children.splice(at, 1);
		this.parent = null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	addEventListener(type: string, listener: (event?: unknown) => void): void {
		const bucket = this.listeners.get(type) ?? [];
		bucket.push(listener);
		this.listeners.set(type, bucket);
	}

	removeEventListener(): void {}

	click(): void {
		for (const listener of this.listeners.get('click') ?? []) listener({ target: this });
	}

	descendants(): FakeElement[] {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}

	matches(selector: string): boolean {
		if (selector.startsWith('[') && selector.endsWith(']')) {
			const [name, value] = selector.slice(1, -1).split('=');
			const key = name.replace(/^data-/u, '').replace(/-(\w)/gu, (_, letter: string) => letter.toUpperCase());
			const held = name.startsWith('data-')
				? this.dataset[key]
				: this.getAttribute(name) ?? (this as unknown as Record<string, unknown>)[name];
			if (held === undefined || held === null) return false;
			return value === undefined || held === value.replaceAll('"', '');
		}
		const [tag, rest] = selector.split(/(?=\[)/u);
		if (tag && this.tagName !== tag) return false;
		return rest === undefined || this.matches(rest);
	}

	querySelector(selector: string): FakeElement | null {
		return this.descendants().find((node) => node.matches(selector)) ?? null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		return this.descendants().filter((node) => node.matches(selector));
	}
}

export class FakeDocument {
	readonly head = new FakeElement('head');
	readonly body = new FakeElement('body');
	readonly #byId = new Map<string, FakeElement>();

	constructor() {
		const main = new FakeElement('main');
		this.body.append(main);
		this.#byId.set('transfer', main);
	}

	onDownload: ((fileName: string) => void) | null = null;

	getElementById(id: string): FakeElement | null {
		return this.#byId.get(id) ?? null;
	}

	createElement(tagName: string): FakeElement {
		const element = new FakeElement(tagName);
		if (tagName === 'a') {
			element.click = () => {
				if (element.download) this.onDownload?.(element.download);
			};
		}
		return element;
	}

	createTextNode(text: string): FakeElement {
		const node = new FakeElement('#text');
		node.textContent = text;
		return node;
	}

	querySelector(selector: string): FakeElement | null {
		return this.head.querySelector(selector) ?? this.body.querySelector(selector);
	}

	querySelectorAll(selector: string): FakeElement[] {
		return [...this.head.querySelectorAll(selector), ...this.body.querySelectorAll(selector)];
	}

	/** Whether the rendered report called itself complete. */
	completeFlag(): string | null {
		return this.body.querySelector('[data-complete]')?.dataset.complete ?? null;
	}

	/** The report line the page writes its summary into. */
	summaryText(): string {
		return this.querySelectorAll('p')
			.map((node) => node.textContent)
			.join(' | ');
	}

	/**
	 * Every row of the rendered *result* list, as the visitor reads them.
	 *
	 * Only the result rows carry an outcome, which is what keeps the project
	 * chooser's own list - same tag, same document - out of the answer.
	 */
	rowText(): string[] {
		return this.querySelectorAll('li[data-outcome]').map((node) => node.textContent);
	}

	/** The live status line, which is a different sentence from the summary. */
	statusText(): string {
		return this.body.querySelector('p[role="status"]')?.textContent ?? '';
	}

	async clickButton(label: string | RegExp): Promise<void> {
		const button = this.body.querySelectorAll('button').find((node) => (
			typeof label === 'string' ? node.textContent === label : label.test(node.textContent)
		));
		assert.ok(button, `no button matching ${String(label)} in ${JSON.stringify(
			this.body.querySelectorAll('button').map((node) => node.textContent),
		)}`);
		button.click();
		await Promise.resolve();
	}
}
