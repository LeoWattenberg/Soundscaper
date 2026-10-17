/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import React, { act } from 'react';
import { inflateSync } from 'node:zlib';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import PhotoJpegExportDialog from '../../src/common/editor/ui/lightscaper/PhotoJpegExportDialog.tsx';
import PhotoRasterExportSurface from '../../src/common/editor/ui/lightscaper/PhotoRasterExportSurface.tsx';
import type { PhotoRasterExportEntry } from '../../src/common/editor/ui/lightscaper/use-photo-raster-export-entry.ts';
import type { PhotoRasterExportPresetV1, PhotoLibraryExportPresetsPortV1 } from '../../src/common/editor/photo-library-export-presets-port-v1.ts';
import { createFileSystemPreparedSave, type PreparedDirectSave } from '../../src/common/editor/file-save-stream.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { PhotoExportDestinations } from '../../src/lightscaper/controller/photo-export-destinations.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { mountPhotoImportUi } from './photo-import-options-react-fixture.tsx';
import { deferred, settle, waitFor } from './async-test-control.ts';

export type SingleExportFormat = 'png' | 'jpeg';
type Stage = 'read' | 'write' | 'commit' | 'abort' | 'json' | 'preset';
type Gate = ReturnType<typeof deferred<void>>;
export const SINGLE_EXPORT_RGBA = [29, 101, 197, 255] as const;
// Explicit Node canvas adapter output; it does not qualify a native JPEG codec.
const JPEG = Uint8Array.of(255, 216, 255, 192, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
	255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 7, 255, 217);

export function singleExportQueueFixture(format: SingleExportFormat) {
	const destinations = new PhotoExportDestinations(), events: string[] = [], outputs: Uint8Array[] = [], json: string[] = [];
	const preparedSaves: PreparedDirectSave[] = [];
	const gates = new Map<Stage, { entered: Gate; release: Gate }>(), runtime = createPhotoDevelopRenderRuntimeV2();
	const source = photoArchiveFixture().photo;
	const photo = normalizePhotoDocumentV2({ ...source, schemaVersion: 2,
		versions: [{ ...source.versions[0]!, develop: defaultImageDevelopStateV2() }] });
	let pickers = 0, renders = 0, reads = 0, captures = 0, jsonAttempts = 0, closed = 0, hidden = 0;
	let jsonFailure: unknown, failJson = false, restored = false;
	const codecPixels: number[][] = [], codecOptions: ImageEncodeOptions[] = [], originals = new Map<string, PropertyDescriptor | undefined>();
	if (format === 'jpeg') {
		class Data { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
		class Canvas {
			constructor(public width: number, public height: number) {}
			getContext() { return { putImageData: (value: Data) => { assert.deepEqual([value.width, value.height], [1, 1]); codecPixels.push([...value.data]); } }; }
			convertToBlob(options: ImageEncodeOptions) { codecOptions.push(options); return Promise.resolve(new Blob([JPEG], { type: 'image/jpeg' })); }
		}
		for (const [name, value] of Object.entries({ ImageData: Data, OffscreenCanvas: Canvas })) {
			originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value });
		}
	}
	const pause = async (stage: Stage) => {
		const gate = gates.get(stage); if (!gate) return;
		events.push(`${stage}-entered`); gate.entered.resolve(); await gate.release.promise; events.push(`${stage}-released`);
	};
	const preset: PhotoRasterExportPresetV1 = { schemaVersion: 1, id: 'other-format', name: 'Other format', format: format === 'png' ? 'jpeg' : 'png',
		filenameTemplate: '{name}', sidecarEnabled: false, output: { sizing: { kind: 'original' }, quality: 'bilinear', metadataScope: 'strip' } };
	const openPresets: PhotoLibraryExportPresetsPortV1['open'] = async options => {
		options?.signal?.throwIfAborted(); return { catalogId: photo.catalogId,
			list: async () => ({ schemaVersion: 1, catalogId: photo.catalogId, revision: 1, presets: [{ id: preset.id, name: preset.name }] }),
			read: async (request, options) => { assert.equal(request.presetId, preset.id); await pause('preset'); options?.signal?.throwIfAborted(); return { preset }; },
			write: async () => assert.fail('The queue test only borrows a preset read.') };
	};
	const props: PhotoPngExportDialogProps = { locale: 'en', photoId: photo.id, fileName: 'Queue original.png', preparationFailed: false,
		execute: async (action, signal) => {
			assert.ok(signal); signal.throwIfAborted();
			await action({ signal, isCurrent: () => true, refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2,
				read: async () => { reads++; await pause('read'); signal.throwIfAborted(); return { schemaVersion: 2, catalogId: photo.catalogId, photoId: photo.id,
					revision: photo.revision, activeVersionId: photo.activeVersionId, versionId: photo.activeVersionId,
					versions: photo.versions.map(({ id, name, kind }) => ({ id, name, kind })), develop: photo.versions[0]!.develop,
					history: { cursor: 0, entries: [] }, snapshots: [] }; }, apply: async () => assert.fail('Export must not edit the Photo.') }) });
			return 'completed';
		},
		withOriginalFrame: async (request, consume) => {
			assert.equal(request.photoId, photo.id); assert.equal(request.expectedRevision, photo.revision); renders++; events.push('original');
			const value = await consume({ photoId: photo.id, revision: photo.revision,
				frame: { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.from(SINGLE_EXPORT_RGBA) } });
			events.push('original-settled'); return value;
		},
		loadRenderer: async () => runtime,
		captureSidecarReader: () => { captures++; return async binding => serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding)); },
		capturePresets: () => openPresets,
		saveRuntime: { maximumStreamingBytes: 536870912,
			prepareSave(request) {
				assert.equal(this, props.saveRuntime); pickers++; events.push('picker'); assert.equal(typeof request.suggestedName, 'string');
				if (typeof request.suggestedName !== 'string') throw new TypeError('Actual picker name must be a string.');
				const prepared = createFileSystemPreparedSave({ fileName: request.suggestedName, signal: request.signal,
					target: { createWritable: async () => ({
						write: async bytes => { assert.ok(bytes instanceof Uint8Array); outputs.push(bytes.slice()); events.push('write'); await pause('write'); },
						close: async () => { events.push('commit'); await pause('commit'); events.push('commit-ack'); },
						abort: async () => { events.push('abort'); await pause('abort'); events.push('abort-ack'); },
					}) } });
				preparedSaves.push(prepared); return prepared;
			},
			saveFile: async request => {
				assert.equal(request.mimeType, 'application/json'); assert.ok(request.blob); assert.equal(typeof request.suggestedName, 'string');
				if (typeof request.suggestedName !== 'string') throw new TypeError('Actual JSON name must be a string.'); jsonAttempts++;
				await pause('json'); request.signal?.throwIfAborted(); if (failJson) throw jsonFailure;
				json.push(await request.blob.text()); events.push('json-ack'); return { method: 'download', fileName: request.suggestedName, size: request.blob.size };
			} },
		registerDestination: join => destinations.register(join), onClose: () => { closed++; events.push('closed'); },
	};
	return { format, props, destinations, events, outputs, json, codecPixels, codecOptions, photo, preparedSaves,
		hold(stage: Stage) { assert.equal(gates.has(stage), false); const gate = { entered: deferred<void>(), release: deferred<void>() }; gates.set(stage, gate); return gate; },
		releaseAll() { for (const gate of gates.values()) gate.release.resolve(); },
		onHide() { hidden++; },
		setJsonFailure(value: unknown) { failJson = true; jsonFailure = value; }, clearJsonFailure() { failJson = false; },
		restoreCodec() { if (restored) return; restored = true; for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
		} },
		get pickers() { return pickers; }, get renders() { return renders; }, get reads() { return reads; }, get captures() { return captures; },
		get jsonAttempts() { return jsonAttempts; }, get closed() { return closed; }, get hidden() { return hidden; },
	};
}
export type SingleExportQueueFixture = ReturnType<typeof singleExportQueueFixture>;

export async function mountSingleExportQueue(f: SingleExportQueueFixture, surface = true) {
	let entry: PhotoRasterExportEntry = { key: 'single-job', generation: {}, mode: 'single', format: f.format, photoId: f.photo.id,
		fileName: f.props.fileName, visible: true, settled: false };
	const onHide = () => { f.onHide(); entry = { ...entry, visible: false }; };
	const render = () => {
		if (surface) return <PhotoRasterExportSurface {...f.props} entry={entry} captureJournal={() => async () => assert.fail('Single export never acquires a batch journal.')}
			workingLabel="Preparing export" onHide={onHide} onSettled={() => { entry = { ...entry, settled: true }; }} />;
		// The future optional presentation props are structurally valid on the current wrappers.
		const props: PhotoPngExportDialogProps & { visible: boolean; onHide: () => void } = { ...f.props, visible: entry.visible, onHide };
		return f.format === 'png' ? <PhotoPngExportDialog {...props} /> : <PhotoJpegExportDialog {...props} />;
	};
	const mounted = await mountPhotoImportUi(render);
	return { ...mounted, async ready() { await act(async () => { await waitFor(() => {
		const button = mounted.dom.find(`[data-photo-${f.format}-export-save]`); return button !== null && button.getAttribute('disabled') === null;
	}, 'selected single export readiness'); }); },
		async hide() { entry = { ...entry, visible: false }; await mounted.render(); },
		async reopen() { entry = { ...entry, visible: true }; await mounted.render(); },
		async replace(key: string, generation: unknown) { entry = { ...entry, key, generation, visible: true, settled: false }; await mounted.render(); },
	};
}

/** Run every cleanup even when an assertion or a native join fails, keeping exact opaque reasons. */
export async function withSingleExportQueue(format: SingleExportFormat, run: (f: SingleExportQueueFixture) => Promise<void>): Promise<void> {
	const f = singleExportQueueFixture(format), failures: unknown[] = [];
	try { await run(f); } catch (error) { failures.push(error); }
	f.releaseAll();
	try { await f.destinations.retireAndJoin(); } catch (error) { failures.push(error); }
	try { f.restoreCodec(); } catch (error) { failures.push(error); }
	const unique = failures.filter((failure, index) => failures.findIndex(value => Object.is(value, failure)) === index);
	if (unique.length === 1) throw unique[0];
	if (unique.length) throw new AggregateError(unique, 'Single export test and cleanup failed.', { cause: unique[0] });
}

export async function withMountedSingleExportQueue(f: SingleExportQueueFixture, run: (m: Awaited<ReturnType<typeof mountSingleExportQueue>>) => Promise<void>, surface = true): Promise<void> {
	const m = await mountSingleExportQueue(f, surface), failures: unknown[] = [];
	try { await run(m); } catch (error) { failures.push(error); }
	f.releaseAll();
	try { await act(async () => { await settle(); }); } catch (error) { failures.push(error); }
	try { await m.dispose(); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, 'Mounted single export cleanup failed.', { cause: failures[0] });
}

export function assertSingleExportPixels(f: SingleExportQueueFixture): void {
	assert.equal(f.outputs.length, 1); const bytes = f.outputs[0]!;
	if (f.format === 'jpeg') {
		assert.deepEqual(bytes, JPEG); assert.deepEqual(f.codecPixels, [[...SINGLE_EXPORT_RGBA]]);
		assert.deepEqual(f.codecOptions, [{ type: 'image/jpeg', quality: 0.9 }]); return;
	}
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), compressed: Uint8Array[] = [];
	for (let offset = 8; offset < bytes.length;) {
		const size = view.getUint32(offset), tag = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii');
		if (tag === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size)); offset += size + 12;
	}
	const decoded = inflateSync(Buffer.concat(compressed)); assert.deepEqual([...decoded], [0, ...SINGLE_EXPORT_RGBA]);
}
