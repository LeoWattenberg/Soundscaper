/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FramescaperAudioEditorBootstrap, {
	createFramescaperWebEditorRuntime,
} from '../src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

interface StorageLog {
	opens: number;
	closes: number;
	closeFailure: Error | null;
}

interface FileServiceProbe {
	readonly kind: string;
	readonly isDesktop: boolean;
	readonly bridge: unknown;
}

interface ControllerProbe {
	readonly actions: Readonly<{
		readonly project: Readonly<{ rename: (title: string) => unknown }>;
	}>;
}

/**
 * The bootstrap opens its own store from the globals, so the only seam for
 * observing environment closure is the database handle the fake factory hands
 * back. Wrapping `close` also lets a refused close drive the disposal failures.
 */
function trackedIndexedDB(closeFailure: Error | null = null) {
	const inner = createInstrumentedIndexedDB() as unknown as {
		open(name: string, version?: number): { result: unknown };
	};
	const log: StorageLog = { opens: 0, closes: 0, closeFailure };
	const wrapped = new WeakSet<object>();
	const factory = {
		...(inner as unknown as Record<string, unknown>),
		open(name: string, version?: number) {
			log.opens += 1;
			const request = inner.open(name, version);
			let held: unknown = null;
			Object.defineProperty(request, 'result', {
				configurable: true,
				get: () => held,
				set: (database: unknown) => {
					held = database;
					if (!database || typeof database !== 'object' || wrapped.has(database)) return;
					wrapped.add(database);
					const close = (database as { close(): void }).close.bind(database);
					Object.defineProperty(database, 'close', {
						configurable: true,
						writable: true,
						value: () => {
							log.closes += 1;
							close();
							if (log.closeFailure) throw log.closeFailure;
						},
					});
				},
			});
			return request;
		},
	};
	return { factory: factory as unknown as IDBFactory, log };
}

function installBrowser(extra: Readonly<Record<string, unknown>> = {}): () => void {
	const prior = new Map<string, PropertyDescriptor | undefined>();
	const values: Record<string, unknown> = {
		navigator: {
			userAgent: 'node-test',
			storage: {
				estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
				persisted: async () => true,
				persist: async () => true,
			},
		},
		...extra,
	};
	for (const [key, value] of Object.entries(values)) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true, writable: true, enumerable: true, value,
		});
	}
	return () => {
		for (const [key, descriptor] of prior) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	};
}

/** A `document` whose element access throws is the seam for a failing controller. */
function hostileDocument(failure: Error): Record<string, unknown> {
	return { get documentElement(): unknown { throw failure; } };
}

async function withBrowser(
	extra: Readonly<Record<string, unknown>>,
	body: (log: StorageLog) => Promise<void>,
	closeFailure: Error | null = null,
): Promise<void> {
	const tracked = trackedIndexedDB(closeFailure);
	const restore = installBrowser({ indexedDB: tracked.factory, ...extra });
	try {
		await body(tracked.log);
	} finally {
		restore();
	}
}

function frozenDesktopGlobal(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		v1: Object.freeze({
			nativeServices: Object.freeze({
				snapshot: async () => ({ services: [] }),
				control: async () => undefined,
				reorder: async () => undefined,
				remove: async () => undefined,
			}),
		}),
	});
}

test('a presentation that is not a plain closed record is refused before storage is opened', async () => {
	await withBrowser({}, async (log) => {
		for (const value of [
			null, undefined, 42, 'en', [], Object.freeze([{ locale: 'en', copy: {} }]),
			new (class Presentation { locale = 'en'; copy = {}; })(),
		]) {
			await assert.rejects(createFramescaperWebEditorRuntime(value), {
				name: 'TypeError',
				message: 'Framescaper web presentation must be a plain record.',
			});
		}
		for (const value of [
			{}, { locale: 'en' }, { copy: {} }, { locale: 'en', copy: {}, initialSurface: 'edit' },
			{ locale: 'en', [Symbol('copy')]: {} },
		]) {
			await assert.rejects(createFramescaperWebEditorRuntime(value), {
				name: 'TypeError',
				message: 'Framescaper web presentation has unsupported fields.',
			});
		}
		assert.equal(log.opens, 0, 'a refused presentation must not open the project database');
	});
});

test('the presentation locale must be a bounded, non-blank string', async () => {
	await withBrowser({}, async (log) => {
		for (const locale of [undefined, null, 5, ['en'], '', '   ', '\t\n', 'e'.repeat(129)]) {
			await assert.rejects(createFramescaperWebEditorRuntime({ locale, copy: {} }), {
				name: 'TypeError',
				message: 'The Framescaper locale must be a bounded string.',
			});
		}
		assert.equal(log.opens, 0);
	});
});

test('the presentation copy must be a record of own enumerable data fields', async () => {
	await withBrowser({}, async (log) => {
		for (const copy of [null, undefined, 'copy', ['loading'], new Map()]) {
			await assert.rejects(createFramescaperWebEditorRuntime({ locale: 'en', copy }), {
				name: 'TypeError',
				message: 'Framescaper web copy must be a plain record.',
			});
		}
		await assert.rejects(createFramescaperWebEditorRuntime({
			locale: 'en',
			copy: Object.defineProperty({}, 'loading', { enumerable: true, get: () => 'Loading' }),
		}), { name: 'TypeError', message: 'Framescaper web copy.loading must be an own data property.' });
		await assert.rejects(createFramescaperWebEditorRuntime({
			locale: 'en',
			copy: Object.defineProperty({}, 'loading', { enumerable: false, value: 'Loading' }),
		}), { name: 'TypeError', message: 'Framescaper web copy.loading must be an own data property.' });
		await assert.rejects(createFramescaperWebEditorRuntime({
			locale: 'en', copy: { [Symbol('loading')]: 'Loading' },
		}), { name: 'RangeError', message: 'Framescaper web copy has an invalid field inventory.' });
		await assert.rejects(createFramescaperWebEditorRuntime({
			locale: 'en',
			copy: Object.fromEntries(Array.from({ length: 4_097 }, (_, index) => [`k${index}`, index])),
		}), { name: 'RangeError', message: 'Framescaper web copy has an invalid field inventory.' });
		assert.equal(log.opens, 0);
	});
});

test('a runtime refuses to open over ephemeral memory storage', async () => {
	const restore = installBrowser({ indexedDB: null });
	try {
		await assert.rejects(createFramescaperWebEditorRuntime({ locale: 'en', copy: {} }), {
			name: 'Error',
			message: 'Durable storage is required; memory Framescaper project storage is unsupported.',
		});
	} finally {
		restore();
	}
});

test('an opened runtime is frozen, browser-bound, and closes its database exactly once', async () => {
	await withBrowser({}, async (log) => {
		const runtime = await createFramescaperWebEditorRuntime({
			locale: 'en',
			// A null-prototype copy is a plain record the bootstrap accepts.
			copy: Object.assign(Object.create(null), { loading: 'Loading project' }) as object,
		});

		assert.ok(Object.isFrozen(runtime));
		assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
		const fileService = runtime.fileService as unknown as FileServiceProbe;
		assert.deepEqual(
			{ kind: fileService.kind, isDesktop: fileService.isDesktop, bridge: fileService.bridge },
			{ kind: 'browser', isDesktop: false, bridge: null },
		);
		assert.equal(log.opens, 1);
		assert.equal(log.closes, 0, 'an opened runtime keeps its database until disposal');

		const first = runtime.dispose();
		assert.equal(runtime.dispose(), first, 'disposal is memoized rather than repeated');
		await first;
		await runtime.dispose();

		assert.equal(log.closes, 1);
		assert.throws(
			() => (runtime.controller as unknown as ControllerProbe).actions.project.rename('renamed'),
			{ name: 'EditorDisposedError', code: 'DISPOSED' },
			'the disposed controller refuses further edits',
		);
	});
});

test('a desktop bridge binds a desktop file service to the same runtime', async () => {
	const desktop = frozenDesktopGlobal();
	await withBrowser({ framescaperDesktop: desktop }, async (log) => {
		const runtime = await createFramescaperWebEditorRuntime({ locale: 'de', copy: {} });

		const fileService = runtime.fileService as unknown as FileServiceProbe;
		assert.deepEqual(
			{ kind: fileService.kind, isDesktop: fileService.isDesktop },
			{ kind: 'desktop', isDesktop: true },
		);
		assert.equal(fileService.bridge, desktop.v1);

		await runtime.dispose();
		assert.equal(log.closes, 1);
	});
});

test('a desktop global that is not an enumerable frozen record refuses the runtime', async () => {
	await withBrowser({}, async (log) => {
		const desktop = { v1: { projectLibrary: {} } };
		try {
			Object.defineProperty(globalThis, 'framescaperDesktop', {
				configurable: true, enumerable: false, writable: true, value: desktop,
			});
			await assert.rejects(createFramescaperWebEditorRuntime({ locale: 'en', copy: {} }), {
				name: 'TypeError',
				message: 'The Framescaper desktop global must be an own data property.',
			});
			Object.defineProperty(globalThis, 'framescaperDesktop', {
				configurable: true, enumerable: true, writable: true, value: desktop,
			});
			await assert.rejects(createFramescaperWebEditorRuntime({ locale: 'en', copy: {} }), {
				name: 'TypeError',
				message: 'The Framescaper desktop bridge must be frozen.',
			});
		} finally {
			Reflect.deleteProperty(globalThis, 'framescaperDesktop');
		}
		assert.equal(log.closes, 2, 'each refused startup still closes the database it opened');
	});
});

test('a controller that cannot be built closes the environment and rethrows the original failure', async () => {
	const failure = new Error('planned controller construction failure');
	await withBrowser({ document: hostileDocument(failure) }, async (log) => {
		await assert.rejects(
			createFramescaperWebEditorRuntime({ locale: 'en', copy: {} }),
			(error: unknown) => {
				assert.equal(error, failure, 'the original failure is propagated unwrapped');
				return true;
			},
		);
		assert.equal(log.opens, 1);
		assert.equal(log.closes, 1);
	});
});

test('a failed construction whose cleanup also fails reports both faults as one AggregateError', async () => {
	const failure = new Error('planned controller construction failure');
	const cleanupFailure = new Error('planned database close failure');
	await withBrowser({ document: hostileDocument(failure) }, async (log) => {
		await assert.rejects(
			createFramescaperWebEditorRuntime({ locale: 'en', copy: {} }),
			(error: unknown) => {
				assert.ok(error instanceof AggregateError);
				assert.equal(error.message, 'Framescaper runtime construction and cleanup both failed.');
				assert.deepEqual(error.errors, [failure, cleanupFailure]);
				assert.equal(error.cause, failure);
				return true;
			},
		);
		assert.equal(log.closes, 1);
	}, cleanupFailure);
});

test('a disposal that cannot close its storage rejects once for every caller', async () => {
	const cleanupFailure = new Error('planned database close failure');
	await withBrowser({}, async (log) => {
		const runtime = await createFramescaperWebEditorRuntime({ locale: 'en', copy: {} });
		log.closeFailure = cleanupFailure;

		const first = runtime.dispose();
		const second = runtime.dispose();

		assert.equal(first, second, 'a rejected disposal is memoized rather than retried');
		for (const disposal of [first, second]) {
			await assert.rejects(disposal, (error: unknown) => {
				assert.ok(error instanceof AggregateError);
				assert.equal(error.message, 'Framescaper controller and environment disposal failed.');
				assert.ok(error.errors.every((entry) => entry === cleanupFailure));
				return true;
			});
		}
		assert.equal(log.closes, 1, 'the refused close is not retried behind the memoized promise');
	});
});

test('the bootstrap announces a loading status from its fallback copy until the runtime exists', () => {
	assert.equal(
		renderToStaticMarkup(React.createElement(FramescaperAudioEditorBootstrap, {
			locale: 'de', fallbackCopy: { loading: 'Projekt wird geladen' },
		})),
		'<div role="status" aria-live="polite">Projekt wird geladen</div>',
	);
	assert.equal(
		renderToStaticMarkup(React.createElement(FramescaperAudioEditorBootstrap, {
			locale: 'en', fallbackCopy: {},
		})),
		'<div role="status" aria-live="polite">Loading project</div>',
		'an English bootstrap still waits on its runtime behind the built-in loading text',
	);
});

test('fallback copy that is not a record of own data fields fails the bootstrap render', () => {
	assert.throws(() => renderToStaticMarkup(React.createElement(FramescaperAudioEditorBootstrap, {
		locale: 'en', fallbackCopy: ['loading'] as unknown as Record<string, unknown>,
	})), { name: 'TypeError', message: 'Framescaper fallback copy must be a plain record.' });
	assert.throws(() => renderToStaticMarkup(React.createElement(FramescaperAudioEditorBootstrap, {
		locale: 'en',
		fallbackCopy: Object.defineProperty({}, 'loading', { enumerable: true, get: () => 'Wait' }),
	})), {
		name: 'TypeError',
		message: 'Framescaper fallback copy.loading must be an own data property.',
	});
});

test('a runtime failure is announced as an alert built from the fallback error template', async () => {
	const dom = installReactTestDom();
	const restore = installBrowser({ indexedDB: null });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(React.createElement(FramescaperAudioEditorBootstrap, {
			locale: 'en', fallbackCopy: { genericError: 'Framescaper konnte nicht starten: {message}' },
		})));
		await act(async () => { await delay(20); });

		const alert = dom.one('[role="alert"]');
		assert.equal(
			alert.textContent,
			'Framescaper konnte nicht starten: Durable storage is required; '
				+ 'memory Framescaper project storage is unsupported.',
		);
		assert.equal(dom.find('[role="status"]'), null, 'the alert replaces the loading status');

		await act(async () => root.unmount());
	} finally {
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		restore();
		dom.restore();
	}
});

test('a runtime that arrives after unmount is disposed instead of being leaked', async () => {
	const tracked = trackedIndexedDB();
	const dom = installReactTestDom();
	const restore = installBrowser({ indexedDB: tracked.factory });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		// The mount is not awaited, so the runtime resolves onto an unmounted tree.
		act(() => {
			root.render(React.createElement(FramescaperAudioEditorBootstrap, {
				locale: 'en', fallbackCopy: {},
			}));
		});
		assert.equal(tracked.log.opens, 1, 'the mount starts one runtime');
		act(() => { root.unmount(); });

		for (let attempt = 0; attempt < 200 && tracked.log.closes === 0; attempt += 1) {
			await delay(10);
		}
		assert.equal(tracked.log.closes, 1, 'the detached runtime closes its own database');
	} finally {
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		restore();
		dom.restore();
	}
});
