/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	consolidateProjectMedia,
	planProjectConsolidation,
	type ConsolidateMediaStore,
} from '../src/common/editor/controller/consolidate-media-service.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

const AUDIO = Uint8Array.from({ length: 4_096 }, (_value, index) => index % 251);
const AUDIO_DIGEST = digestScapeBytes(AUDIO);

test('a linked source is copied under its own key and then unlinked, in that order', async () => {
	const store = createStore();
	const { plan, run } = await consolidateProjectMedia({
		projectId: 'project-1',
		project: project(),
		store: store.value,
	});

	assert.deepEqual(plan.copy.map(({ sourceId }) => sourceId), ['linked-audio']);
	assert.equal(run.complete, true);
	assert.deepEqual(run.sources.map(({ outcome }) => outcome), ['copied']);
	// One resolve answers the reachability question at plan time; the writer then
	// pulls the second. The copy lands under the source's own key while the link
	// still stands, and the unlink is what flips the source over to it.
	assert.deepEqual(store.events, [
		'resolve-audio', 'begin-write:linked-audio', 'resolve-audio',
		'commit:linked-audio', 'load:linked-audio', 'unlink-audio:linked-audio',
	]);
	assert.deepEqual(store.written.get('linked-audio'), AUDIO);
	assert.deepEqual(store.unlinked, [{ sourceId: 'linked-audio', token: 'token-1' }]);
});

test('the storage layer is told what body it is receiving', async () => {
	const store = createStore();
	await consolidateProjectMedia({ projectId: 'project-1', project: project(), store: store.value });

	assert.deepEqual(store.writeOptions, [{
		expectedBytes: AUDIO.byteLength,
		expectedSha256: AUDIO_DIGEST,
	}]);
});

test('an unreachable original is planned as unreachable rather than attempted', async () => {
	const store = createStore({ resolveFails: true });
	const plan = await planProjectConsolidation({
		projectId: 'project-1', project: project(), store: store.value,
	});

	assert.equal(plan.complete, false);
	assert.deepEqual(plan.unreachable.map(({ sourceId }) => sourceId), ['linked-audio']);
	assert.deepEqual(plan.copy, []);
});

test('planning propagates cancellation instead of reporting originals as unreachable', async () => {
	const store = createStore();
	const controller = new AbortController();
	const reason = new DOMException('operator cancelled consolidation', 'AbortError');
	store.value.resolveLinkedAudioOriginal = async () => {
		controller.abort(reason);
		throw reason;
	};

	await assert.rejects(planProjectConsolidation({
		projectId: 'project-1', project: project(), store: store.value,
		signal: controller.signal,
	}), (error) => error === reason);
});

test('a source with no binding is already managed and is never read or written', async () => {
	const store = createStore({ binding: null });
	const { plan, run } = await consolidateProjectMedia({
		projectId: 'project-1', project: project(), store: store.value,
	});

	assert.deepEqual(plan.copy, []);
	assert.equal(run.complete, true);
	assert.deepEqual(store.events, []);
});

test('a video source resolves and unlinks through the video verbs', async () => {
	const store = createStore({ kind: 'video' });
	const { run } = await consolidateProjectMedia({
		projectId: 'project-1',
		project: { sources: [{ id: 'linked-audio', kind: 'video' }], clips: [{ sourceId: 'linked-audio' }] },
		store: store.value,
	});

	assert.equal(run.complete, true);
	assert.ok(store.events.includes('resolve-video'));
	assert.ok(store.events.includes('unlink-video:linked-audio'));
	assert.equal(store.events.includes('unlink-audio:linked-audio'), false);
});

test('an unlink that loses its compare-and-swap race is reported, not retried', async () => {
	const store = createStore({ unlinkSucceeds: false });
	const { run } = await consolidateProjectMedia({
		projectId: 'project-1', project: project(), store: store.value,
	});

	assert.deepEqual(run.sources.map(({ outcome }) => outcome), ['rebind-superseded']);
	assert.equal(run.complete, false);
});

test('consolidate never deletes media, even to clean up after itself', async () => {
	const store = createStore({ unlinkSucceeds: false });
	await consolidateProjectMedia({ projectId: 'project-1', project: project(), store: store.value });

	// A managed body is immutable once committed, and an unreferenced one is
	// ordinary maintenance's to collect. Giving this operation a delete would be
	// giving it the one power the linked-media lifecycle says it must not have.
	assert.equal(Object.hasOwn(store.value, 'deleteMediaAsset'), false);
	assert.equal(store.written.has('linked-audio'), true);
});

function project() {
	return { sources: [{ id: 'linked-audio', kind: 'audio' }], clips: [{ sourceId: 'linked-audio' }] };
}

function createStore(options: {
	binding?: Record<string, unknown> | null;
	kind?: 'audio' | 'video';
	resolveFails?: boolean;
	unlinkSucceeds?: boolean;
} = {}) {
	const events: string[] = [];
	const written = new Map<string, Uint8Array>();
	const unlinked: { sourceId: string; token: string }[] = [];
	const writeOptions: Record<string, unknown>[] = [];
	const kind = options.kind ?? 'audio';
	const binding = options.binding === undefined
		? {
			schemaVersion: 2,
			kind,
			projectId: 'project-1',
			sourceId: 'linked-audio',
			storageKey: 'linked/original',
			byteLength: AUDIO.byteLength,
			sha256: AUDIO_DIGEST,
			bindingToken: 'token-1',
		}
		: options.binding;

	const resolve = (label: string) => async () => {
		events.push(label);
		if (options.resolveFails) throw new Error('the drive is not plugged in');
		return { blob: new Blob([AUDIO]) };
	};

	const value: ConsolidateMediaStore = {
		async getLinkedOriginalBinding() { return binding; },
		resolveLinkedAudioOriginal: resolve('resolve-audio') as never,
		resolveLinkedVideoOriginal: resolve('resolve-video') as never,
		async beginMediaAssetWrite(sourceId, _metadata, writeOptionsValue) {
			events.push(`begin-write:${sourceId}`);
			writeOptions.push({
				expectedBytes: writeOptionsValue.expectedBytes,
				expectedSha256: writeOptionsValue.expectedSha256,
			});
			const collected: number[] = [];
			return {
				maximumChunkBytes: 512,
				async write(bytes: Uint8Array) {
					if (bytes.byteLength > 512) throw new Error('the writer was handed an oversized chunk');
					collected.push(...bytes);
				},
				async commit() {
					events.push(`commit:${sourceId}`);
					written.set(sourceId, Uint8Array.from(collected));
					return {};
				},
				async abort() { events.push(`abort:${sourceId}`); },
			};
		},
		async loadMediaAsset(sourceId) {
			events.push(`load:${sourceId}`);
			const bytes = written.get(sourceId);
			return bytes ? new Blob([bytes.slice().buffer]) as never : null;
		},
		async unlinkLinkedAudioOriginal(_projectId, sourceId, token) {
			events.push(`unlink-audio:${sourceId}`);
			if (options.unlinkSucceeds === false) return false;
			unlinked.push({ sourceId, token });
			return true;
		},
		async unlinkLinkedVideoOriginal(_projectId, sourceId, token) {
			events.push(`unlink-video:${sourceId}`);
			if (options.unlinkSucceeds === false) return false;
			unlinked.push({ sourceId, token });
			return true;
		},
	};
	return { events, written, unlinked, writeOptions, value };
}
