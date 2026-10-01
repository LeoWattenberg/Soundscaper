/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The transfer page module, exercised the way a browser actually loads it.
 *
 * The generated documents in `scripts/generate-static-routes.mjs` load exactly
 * one script - the built page chunk - and nothing on those pages ever calls an
 * exported function. So every test here drives the module's **load side
 * effect** against a fake DOM: it installs a document and a location, imports
 * the module, and then looks at what the document became. A test that called
 * `mountTransferPageFromLocation()` itself would pass against a module that
 * only ever declares the mount, which is exactly the regression that shipped.
 *
 * The fake DOM is deliberately hand-rolled and tiny. The page's whole contract
 * with the document is a dozen calls wide, and a real DOM implementation would
 * hide which of them the page depends on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeFor } from './project-transfer-runtime-fixture.ts';

import { TRANSFER_ROUTES } from '../src/common/transfer/transfer-routes.js';
import {
	transferProjectProduct,
	transferProductForOrigin,
	listTransferProjects,
} from '../src/common/transfer/transfer-project-selection.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../src/common/editor/project-schema-identity.ts';
import { FakeStore, createFakeArchive } from './project-transfer-bundle-fixture.ts';
import { FakeElement } from './project-transfer-page-fixture.ts';

const PAGE_MODULE = new URL('../src/common/transfer/transfer-page-entry.ts', import.meta.url).href;
const SEND_ROUTE = TRANSFER_ROUTES.find((route) => route.role === 'send')!;
const RECEIVE_ROUTE = TRANSFER_ROUTES.find((route) => route.role === 'receive')!;

let loadCounter = 0;

/**
 * Load a fresh copy of the page module with `scope` installed as the globals it
 * reads, and return the document it did or did not touch.
 *
 * The query string is what makes each load a real evaluation rather than a
 * cache hit, so each case observes its own module-scope side effect.
 */
async function loadPageModule(scope: FakeScope | null): Promise<Record<string, unknown>> {
	loadCounter += 1;
	const saved = {
		document: Reflect.get(globalThis, 'document'),
		location: Reflect.get(globalThis, 'location'),
		opener: Reflect.get(globalThis, 'opener'),
	};
	if (scope) {
		Reflect.set(globalThis, 'document', scope.document);
		Reflect.set(globalThis, 'location', scope.location);
		Reflect.set(globalThis, 'opener', scope.opener);
	} else {
		Reflect.deleteProperty(globalThis, 'document');
	}
	try {
		return await import(`${PAGE_MODULE}?mount-case=${loadCounter}`) as Record<string, unknown>;
	} finally {
		if (saved.document === undefined) Reflect.deleteProperty(globalThis, 'document');
		else Reflect.set(globalThis, 'document', saved.document);
		if (saved.location !== undefined) Reflect.set(globalThis, 'location', saved.location);
		if (saved.opener === undefined) Reflect.deleteProperty(globalThis, 'opener');
		else Reflect.set(globalThis, 'opener', saved.opener);
	}
}

/** Let the mount's own promise chain and dynamic imports settle. */
async function settle(times = 12): Promise<void> {
	for (let index = 0; index < times; index += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (let index = 0; index < times; index += 1) await Promise.resolve();
}

test('loading the page chunk mounts the sending page, with nobody calling the export', async () => {
	const scope = createScope(SEND_ROUTE.path);
	await loadPageModule(scope);
	await settle();

	assert.deepEqual(
		scope.document.body.textOf('h1'),
		[SEND_ROUTE.title],
		'the generated document loads only this chunk, so evaluating it has to mount the page',
	);
	assert.ok(
		scope.document.body.buttonLabels().includes('Find my projects'),
		`the mounted page must offer its first action; saw ${JSON.stringify(scope.document.body.buttonLabels())}`,
	);
	assert.equal(
		scope.document.body.textOf('[data-transfer-boot]').length,
		0,
		'the boot placeholder must be replaced by the mounted view',
	);
});

test('loading the page chunk mounts the receiving page too', async () => {
	const scope = createScope(RECEIVE_ROUTE.path);
	await loadPageModule(scope);
	await settle();

	assert.deepEqual(scope.document.body.textOf('h1'), [RECEIVE_ROUTE.title]);
	assert.equal(scope.document.body.count('input[type=file]'), 1);
});

test('loading the page chunk on an unrelated route mounts nothing and throws nothing', async () => {
	const scope = createScope('/editor/');
	const namespace = await loadPageModule(scope);
	await settle();

	assert.equal(typeof namespace.mountTransferPageFromLocation, 'function');
	assert.deepEqual(scope.document.body.textOf('h1'), []);
	assert.equal(scope.document.body.count('button'), 0);
});

test('loading the page chunk with no document at all throws nothing', async () => {
	const namespace = await loadPageModule(null);
	await settle();
	assert.equal(typeof namespace.mountTransferPageFromLocation, 'function');
});

test('the self-mount cannot be doubled by route.js driving the export as well', async () => {
	const scope = createScope(SEND_ROUTE.path);
	const namespace = await loadPageModule(scope);
	await settle();
	const afterAutoMount = scope.document.body.buttonLabels();
	assert.ok(afterAutoMount.length > 0);

	// This is exactly what src/common/site/route.js does on the dev server.
	const mount = namespace.mountTransferPageFromLocation as (scope: unknown) => Promise<void>;
	await mount(scope);
	await settle();

	assert.deepEqual(
		scope.document.body.buttonLabels(),
		afterAutoMount,
		'a second mount would open a second handshake on the same window',
	);
});

test('the sender lists projects for confirmation and sends only what was ticked', async () => {
	const scope = createScope(SEND_ROUTE.path, 'https://soundscaper.org');
	const store = new FakeStore([
		{
			id: 'audio-1', title: 'Field recording',
			schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, schemaVersion: PROJECT_SCHEMA_VERSION,
		},
		{
			id: 'video-1', title: 'Interview cut',
			schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY, schemaVersion: PROJECT_SCHEMA_VERSION,
		},
		{
			id: 'video-2', title: 'Title sequence',
			schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY, schemaVersion: PROJECT_SCHEMA_VERSION,
		},
	] as never);
	const archive = createFakeArchive();
	const namespace = await loadPageModule(scope);
	await settle();

	const mount = namespace.mountTransferPage as (options: unknown) => Promise<void>;
	const other = createScope(SEND_ROUTE.path, 'https://soundscaper.org');
	await mount({
		scope: other,
		role: 'send',
		configuration: {
			selfOrigin: 'https://soundscaper.org',
			peerOrigin: 'https://framescaper.org',
			allowedOrigins: ['https://soundscaper.org', 'https://framescaper.org'],
			loopback: false,
		},
		dependencies: {
			loadRuntime: async () => runtimeFor(archive),
			openStore: async () => ({ id: 'fake', label: 'Fake', store, close: async () => undefined }),
		},
	});
	await settle();

	await other.document.body.clickButton('Find my projects');
	await settle();

	// Every project in the origin's store is listed, and only the peer product's
	// projects start ticked. Nothing has been exported yet.
	assert.deepEqual(archive.exportCalls, [], 'listing must not export anything');
	const boxes = other.document.body.checkboxes();
	assert.deepEqual(
		boxes.map((box) => [box.value, box.checked]),
		[
			['soundscaper:audio-1', false],
			['framescaper:video-1', true],
			['framescaper:video-2', true],
		],
	);

	// Untick one of the peer-product projects, then confirm.
	boxes[2].checked = false;
	await other.document.body.clickButton(/^Send /u);
	await settle();
	assert.deepEqual(
		archive.exportCalls,
		[],
		'the confirmation step must run before any project is read',
	);
	const confirmation = other.document.body.textOf('[data-transfer-confirm]').join(' ');
	assert.match(confirmation, /Interview cut/u);
	assert.doesNotMatch(confirmation, /Title sequence/u);
	assert.doesNotMatch(confirmation, /Field recording/u);

	// And when a project is finally read, it is only the ticked one. The
	// download path is the one that needs no popup, so it is where this is
	// observable; both paths are handed the same selection predicate.
	await other.document.body.clickButton('Download the ticked archives');
	await settle();
	assert.deepEqual(
		archive.exportCalls,
		['video-1'],
		'a project the visitor did not tick must never be read, let alone leave the origin',
	);
	assert.deepEqual(other.saved, ['Interview cut.scape']);
});

test('product classification keys off the family and never a bare version', () => {
	assert.equal(transferProjectProduct({
		id: 'a', schemaFamily: 'soundscaper', schemaVersion: 1,
	}), 'soundscaper');
	assert.equal(transferProjectProduct({
		id: 'a', schemaFamily: 'framescaper', schemaVersion: 1,
	}), 'framescaper');
	assert.equal(transferProjectProduct({ id: 'a', schemaVersion: 30 }), null);
	assert.equal(transferProjectProduct({ id: 'a', schemaVersion: 31 }), null);
	assert.equal(transferProjectProduct({ id: 'a' }), null);
	assert.equal(transferProductForOrigin('https://framescaper.org'), 'framescaper');
	assert.equal(transferProductForOrigin('https://soundscaper.org'), 'soundscaper');
	assert.equal(transferProductForOrigin('http://localhost:5173'), null);
});

test('listing offers every project but only preselects the peer product', async () => {
	const store = new FakeStore([
		{ id: 'audio-1', title: 'Field recording', schemaFamily: 'soundscaper', schemaVersion: 1 },
		{ id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1 },
		{ id: 'mystery', title: 'Unknown', schemaVersion: 999 },
	] as never);
	const listing = await listTransferProjects({ store, product: 'framescaper' });
	assert.deepEqual(listing.map((row) => [row.projectId, row.product, row.preselected]), [
		['soundscaper:audio-1', 'soundscaper', false],
		['framescaper:video-1', 'framescaper', true],
		['mystery', null, false],
	]);
	// With no peer product to key off - a loopback exercise - nothing is preselected.
	const loopback = await listTransferProjects({ store, product: null });
	assert.deepEqual(loopback.map((row) => row.preselected), [false, false, false]);
});


/* ---------------------------------------------------------------------- */
/* The fake DOM.                                                          */
/* ---------------------------------------------------------------------- */

interface FakeScope {
	readonly document: FakeDocument;
	readonly location: { pathname: string; origin: string };
	readonly opener: unknown;
	readonly crypto: { randomUUID(): string };
	/** File names the page handed to the browser to save. */
	readonly saved: string[];
	open(): null;
	setTimeout(callback: () => void, milliseconds: number): unknown;
	clearTimeout(handle: unknown): void;
	readonly URL: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
}

function createScope(pathname: string, origin = 'http://localhost:5173'): FakeScope {
	const document = new FakeDocument();
	const saved: string[] = [];
	document.onDownload = (fileName) => saved.push(fileName);
	return {
		document,
		location: { pathname, origin },
		opener: null,
		crypto: { randomUUID: () => 'fake-session-id' },
		saved,
		// A blocked popup: the send path has to report it rather than export.
		open: () => null,
		setTimeout: (callback: () => void, milliseconds: number) => {
			// The page revokes its object URLs a minute later; an unreferenced
			// timer keeps that from holding the test runner open that long.
			const handle = setTimeout(callback, milliseconds);
			(handle as { unref?: () => void }).unref?.();
			return handle;
		},
		clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined },
	};
}

class FakeDocument {
	readonly head = new FakeElement('head');
	readonly body = new FakeElement('body');
	readonly documentElement = new FakeElement('html');

	constructor() {
		const main = new FakeElement('main');
		main.dataset.transferRole = 'send';
		this.body.append(main);
		const boot = new FakeElement('p');
		boot.dataset.transferBoot = '';
		boot.textContent = 'Loading the transfer tools…';
		main.append(boot);
		this.#byId.set('transfer', main);
	}

	readonly #byId = new Map<string, FakeElement>();

	getElementById(id: string): FakeElement | null {
		return this.#byId.get(id) ?? null;
	}

	/** Notified when the page hands the browser a file to save. */
	onDownload: ((fileName: string) => void) | null = null;

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
}
