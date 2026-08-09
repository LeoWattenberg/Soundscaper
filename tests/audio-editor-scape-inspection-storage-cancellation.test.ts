/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { BlobReader, ZipReader } from '@zip.js/zip.js';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createScapeInspectionQuiescence } from '../src/common/editor/controller/scape-inspection-quiescence.ts';
import { createScapeInspectionService } from '../src/common/editor/controller/scape-inspection-service.ts';
import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';
import type {
	ScapeArchiveEntry,
} from '../src/common/editor/scape-archive-envelope.ts';
import type {
	ScapeArchiveReader,
} from '../src/common/editor/scape-archive-reader.ts';
import {
	exportScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';

interface InspectionOutcome {
	readonly status: 'fulfilled' | 'rejected';
	readonly value?: unknown;
	readonly reason?: unknown;
}

test('Scape inspection promptly aborts a signal-ignoring collision lookup', async () => {
	const project = createAudioEditorProjectV10({
		id: 'scape-inspection-storage-cancellation',
		title: 'Storage cancellation',
		sources: [],
		clips: [],
		tracks: [],
	});
	const archive = await projectOnlyArchive(project);
	const lookup = deferred<unknown>();
	const lookupStarted = deferred<void>();
	const controller = new AbortController();
	const reason = Object.assign(new Error('project changed during Scape inspection'), {
		code: 'PROJECT_CHANGED',
		name: 'AbortError',
	});
	let lookupSignal: AbortSignal | undefined;
	let closeCalls = 0;
	let settled = false;
	const store = {
		loadProject(id: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
			assert.equal(id, project.id);
			lookupSignal = options.signal;
			lookupStarted.resolve();
			return lookup.promise;
		},
	};
	const inspectionOptions = {
		signal: controller.signal,
		archiveReaderFactory: (input: Blob, signal?: AbortSignal): ScapeArchiveReader => {
			const reader = new ZipReader(new BlobReader(input), {
				signal,
				strictness: 'strict',
				useWebWorkers: false,
			});
			return {
				getEntriesGenerator(options) {
					return reader.getEntriesGenerator(options) as unknown as AsyncGenerator<
						ScapeArchiveEntry,
						boolean
					>;
				},
				async close() {
					closeCalls += 1;
					await reader.close();
				},
			};
		},
	};
	const pending = inspectScapeProject(archive, store, inspectionOptions);
	const observed: Promise<InspectionOutcome> = pending.then(
		(value: unknown): InspectionOutcome => {
			settled = true;
			return { status: 'fulfilled', value };
		},
		(error: unknown): InspectionOutcome => {
			settled = true;
			return { status: 'rejected', reason: error };
		},
	);
	let abortedOutcome: InspectionOutcome | undefined;

	try {
		await lookupStarted.promise;
		controller.abort(reason);
		await setImmediate();

		assert.equal(
			settled,
			true,
			'inspection must reject without waiting for the signal-ignoring storage read',
		);
		abortedOutcome = await observed;
		assert.equal(abortedOutcome.status, 'rejected');
		assert.equal(abortedOutcome.reason, reason);
		assert.equal(lookupSignal, controller.signal);
		assert.equal(closeCalls, 1);
	} finally {
		lookup.resolve({ id: project.id, title: 'Late stored project' });
		await observed;
	}

	await setImmediate();
	assert.equal((await observed).status, 'rejected');
	assert.equal((await observed).reason, reason);
	assert.equal(closeCalls, 1);
	assert.ok(abortedOutcome);
});

test('inspection quiescence retains a signal-ignoring collision lookup after prompt rejection', async () => {
	const project = createAudioEditorProjectV10({
		id: 'scape-inspection-provider-join',
		title: 'Provider join',
		sources: [],
		clips: [],
		tracks: [],
	});
	const archive = await projectOnlyArchive(project);
	const lookup = deferred<unknown>();
	const lookupStarted = deferred<void>();
	const quiescence = createScapeInspectionQuiescence();
	const reason = new DOMException('The active project changed.', 'AbortError');
	let lookupSignal: AbortSignal | undefined;
	let closeCalls = 0;
	const service = createScapeInspectionService({
		lifetime: new EditorControllerLifetime(),
		scapeInspectionQuiescence: quiescence,
		store: {
			loadProject(id: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
				assert.equal(id, project.id);
				lookupSignal = options.signal;
				lookupStarted.resolve();
				return lookup.promise;
			},
		},
	});
	const pending = service.inspect(archive, {
		archiveReaderFactory: (input: Blob, signal?: AbortSignal): ScapeArchiveReader => {
			const reader = new ZipReader(new BlobReader(input), {
				signal,
				strictness: 'strict',
				useWebWorkers: false,
			});
			return {
				getEntriesGenerator(options) {
					return reader.getEntriesGenerator(options) as unknown as AsyncGenerator<
						ScapeArchiveEntry,
						boolean
					>;
				},
				async close() {
					closeCalls += 1;
					await reader.close();
				},
			};
		},
	});
	const observed = pending.then(
		(value: unknown): InspectionOutcome => ({ status: 'fulfilled', value }),
		(error: unknown): InspectionOutcome => ({ status: 'rejected', reason: error }),
	);
	await lookupStarted.promise;
	const fence = quiescence.beginFence(reason);
	const waiting = fence.wait();

	try {
		assert.equal(
			await settlesByNextTurn(observed),
			true,
			'public inspection must reject by the next event-loop turn',
		);
		const outcome = await observed;
		assert.equal(outcome.status, 'rejected', 'public inspection must reject promptly');
		assert.equal(outcome.reason, reason);
		assert.equal(lookupSignal?.aborted, true);
		assert.equal(lookupSignal?.reason, reason);
		assert.equal(closeCalls, 1, 'prompt rejection must still close the archive reader');
		assert.equal(
			await settlesByNextTurn(waiting),
			false,
			'project work must remain fenced while the signal-ignoring lookup continues',
		);

		lookup.resolve({ id: project.id, title: 'Late stored project' });
		await waiting;
	} finally {
		lookup.resolve(null);
		await Promise.allSettled([pending, waiting]);
		fence.release();
	}
});

async function projectOnlyArchive(project: ReturnType<typeof createAudioEditorProjectV10>): Promise<Blob> {
	const exported = await exportScapeProject(project, {
		async *readSourceChunks() { return; },
		async loadMediaAsset() { return null; },
	});
	assert.ok(exported.blob instanceof Blob);
	return exported.blob;
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

async function settlesByNextTurn(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void promise.then(
		() => { settled = true; },
		() => { settled = true; },
	);
	await setImmediate();
	return settled;
}
