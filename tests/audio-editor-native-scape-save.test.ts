/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareNativeScapeSave,
	publishNativeScape,
	publishNativeScapeArchiveCopy,
} from '../src/common/editor/controller/native-scape-save.ts';
import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import type {
	NativePreparedSave,
	NativeProjectDocument,
	NativeProjectFileService,
	NativeProjectServiceRuntime,
} from '../src/common/editor/controller/native-project-types.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';

const project: NativeProjectDocument = {
	id: 'direct-save', title: 'Direct save', schemaVersion: 6, sources: [], clips: [],
};

test('Scape target preparation forwards one early capability-aware request', async () => {
	const controller = new AbortController();
	let captured: Readonly<Record<string, unknown>> | undefined;
	const fileService = {
		async prepareSave(request: Readonly<Record<string, unknown>>) {
			captured = request;
			return { mode: 'cancelled', cancelled: true, fileName: 'project.scape' } as const;
		},
	} as unknown as NativeProjectFileService;
	const result = await prepareNativeScapeSave(fileService, {
		fileName: 'project.scape',
		mimeType: 'application/vnd.soundscaper.scape+zip',
		options: { useFileSystemAccess: true },
		signal: controller.signal,
	});

	assert.equal(result.mode, 'cancelled');
	assert.equal(captured?.purpose, 'project');
	assert.equal(captured?.signal, controller.signal);
	assert.equal(captured?.useFileSystemAccess, true);
	assert.deepEqual(captured?.types, [{
		description: 'Scape project',
		accept: { 'application/vnd.soundscaper.scape+zip': ['.scape'] },
	}]);
});

test('direct Scape publication stages with the admitted maximum and commits after ownership', async () => {
	const events: string[] = [];
	let factory: ((maximumBytes: number) => Promise<WritableStream<Uint8Array>>) | undefined;
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable(maximumBytes) {
			events.push(`open:${String(maximumBytes)}`);
			return new WritableStream<Uint8Array>();
		},
		bytesWritten() { return 17; },
		async commit() { events.push('commit'); return { method: 'direct', size: 17 }; },
		async abort() { events.push('abort'); },
	};
	const runtime = {
		store: {},
		scapeMimeType: 'application/vnd.soundscaper.scape+zip',
		fileService: { saveFile: async () => { throw new Error('must not save a Blob'); } },
		async exportScapeProject(_project: unknown, _store: unknown, options: {
			createWritable?: (maximumBytes: number) => Promise<WritableStream<Uint8Array>>;
		}) {
			factory = options.createWritable;
			await factory?.(99);
			events.push('export');
			return { blob: null, byteLength: 17, manifest: { format: 'scape-project' } };
		},
	};
	const result = await publishNativeScape(runtime as never, {
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'project.scape',
		prepared,
		project,
		signal: new AbortController().signal,
	});

	assert.equal(typeof factory, 'function');
	assert.deepEqual(events, ['open:99', 'export', 'ownership', 'commit']);
	assert.equal(result.exported.blob, null);
	assert.deepEqual(result.saved, { method: 'direct', size: 17 });
});

test('direct Scape publication aborts staging when ownership fails before commit', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() { return new WritableStream<Uint8Array>(); },
		bytesWritten() { return 0; },
		async commit() { events.push('commit'); return {}; },
		async abort(reason) { events.push(`abort:${String((reason as Error).message)}`); },
	};
	const runtime = {
		store: {},
		scapeMimeType: 'application/vnd.soundscaper.scape+zip',
		async exportScapeProject() { return { blob: null, byteLength: 0, manifest: {} }; },
	};
	await assert.rejects(publishNativeScape(runtime as never, {
		assertReadyToCommit() { throw new Error('stale project'); },
		fileName: 'project.scape', prepared, project, signal: new AbortController().signal,
	}), /stale project/u);
	assert.deepEqual(events, ['abort:stale project']);
});

test('direct Scape publication rejects independent staged-byte disagreement before commit', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() { return new WritableStream<Uint8Array>(); },
		bytesWritten() { return 2; },
		async commit() { events.push('commit'); return {}; },
		async abort() { events.push('abort'); },
	};
	const runtime = {
		store: {},
		async exportScapeProject() { return { blob: null, byteLength: 3, manifest: {} }; },
	};
	await assert.rejects(publishNativeScape(runtime as never, {
		assertReadyToCommit() {},
		fileName: 'project.scape', prepared, project, signal: new AbortController().signal,
	}), /does not match the archive writer byte count/u);
	assert.deepEqual(events, ['abort']);
});

test('Blob fallback publishes the admitted archive to its already-selected target', async () => {
	const target = { browserDownload: true };
	const requests: unknown[] = [];
	const runtime = {
		store: {},
		scapeMimeType: 'application/vnd.soundscaper.scape+zip',
		fileService: {
			async saveFile(request: unknown) { requests.push(request); return { method: 'download', size: 3 }; },
		},
		async exportScapeProject() { return { blob: new Blob(['zip']), manifest: {} }; },
	};
	const result = await publishNativeScape(runtime as never, {
		assertReadyToCommit() {},
		fileName: 'fallback.scape',
		prepared: { mode: 'blob', fileName: 'fallback.scape', target },
		project,
		signal: new AbortController().signal,
	});
	assert.equal(requests.length, 1);
	assert.equal((requests[0] as { target: unknown }).target, target);
	assert.deepEqual(result.saved, { method: 'download', size: 3 });
});

test('native Scape save selects its direct target before flush and never assembles a Blob', async () => {
	const fixture = directServiceFixture();
	const result = await fixture.service.saveScape();
	assert.ok('manifest' in result);
	assert.deepEqual(result.manifest, { format: 'scape-project' });
	assert.ok(fixture.events.indexOf('prepare') < fixture.events.indexOf('flush'));
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('open:')), ['open:128']);
	assert.ok(fixture.events.indexOf('sealed') < fixture.events.indexOf('commit'));
	assert.equal(fixture.events.includes('save-blob'), false);
	assert.equal(fixture.state.saveState, 'saved');
	assert.equal(fixture.events.includes('status:Project saved.'), true);
});

test('native Scape save reports a committed file truthfully when cancellation lands in commit', async () => {
	const fixture = directServiceFixture({ cancelDuringCommit: true });
	const result = await fixture.service.saveScape();
	assert.ok('manifest' in result);
	assert.equal(result.size, 3);
	assert.equal(fixture.events.includes('commit'), true);
	assert.equal(fixture.events.some((event) => event.startsWith('abort')), false);
	assert.equal(fixture.events.includes('status:Project saved.'), false);
	assert.equal(fixture.state.saveState, 'dirty');
});

test('cancelled Scape target selection skips flush, archive work, and save-state mutation', async () => {
	const fixture = directServiceFixture({ cancelPicker: true });
	assert.deepEqual(await fixture.service.saveScape(), { cancelled: true });
	assert.deepEqual(fixture.events, ['prepare']);
	assert.equal(fixture.state.saveState, 'saved');
});

test('direct Scape publication aborts once when a staged write is refused', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() {
			return new WritableStream<Uint8Array>({
				write() { throw new Error('staging space exhausted'); },
			});
		},
		bytesWritten() { return 0; },
		async commit() { events.push('commit'); return {}; },
		async abort(reason) { events.push(`abort:${String((reason as Error).message)}`); },
	};
	const runtime = {
		store: {},
		async exportScapeProject(_project: unknown, _store: unknown, options: {
			createWritable?: (maximumBytes: number) => Promise<WritableStream<Uint8Array>>;
		}) {
			const writer = (await options.createWritable?.(4))?.getWriter();
			await writer?.write(Uint8Array.of(1));
			throw new Error('unreachable export completion');
		},
	};
	await assert.rejects(publishNativeScape(runtime as never, {
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'project.scape', prepared, project, signal: new AbortController().signal,
	}), /staging space exhausted/u);
	assert.deepEqual(events, ['abort:staging space exhausted']);
});

test('direct Scape commit failure cleans the destination and preserves its cause', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() { return new WritableStream<Uint8Array>(); },
		bytesWritten() { return 0; },
		async commit() { events.push('commit'); throw new Error('destination commit refused'); },
		async abort(reason) { events.push(`abort:${String((reason as Error).message)}`); },
	};
	const runtime = {
		store: {},
		async exportScapeProject() { return { blob: null, byteLength: 0, manifest: {} }; },
	};
	await assert.rejects(publishNativeScape(runtime as never, {
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'project.scape', prepared, project, signal: new AbortController().signal,
	}), /destination commit refused/u);
	assert.deepEqual(events, ['ownership', 'commit', 'abort:destination commit refused']);
});

test('direct Scape commit and cleanup failures surface together as one aggregate', async () => {
	const commitFailure = new Error('destination commit refused');
	const cleanupFailure = new Error('destination cleanup refused');
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() { return new WritableStream<Uint8Array>(); },
		bytesWritten() { return 0; },
		async commit() { throw commitFailure; },
		async abort() { throw cleanupFailure; },
	};
	const runtime = {
		store: {},
		async exportScapeProject() { return { blob: null, byteLength: 0, manifest: {} }; },
	};
	await assert.rejects(publishNativeScape(runtime as never, {
		assertReadyToCommit() {},
		fileName: 'project.scape', prepared, project, signal: new AbortController().signal,
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /Scape save and destination cleanup both failed/u);
		assert.deepEqual(error.errors, [commitFailure, cleanupFailure]);
		return true;
	});
});

test('stream archive copy writes exact retained bytes and commits after ownership', async () => {
	const events: string[] = [];
	const archive = new Blob([Uint8Array.of(1, 2, 3, 4, 5)]);
	let staged = 0;
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable(maximumBytes) {
			events.push(`open:${String(maximumBytes)}`);
			return new WritableStream<Uint8Array>({
				write(chunk) { staged += chunk.byteLength; },
				close() { events.push('sealed'); },
			});
		},
		bytesWritten() { return staged; },
		async commit() { events.push('commit'); return { method: 'direct', size: staged }; },
		async abort() { events.push('abort'); },
	};
	const runtime = {
		scapeMimeType: 'application/vnd.soundscaper.scape+zip',
		fileService: { saveFile: async () => { throw new Error('must not save a Blob'); } },
		async copyFutureScapeArchive(input: Blob, write: (bytes: Uint8Array) => Promise<unknown>) {
			const bytes = new Uint8Array(await input.arrayBuffer());
			await write(bytes.subarray(0, 2));
			await write(bytes.subarray(2));
			events.push('copied');
			return { byteLength: bytes.byteLength, schemaVersion: 12 };
		},
	};
	const result = await publishNativeScapeArchiveCopy(runtime as never, {
		archive,
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'future.scape', prepared, signal: new AbortController().signal,
	});
	assert.deepEqual(events, ['open:5', 'copied', 'sealed', 'ownership', 'commit']);
	assert.deepEqual(result.copied, { byteLength: 5, schemaVersion: 12 });
	assert.deepEqual(result.saved, { method: 'direct', size: 5 });
});

test('stream archive copy aborts once when a staged write is refused', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() {
			return new WritableStream<Uint8Array>({
				write() { throw new Error('staging space exhausted'); },
			});
		},
		bytesWritten() { return 0; },
		async commit() { events.push('commit'); return {}; },
		async abort(reason) { events.push(`abort:${String((reason as Error).message)}`); },
	};
	const runtime = {
		async copyFutureScapeArchive(_input: Blob, write: (bytes: Uint8Array) => Promise<unknown>) {
			await write(Uint8Array.of(9));
			throw new Error('unreachable copy completion');
		},
	};
	await assert.rejects(publishNativeScapeArchiveCopy(runtime as never, {
		archive: new Blob([Uint8Array.of(9)]),
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'future.scape', prepared, signal: new AbortController().signal,
	}), /staging space exhausted/u);
	assert.deepEqual(events, ['abort:staging space exhausted']);
});

test('stream archive copy refuses byte-count disagreement before ownership', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() {
			return new WritableStream<Uint8Array>({ close() { events.push('sealed'); } });
		},
		bytesWritten() { return 2; },
		async commit() { events.push('commit'); return {}; },
		async abort(reason) { events.push(`abort:${String((reason as Error).message)}`); },
	};
	const runtime = {
		async copyFutureScapeArchive(_input: Blob, write: (bytes: Uint8Array) => Promise<unknown>) {
			await write(Uint8Array.of(1, 2));
			return { byteLength: 2, schemaVersion: 12 };
		},
	};
	await assert.rejects(publishNativeScapeArchiveCopy(runtime as never, {
		archive: new Blob([Uint8Array.of(1, 2, 3)]),
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'future.scape', prepared, signal: new AbortController().signal,
	}), /does not match the original byte count/u);
	assert.deepEqual(events, ['sealed', 'abort:The staged archive copy does not match the original byte count.']);
});

test('stream archive copy commit failure cleans the destination and preserves its cause', async () => {
	const events: string[] = [];
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() {
			return new WritableStream<Uint8Array>({ close() { events.push('sealed'); } });
		},
		bytesWritten() { return 1; },
		async commit() { events.push('commit'); throw new Error('destination commit refused'); },
		async abort(reason) { events.push(`abort:${String((reason as Error).message)}`); },
	};
	const runtime = {
		async copyFutureScapeArchive(_input: Blob, write: (bytes: Uint8Array) => Promise<unknown>) {
			await write(Uint8Array.of(7));
			return { byteLength: 1, schemaVersion: 12 };
		},
	};
	await assert.rejects(publishNativeScapeArchiveCopy(runtime as never, {
		archive: new Blob([Uint8Array.of(7)]),
		assertReadyToCommit() { events.push('ownership'); },
		fileName: 'future.scape', prepared, signal: new AbortController().signal,
	}), /destination commit refused/u);
	assert.deepEqual(events, ['sealed', 'ownership', 'commit', 'abort:destination commit refused']);
});

test('stream archive copy aggregates destination cleanup failure with its cause', async () => {
	const cleanupFailure = new Error('destination cleanup refused');
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable() {
			return new WritableStream<Uint8Array>({
				write() { throw new Error('staging space exhausted'); },
			});
		},
		bytesWritten() { return 0; },
		async commit() { throw new Error('unreachable commit'); },
		async abort() { throw cleanupFailure; },
	};
	const runtime = {
		async copyFutureScapeArchive(_input: Blob, write: (bytes: Uint8Array) => Promise<unknown>) {
			await write(Uint8Array.of(9));
			throw new Error('unreachable copy completion');
		},
	};
	await assert.rejects(publishNativeScapeArchiveCopy(runtime as never, {
		archive: new Blob([Uint8Array.of(9)]),
		assertReadyToCommit() {},
		fileName: 'future.scape', prepared, signal: new AbortController().signal,
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /archive copy and destination cleanup both failed/u);
		assert.match((error.errors[0] as Error).message, /staging space exhausted/u);
		assert.equal(error.errors[1], cleanupFailure);
		return true;
	});
});

function directServiceFixture(options: Readonly<{
	cancelDuringCommit?: boolean;
	cancelPicker?: boolean;
}> = {}) {
	const events: string[] = [];
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const state = { importing: false, saveState: 'saved', readOnly: false, mobile: false };
	const prepared: Extract<NativePreparedSave, { mode: 'stream' }> = {
		mode: 'stream',
		async createWritable(maximumBytes) {
			events.push(`open:${String(maximumBytes)}`);
			return new WritableStream<Uint8Array>({ close() { events.push('sealed'); } });
		},
		bytesWritten() { return 3; },
		async commit() {
			events.push('commit');
			if (options.cancelDuringCommit) lifetime.cancelTask('native-project-save');
			return { method: 'direct', size: 3 };
		},
		async abort(reason) { events.push(`abort:${String(reason)}`); },
	};
	const runtime = {
		lifetime,
		projectGeneration,
		state,
		copy: {
			projectNotFound: 'Project not found.', projectReadOnly: 'Read only.',
			missingSourcesPreventSave: 'Missing sources.', projectSaved: 'Project saved.',
		},
		store: {},
		fileService: {
			isDesktop: false,
			async chooseSaveTarget() { return {}; },
			async prepareSave() {
				events.push('prepare');
				return options.cancelPicker
					? { mode: 'cancelled', cancelled: true, fileName: 'project.scape' }
					: prepared;
			},
			async saveFile() { events.push('save-blob'); return {}; },
		},
		getProject: () => project,
		editingBlocked: () => false,
		async flushProject() { events.push('flush'); },
		hasMissingTimelineSources: () => false,
		ensureScapeFileName: () => 'project.scape',
		scapeMimeType: 'application/vnd.soundscaper.scape+zip',
		async exportScapeProject(_project: unknown, _store: unknown, exportOptions: {
			createWritable?: (maximumBytes: number) => Promise<WritableStream<Uint8Array>>;
		}) {
			events.push('export');
			const writable = await exportOptions.createWritable?.(128);
			assert.ok(writable);
			const writer = writable.getWriter();
			await writer.write(Uint8Array.of(1, 2, 3));
			await writer.close();
			return { blob: null, byteLength: 3, manifest: { format: 'scape-project' } };
		},
		setStatus(message: string) { events.push(`status:${message}`); },
		publishDocumentSnapshot() {},
	} as unknown as NativeProjectServiceRuntime;
	return { events, state, service: createNativeProjectService(runtime) };
}
