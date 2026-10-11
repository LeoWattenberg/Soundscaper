/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAsset, type MotionAsset } from './motion-asset.ts';
import type { MotionAssetBody } from './motion-asset-body.ts';
import { createMotionscaperRevision, type MotionscaperRevision } from './motion-project-revision.ts';
import { MOTION_LINK_MAXIMUM_OFFER_BYTES } from './motion-link-protocol.ts';
import { MOTION_ARCHIVE_ASSET_KINDS, motionArchiveAssetEntry, validateMotionArchiveAssetClosure } from './motion-archive-contract.ts';
import { readScapeArchiveEnvelope, type ScapeArchiveEntry } from './scape-archive-envelope.ts';
import { createScapeDigest, scapeHex, verifyScapeAssetBytes } from './scape-archive-media.ts';
import { withScapeProjectInput, type ScapeProjectInput } from './scape-project-input.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from './scape-abort.ts';
import { MOTION_SAVED_FILE_CHUNK_BYTES } from './motion-saved-file-contract.ts';
export interface MotionSavedArchiveSource {
	readonly revision: MotionscaperRevision;
	readAsset(asset: MotionAsset, signal?: AbortSignal): Promise<MotionAssetBody | null>;
}
interface ActiveStream { readonly settled: Promise<void>; stop(): Promise<void>; readonly failure: unknown }

/** The callback owns only this verified saved document and its bounded original-asset readers. */
export async function withMotionSavedArchiveSource<Value>(input: ScapeProjectInput, action: (source: MotionSavedArchiveSource) => Promise<Value>, signal?: AbortSignal): Promise<Value> {
	return withScapeProjectInput(input, signal, async entries => {
		const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: MOTION_LINK_MAXIMUM_OFFER_BYTES }, signal, MOTION_ARCHIVE_ASSET_KINDS);
		verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'saved Motion project');
		const revision = createMotionscaperRevision(JSON.parse(envelope.projectText) as unknown);
		validateMotionArchiveAssetClosure(revision.project, envelope.manifest.assets);
		const assets = new Map(revision.project.assets.map(asset => [asset.id, asset])), streams = new Set<ActiveStream>();
		let open = true, active = false, failed = false, primary: unknown, value: Value | undefined;
		try {
			value = await action({ revision, readAsset: (requested, assetSignal) => {
				throwIfScapeAborted(signal); throwIfScapeAborted(assetSignal); if (!open) return Promise.reject(new Error('Saved Motion archive source is closed.'));
				const asset = assets.get(requested.id);
				if (!asset || JSON.stringify(asset) !== JSON.stringify(normalizeMotionAsset(requested))) return Promise.reject(new Error('Requested Motion asset descriptor is outside the saved closure.'));
				const entry = envelope.entryByName.get(motionArchiveAssetEntry(asset)); if (!entry?.getData) return Promise.reject(new Error('Saved Motion archive is missing an original asset.'));
				let taken = false;
				return Promise.resolve({ size: asset.byteLength, stream() {
					if (!open || taken || active) throw new Error('Saved Motion asset streams require one live, single-use reader.'); taken = true; active = true;
					const stream = assetStream(entry, asset, [signal, assetSignal].filter((item): item is AbortSignal => item !== undefined), () => { active = false; });
					streams.add(stream.owner); return stream.readable;
				} });
			} });
			throwIfScapeAborted(signal);
		} catch (error) { failed = true; primary = error; }
		open = false; const cleanup: unknown[] = [];
		for (const stream of streams) { try { await stream.stop(); } catch (error) { cleanup.push(error); } }
		for (const stream of streams) { await stream.settled; if (!failed && stream.failure !== undefined) { failed = true; primary = stream.failure; } }
		if (failed) throw aggregateScapeErrors(primary, cleanup, 'Motion saved archive consumption and cleanup failed.');
		if (cleanup.length) throw new AggregateError(cleanup, 'Motion saved archive cleanup failed.'); return value as Value;
	});
}

function assetStream(entry: ScapeArchiveEntry, asset: MotionAsset, signals: readonly AbortSignal[], finished: () => void): Readonly<{ readable: ReadableStream<Uint8Array>; owner: ActiveStream }> {
	const cancellation = new AbortController(), signal = AbortSignal.any([cancellation.signal, ...signals]);
	const transport = new TransformStream<Uint8Array, Uint8Array>(), writer = transport.writable.getWriter(), reader = transport.readable.getReader();
	const digest = createScapeDigest(); let bytes = 0, stopped = false, done = false, failure: unknown;
	let stopping: Promise<void> | null = null;
	async function stop(): Promise<void> {
		if (stopping) return stopping; stopped = true;
		stopping = Promise.resolve().then(async () => { cancellation.abort(); try { await reader.cancel(signal.reason); } catch (error) { if (error !== failure && error !== signal.reason) throw error; } }); return stopping;
	}
	const abort = () => { void stop().catch(error => { failure ??= error; }); };
	signal.addEventListener('abort', abort, { once: true });
	const settled = (async () => {
		try {
			await entry.getData!(new WritableStream<Uint8Array>({ async write(chunk) {
				throwIfScapeAborted(signal); if (!(chunk instanceof Uint8Array) || chunk.length > asset.byteLength - bytes) throw new Error('Saved Motion asset exceeds its declared byte length.');
				for (let offset = 0; offset < chunk.length; offset += MOTION_SAVED_FILE_CHUNK_BYTES) {
					throwIfScapeAborted(signal); const part = chunk.slice(offset, offset + MOTION_SAVED_FILE_CHUNK_BYTES); digest.update(part); bytes += part.length; await writer.write(part);
				}
			} }), { signal, strictness: 'strict', checkOverlappingEntry: true });
			throwIfScapeAborted(signal); if (bytes !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) throw new Error('Saved Motion asset digest or byte length differs from its closure.');
			done = true; await writer.close();
		} catch (error) {
			if (!stopped && !signal.aborted) failure = error;
			try { await writer.abort(error); } catch (cleanup) { if (cleanup !== error && cleanup !== signal.reason) failure = aggregateScapeErrors(error, [cleanup], 'Motion asset read and cleanup failed.'); }
		} finally { signal.removeEventListener('abort', abort); writer.releaseLock(); finished(); }
	})();
	const readable = new ReadableStream<Uint8Array>({ async pull(controller) {
		try { throwIfScapeAborted(signal); const result = await reader.read(); throwIfScapeAborted(signal); if (result.done) controller.close(); else controller.enqueue(result.value); }
		catch (error) { controller.error(error); }
	}, cancel: stop }, { highWaterMark: 0 });
	return { readable, owner: { settled, get failure() { return failure; }, async stop() { if (!done) await stop(); await settled; reader.releaseLock(); } } };
}
