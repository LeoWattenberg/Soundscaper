/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { BlobReader, ZipReader } from '@zip.js/zip.js';

import { createAudioEditorProjectV6 } from '../src/common/editor/project-v6.ts';
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
	const project = createAudioEditorProjectV6({
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

async function projectOnlyArchive(project: ReturnType<typeof createAudioEditorProjectV6>): Promise<Blob> {
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
