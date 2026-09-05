/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindFramescaperCandidateAuthoringActionRuntime as bindRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime as createSubsetRuntime,
	framescaperCandidateAuthoringActionRuntimeFor as runtimeFor,
} from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	bindFramescaperSelectedImageAuthoringControllerTimelineImage as bind,
	framescaperSelectedImageImportResultTimelineImageFor as resultFor,
} from '../src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';

type Data = Record<string, unknown>;

interface ImportCall extends Data {
	readonly project: Data;
	readonly files: readonly Data[];
	readonly sequenceStartFrame: number;
	readonly createId: (prefix: string) => string;
	readonly publisher: Readonly<{ publish(request: Data): Promise<Data> }>;
}

type Bound = Readonly<{
	controller: Data; options: Data; imports: ImportCall[]; calls: string[]; commands: Data[];
}>;

const PROJECT = createFramescaperProjectTimelineImage(PROFILE, {}) as unknown as Data;
const PUBLISHED = createFramescaperProjectTimelineImage(
	PROFILE,
	{ title: 'Published' } as never,
) as unknown as Data;
const NOW = '2026-03-04T05:06:07.000Z';
const ONE_SECOND_SAMPLES = 48_000; // The default project runs a 30/1 sequence at 48000 Hz.

function file(name = 'shot.png', size = 8): Data {
	return { name, size, type: 'image/png', arrayBuffer: async () => new Uint8Array(size).buffer };
}

function fileOutcome(fileName: string, status: string, message: string | null = null): Data {
	return { fileName, status, sourceId: null, clipId: null, notices: [], message };
}

const importResult = (files: readonly Data[]): Data => ({ project: PROJECT, files });
const RESULT = importResult([fileOutcome('shot.png', 'imported')]);

function controllerStub(positionFrame: unknown = 0, calls: string[] = []): Data {
	const openById = async (_id: string, options: Data = {}): Promise<void> => {
		calls.push(options.adoptSessionRevision === true ? 'openById:adopt' : 'openById');
		controller.project = PUBLISHED;
	};
	const controller: Data = {
		project: PROJECT,
		getTelemetrySnapshot: () => ({ positionFrame }),
		actions: { project: { openById } },
	};
	return controller;
}

function harness(overrides: Data = {}): Bound {
	const calls: string[] = [];
	const imports: ImportCall[] = [];
	const commands: Data[] = [];
	const options: Data = {
		controller: controllerStub(0, calls),
		session: {
			captureProjectHistory: () => ({ token: 'token', history: { present: PROJECT } }),
			assertProjectHistoryToken: () => { calls.push('assertToken'); },
			updateProjectHistory: () => { calls.push('updateHistory'); },
			markProjectSaved: () => { calls.push('markSaved'); },
			getProjectHistory: () => ({ present: PROJECT }),
		},
		executeCommand: (_history: Data, command: Data, request: Data) => {
			commands.push({ command, now: request.now });
			return { present: PUBLISHED };
		},
		publishIfCurrent: async () => PUBLISHED,
		now: () => NOW,
		selectFiles: async () => [file()],
		importImages: async (request: ImportCall) => { imports.push(request); return RESULT; },
		...overrides,
	};
	bind(options as never);
	return { controller: options.controller as Data, options, imports, calls, commands };
}

function still(controller: Data): Promise<void> {
	const runtime = runtimeFor(controller);
	assert.ok(runtime, 'binding must leave a candidate authoring runtime on the controller');
	return runtime.run('video-still');
}

/** Drain enough microtask turns for a queued gesture to reach its file picker. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

test('binding offers the video-still surface and nothing the controller never claimed', () => {
	const { controller } = harness();
	const runtime = runtimeFor(controller);

	assert.deepEqual(runtime?.surfaces, ['video-still']);
	assert.ok(Object.isFrozen(runtime?.surfaces), 'a bound surface list must not be mutable');
});

test('an authoring surface the binding never claimed is refused by the bound runtime', async () => {
	const { controller, imports } = harness();

	await assert.rejects(
		() => runtimeFor(controller)!.run('video-title'),
		/candidate authoring video-title is unavailable/u,
	);
	assert.equal(imports.length, 0);
});

test('binding preserves an earlier runtime surface and delegates it back to that runtime', async () => {
	const calls: string[] = [];
	const controller = controllerStub(0, calls);
	bindRuntime(controller, createSubsetRuntime(['video-title'], {
		'video-title': () => { calls.push('inherited-title'); },
	}));

	const { imports } = harness({ controller });

	assert.deepEqual(runtimeFor(controller)?.surfaces, ['video-title', 'video-still']);
	await runtimeFor(controller)!.run('video-title');
	assert.deepEqual(calls, ['inherited-title'], 'the inherited surface keeps its own action');
	await still(controller);
	assert.equal(imports.length, 1, 'video-still runs the newly bound image import');
});

test('rebinding replaces the video-still action without duplicating the surface', async () => {
	const first = harness();
	const second = harness({ controller: first.controller, selectFiles: async () => [file('second.png')] });

	await still(first.controller);

	assert.deepEqual(runtimeFor(first.controller)?.surfaces, ['video-still']);
	assert.equal(first.imports.length, 0, 'the superseded binding no longer runs');
	assert.deepEqual(second.imports[0]?.files.map(({ name }) => name), ['second.png']);
});

test('binding without the publication ports it writes through is refused', () => {
	for (const missing of ['session', 'executeCommand', 'publishIfCurrent'] as const) {
		assert.throws(
			() => harness({ [missing]: undefined }),
			(error: Error) => {
				assert.ok(error instanceof TypeError);
				assert.match(error.message, /exact controller, session, runtime, and storage ports/u);
				return true;
			},
			`a binding without ${missing} must be refused`,
		);
	}
	assert.throws(() => harness({ controller: null }), TypeError);
});

test('the video-still gesture imports the selection at the enclosing playhead frame', async () => {
	const { controller, imports } = harness({
		controller: controllerStub(ONE_SECOND_SAMPLES),
		selectFiles: async () => [file('a.png'), file('b.png')],
	});

	await still(controller);

	assert.equal(imports.length, 1);
	const call = imports[0]!;
	assert.equal(call.project, PROJECT);
	assert.deepEqual(call.files.map(({ name }) => name), ['a.png', 'b.png']);
	assert.equal(call.sequenceStartFrame, 30, 'one second of samples is frame 30 at 30/1');
	assert.equal(typeof call.publisher.publish, 'function');
});

test('a playhead inside a frame is floored to the frame that encloses it', async () => {
	const { controller, imports } = harness({ controller: controllerStub(ONE_SECOND_SAMPLES - 1) });

	await still(controller);

	assert.equal(imports[0]?.sequenceStartFrame, 29);
});

test('an empty selection imports nothing and records no result on the controller', async () => {
	const { controller, imports } = harness({ selectFiles: async () => [] });

	await still(controller);

	assert.equal(imports.length, 0);
	assert.equal(resultFor(controller), null);
});

test('a completed gesture records its import result against the controller', async () => {
	const { controller } = harness();

	assert.equal(resultFor(controller), null, 'no result exists before the first gesture');
	await still(controller);

	assert.equal(resultFor(controller), RESULT);
});

test('an import result is only recorded for the controller that ran the gesture', async () => {
	const { controller } = harness();
	const other = controllerStub();

	await still(controller);

	assert.equal(resultFor(other), null);
	for (const owner of [null, undefined, 'controller', 7, Symbol('controller')]) {
		assert.equal(resultFor(owner), null, 'a non-object owner can carry no import result');
	}
	assert.equal(resultFor(() => undefined), null, 'a callable owner without a gesture has none');
});

test('the import mints identities with the injected factory, or a stable default', async () => {
	const injected = harness({ createId: (prefix: string) => `${prefix}-fixed` });
	const defaulted = harness({ createId: undefined });

	await still(injected.controller);
	await still(defaulted.controller);

	assert.equal(injected.imports[0]?.createId('image-clip'), 'image-clip-fixed');
	const minted = defaulted.imports[0]!.createId('image-source');
	assert.match(minted, /^image-source-[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
	assert.notEqual(minted, defaulted.imports[0]!.createId('image-source'), 'each mint is distinct');
});

test('a partially failed import records the result and reports a counted summary', async () => {
	const failed = importResult([
		fileOutcome('good.png', 'imported'),
		fileOutcome('broken.png', 'failed', 'the image could not be decoded'),
	]);
	const { controller } = harness({
		selectFiles: async () => [file('good.png'), file('broken.png')],
		importImages: async () => failed,
	});

	await assert.rejects(
		() => still(controller),
		/^Error: Imported 1 of 2 images\. broken\.png: the image could not be decoded$/u,
	);
	assert.equal(resultFor(controller), failed, 'the partial result stays reachable after the throw');
});

test('a failed file without its own reason is summarised with a generic one', async () => {
	const { controller } = harness({
		importImages: async () => importResult([fileOutcome('shot.png', 'failed', null)]),
	});

	await assert.rejects(() => still(controller), /Imported 0 of 1 images\. shot\.png: Image import failed\.$/u);
});

test('a cancelled import is reported as a completed gesture rather than a failure', async () => {
	const cancelled = importResult([fileOutcome('shot.png', 'cancelled', 'Import cancelled.')]);
	const { controller } = harness({ importImages: async () => cancelled });

	await still(controller);

	assert.equal(resultFor(controller), cancelled);
});

test('a gesture without an open project is refused before any file is imported', async () => {
	const controller = controllerStub();
	controller.project = null;
	const { imports } = harness({ controller });

	await assert.rejects(() => still(controller), TypeError);
	assert.equal(imports.length, 0);
});

test('a project from another product family cannot be authored by this gesture', async () => {
	const controller = controllerStub();
	controller.project = { schemaFamily: 'soundscaper', schemaVersion: 1 };
	const { imports } = harness({ controller });

	await assert.rejects(() => still(controller), (error: Error) => {
		assert.ok(error instanceof RangeError);
		assert.match(error.message, /cannot author a foreign project/u);
		return true;
	});
	assert.equal(imports.length, 0);
});

test('a playhead that is not an exact non-negative sample is refused', async () => {
	const snapshots: Data[] = [
		{}, { positionFrame: -1 }, { positionFrame: 1.5 },
		{ positionFrame: Number.NaN }, { positionFrame: '48000' }, { positionFrame: 2 ** 53 },
	];
	for (const snapshot of snapshots) {
		const controller = controllerStub();
		controller.getTelemetrySnapshot = () => snapshot;
		const { imports } = harness({ controller });

		await assert.rejects(() => still(controller), (error: Error) => {
			assert.ok(error instanceof RangeError);
			assert.match(error.message, /exact non-negative playhead sample/u);
			return true;
		}, `${JSON.stringify(snapshot)} carries no playhead sample`);
		assert.equal(imports.length, 0);
	}
});

test('a project whose primary sequence is missing cannot place the import', async () => {
	const controller = controllerStub();
	controller.project = { ...PROJECT, primarySequenceId: 'absent-sequence' };
	const { imports } = harness({ controller });

	await assert.rejects(() => still(controller), (error: Error) => {
		assert.ok(error instanceof ReferenceError);
		assert.match(error.message, /requires the primary Framescaper sequence/u);
		return true;
	});
	assert.equal(imports.length, 0);
});

test('a second gesture waits for the one already in flight before it picks files', async () => {
	const order: string[] = [];
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => { release = () => { resolve(); }; });
	let selections = 0;
	const { controller, imports } = harness({
		selectFiles: async () => {
			selections += 1;
			order.push(`select-${selections}`);
			if (selections === 1) await gate;
			return [file()];
		},
	});

	const first = still(controller);
	const second = still(controller);
	await settle();
	assert.deepEqual(order, ['select-1'], 'the queued gesture must not open a second picker');

	release();
	await Promise.all([first, second]);
	assert.deepEqual(order, ['select-1', 'select-2']);
	assert.equal(imports.length, 2);
});

test('a gesture that threw does not wedge the gesture queued behind it', async () => {
	let selections = 0;
	const { controller, imports } = harness({
		selectFiles: async () => {
			selections += 1;
			if (selections === 1) throw new Error('the picker could not open');
			return [file('after-failure.png')];
		},
	});

	const first = still(controller);
	const second = still(controller);

	await assert.rejects(() => first, /the picker could not open/u);
	await second;
	assert.deepEqual(imports[0]?.files.map(({ name }) => name), ['after-failure.png']);
});

test('the publisher handed to the import writes through the injected session ports', async () => {
	let published: Data | null = null;
	const built = harness({
		importImages: async (request: ImportCall) => {
			published = await request.publisher.publish({
				project: PROJECT,
				command: { type: 'batch', commands: [] },
				body: { arrayBuffer: async () => new Uint8Array([1, 2]).buffer },
			});
			return RESULT;
		},
	});

	await still(built.controller);

	assert.equal(published, PUBLISHED);
	assert.deepEqual(built.calls, [
		'assertToken', 'assertToken', 'assertToken', 'updateHistory', 'markSaved', 'openById:adopt',
	]);
	assert.deepEqual(built.commands, [{ command: { type: 'batch', commands: [] }, now: NOW }]);
});

test('a gesture uses the real image import when no import port is injected', async () => {
	const many = Array.from({ length: 65 }, (_, index) => file(`shot-${index}.png`));
	const { controller } = harness({ importImages: undefined, selectFiles: async () => many });

	await assert.rejects(() => still(controller), /requires 1 through 64 files/u);
	assert.equal(resultFor(controller), null, 'a refused gesture records no result');
});

test('a desktop file service without bounded read capabilities cannot pick images', async () => {
	for (const fileService of [
		{ isDesktop: true },
		{ isDesktop: true, chooseFiles: async () => [] },
		{ isDesktop: true, withReadDescriptors: async () => [] },
	]) {
		const { controller } = harness({ selectFiles: undefined, fileService });

		await assert.rejects(() => still(controller), /Desktop Add Images requires bounded media read capabilities/u);
	}
});

test('a desktop picker that chose nothing reads no descriptor and imports nothing', async () => {
	let reads = 0;
	const { controller, imports } = harness({
		selectFiles: undefined,
		fileService: {
			isDesktop: true,
			chooseFiles: async () => [],
			withReadDescriptors: async () => { reads += 1; return []; },
		},
	});

	await still(controller);

	assert.equal(reads, 0, 'an empty choice must not open a read scope');
	assert.equal(imports.length, 0);
});

test('a desktop picker imports a frozen snapshot of the files its read scope yields', async () => {
	const chosen = [file('desktop.png')];
	const requests: Data[] = [];
	const { controller, imports } = harness({
		selectFiles: undefined,
		fileService: {
			isDesktop: true,
			chooseFiles: async (request: Data) => { requests.push(request); return ['descriptor-1']; },
			withReadDescriptors: async (
				descriptors: readonly unknown[],
				request: Data,
				consume: (files: readonly Data[]) => unknown,
			) => {
				requests.push({ descriptors, request });
				return consume(chosen);
			},
		},
	});

	await still(controller);

	assert.deepEqual(requests[0], { purpose: 'media', multiple: true });
	assert.deepEqual(requests[1], { descriptors: ['descriptor-1'], request: {} });
	assert.deepEqual(imports[0]?.files.map(({ name }) => name), ['desktop.png']);
	assert.ok(Object.isFrozen(imports[0]?.files), 'the selection is snapshotted before it is imported');
	assert.notEqual(imports[0]?.files, chosen, 'the caller keeps no handle on the imported array');
});

test('a desktop read scope that yields something other than file capabilities is refused', async () => {
	const yields: unknown[] = ['shot.png', [{ name: 'shot.png' }], [null]];
	for (const yielded of yields) {
		const { controller, imports } = harness({
			selectFiles: undefined,
			fileService: {
				isDesktop: true,
				chooseFiles: async () => ['descriptor-1'],
				withReadDescriptors: async (
					_descriptors: readonly unknown[],
					_request: Data,
					consume: (files: readonly Data[]) => unknown,
				) => consume(yielded as never),
			},
		});

		await assert.rejects(() => still(controller), TypeError);
		assert.equal(imports.length, 0);
	}
});

test('a gesture outside a browser or desktop picker host is refused', async () => {
	const { controller, imports } = harness({ selectFiles: undefined, fileService: { isDesktop: false } });

	await assert.rejects(() => still(controller), /requires a browser or desktop file picker/u);
	assert.equal(imports.length, 0);
});

/** A minimal document whose file input replays the named events when it is clicked. */
function picker(events: readonly string[], files: readonly Data[]): Readonly<{
	document: Data; input: Data; appended: Data[];
}> {
	const listeners = new Map<string, () => void>();
	const appended: Data[] = [];
	const input: Data = {
		files,
		removals: 0,
		clicks: 0,
		addEventListener: (name: string, listener: () => void) => { listeners.set(name, listener); },
		remove: () => { input.removals = Number(input.removals) + 1; },
		click: () => {
			input.clicks = Number(input.clicks) + 1;
			for (const name of events) listeners.get(name)?.();
		},
	};
	return {
		input,
		appended,
		document: { createElement: () => input, body: { append: (node: Data) => { appended.push(node); } } },
	};
}

async function withDocument(document: Data, body: () => Promise<void>): Promise<void> {
	const had = Object.hasOwn(globalThis, 'document');
	const previous = Reflect.get(globalThis, 'document');
	Reflect.set(globalThis, 'document', document);
	try { await body(); } finally {
		if (had) Reflect.set(globalThis, 'document', previous);
		else Reflect.deleteProperty(globalThis, 'document');
	}
}

test('the browser picker imports the files chosen from a hidden multiple-file input', async () => {
	const scope = picker(['change'], [file('browser.png'), file('second.png')]);
	const { controller, imports } = harness({ selectFiles: undefined });

	await withDocument(scope.document, () => still(controller));

	assert.equal(scope.input.type, 'file');
	assert.equal(scope.input.multiple, true);
	assert.equal(scope.input.hidden, true);
	assert.match(String(scope.input.accept), /^\.jpg,.*image\/bmp$/u);
	assert.deepEqual(scope.appended, [scope.input], 'the input is attached before it is clicked');
	assert.equal(scope.input.clicks, 1);
	assert.equal(scope.input.removals, 1, 'the input is detached once the choice settles');
	assert.deepEqual(imports[0]?.files.map(({ name }) => name), ['browser.png', 'second.png']);
});

test('a cancelled browser picker imports nothing and settles the choice only once', async () => {
	const scope = picker(['cancel', 'change'], [file('never.png')]);
	const { controller, imports } = harness({ selectFiles: undefined });

	await withDocument(scope.document, () => still(controller));

	assert.equal(imports.length, 0, 'a cancellation wins over a later change event');
	assert.equal(scope.input.removals, 1, 'the settled input is detached exactly once');
	assert.equal(resultFor(controller), null);
});

test('a browser picker that reports no file list resolves with an empty selection', async () => {
	const scope = picker(['change'], []);
	scope.input.files = null;
	const { controller, imports } = harness({ selectFiles: undefined });

	await withDocument(scope.document, () => still(controller));

	assert.equal(imports.length, 0);
});
