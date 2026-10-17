/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MotionAsset } from '../../motion-asset.ts';
import type { MotionAssetBody } from '../../motion-asset-body.ts';
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from '../../motion-link-protocol.ts';
import { MOTION_LINK_WIRE_CHUNK_BYTES, type MotionLinkResponse } from '../../motion-link-wire.ts';
import { createMotionLinkRpc } from './internal/motion-link-rpc.ts';

export interface MotionLinkPortOptions { readonly port: MessagePort; readonly session: string; readonly signal?: AbortSignal; readonly idleTimeoutMs?: number }
export interface MotionLinkRemoteAssets {
	readonly signal: AbortSignal;
	readAsset(asset: MotionAsset, signal?: AbortSignal): Promise<MotionAssetBody | null>;
}
export interface MotionLinkPortSenderOptions extends MotionLinkPortOptions {
	readonly offer: unknown;
	readAsset(asset: MotionAsset, signal?: AbortSignal): Promise<MotionAssetBody | null>;
}
export interface MotionLinkPortReceiverOptions extends MotionLinkPortOptions {
	readonly persistent?: boolean;
	/** Resolve only after private digest-verified staging and atomic receiver publication have succeeded. */
	receive(offer: MotionCompositionOffer, assets: MotionLinkRemoteAssets): Promise<void>;
}
function ack(response: MotionLinkResponse): void { if (response.kind !== 'ack') throw new Error('Motion link expected an acknowledgement.'); }

export interface MotionCompositionPortSender { readonly closed: Promise<void>; send(offer: unknown): Promise<string>; dispose(): Promise<void> }
/** One connected source identity, one update in flight, and no queue of saved revisions. */
export function createMotionCompositionPortSender(options: Omit<MotionLinkPortSenderOptions, 'offer'>): MotionCompositionPortSender {
	options.signal?.throwIfAborted(); let assets = new Map<string, MotionAsset>(); let identity: string | null = null; let sending = false;

	let active: { reader: ReadableStreamDefaultReader<Uint8Array>; asset: MotionAsset; offset: number; ended: boolean } | null = null;
	let publishing = false; let assetClosing: Promise<void> | null = null; let disposal: Promise<void> | null = null;
	function closeAsset(): Promise<void> {
		const current = active; active = null; if (!current) return assetClosing ?? Promise.resolve();
		assetClosing = (async () => { try { if (!current.ended) await current.reader.cancel(); } finally { current.reader.releaseLock(); } })().finally(() => { assetClosing = null; });
		return assetClosing;
	}
	const rpc = createMotionLinkRpc(options.port, options.session, async (request, signal) => {
		signal.throwIfAborted(); if (!publishing) throw new Error('Motion link requested assets before an offer.');
		if (request.kind === 'asset-open') {
			if (active) throw new Error('Motion link opened a second concurrent asset.');
			const asset = assets.get(request.digest); if (!asset) throw new Error('Motion link requested an asset outside its closure.');
			const body = await options.readAsset(asset, signal); signal.throwIfAborted();
			if (!body || body.size !== asset.byteLength) throw new Error('Motion link retained asset is unavailable.');
			active = { reader: body.stream().getReader(), asset, offset: 0, ended: false }; return { kind: 'asset-size', byteLength: body.size };
		}
		if (request.kind === 'asset-next') {
			const current = active; if (!current || current.ended || request.offset !== current.offset) throw new Error('Motion link asset acknowledgement changed.');
			const result = await current.reader.read(); signal.throwIfAborted();
			if (result.done) { if (current.offset !== current.asset.byteLength) throw new Error('Motion link asset ended early.'); current.ended = true; return { kind: 'asset-chunk', offset: current.offset, bytes: null }; }
			const bytes = result.value;
			if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MOTION_LINK_WIRE_CHUNK_BYTES || bytes.length > current.asset.byteLength - current.offset) throw new Error('Motion link asset exceeds its chunk or length contract.');
			const offset = current.offset; current.offset += bytes.length;
			return { kind: 'asset-chunk', offset, bytes: bytes.slice().buffer };
		}
		if (request.kind === 'asset-close') { await closeAsset(); return { kind: 'ack' }; }
		throw new Error('Motion link sender received an invalid request.');
	}, { ...options, allowIdle: () => !sending });
	const cancel = () => { void closeAsset().catch(() => undefined); }; rpc.signal.addEventListener('abort', cancel, { once: true });
	const closed = new Promise<void>((resolve) => { rpc.signal.addEventListener('abort', () => resolve(), { once: true }); if (rpc.signal.aborted) resolve(); });
	return {
		closed,
		async send(value) {
			rpc.signal.throwIfAborted(); if (sending) throw new Error('Motion link permits one saved update in flight.');
			const offer = normalizeMotionCompositionOffer(value); const key = `${offer.revision.projectId}/${offer.compositionId}`;
			if (identity && identity !== key) throw new Error('Motion link source project/composition identity changed.'); identity = key;
			assets = new Map(offer.revision.project.assets.map((asset) => [asset.sha256, asset])); sending = true; publishing = false;
			try {
				const bytes = new TextEncoder().encode(JSON.stringify(offer)); ack(await rpc.request({ kind: 'offer-start', byteLength: bytes.length }));
				for (let offset = 0; offset < bytes.length; offset += MOTION_LINK_WIRE_CHUNK_BYTES) ack(await rpc.request({ kind: 'offer-chunk', offset, bytes: bytes.slice(offset, offset + MOTION_LINK_WIRE_CHUNK_BYTES).buffer }));
				publishing = true; const result = await rpc.request({ kind: 'publish' });
				if (result.kind !== 'published' || result.digest !== offer.revision.digest) throw new Error('Motion link receiver acknowledged a different revision.'); return result.digest;
			} catch (error) { rpc.fail(error); throw error; }
			finally { publishing = false; sending = false; await closeAsset(); }
		},
		dispose() {
			if (disposal) return disposal; rpc.fail(new DOMException('Motion link disconnected.', 'AbortError')); rpc.signal.removeEventListener('abort', cancel);
			disposal = (async () => { try { await closeAsset(); } finally { await rpc.dispose(); } })(); return disposal;
		},
	};
}
/** Convenience for a single saved offer; connected editors use the reusable sender above. */
export async function sendMotionCompositionPort(options: MotionLinkPortSenderOptions): Promise<string> {
	const sender = createMotionCompositionPortSender(options); try { return await sender.send(options.offer); } finally { await sender.dispose(); }
}

/** Receiver allocates bounded metadata, then pulls each next chunk only after the caller retained the previous one. */
export async function receiveMotionCompositionPort(options: MotionLinkPortReceiverOptions): Promise<string> {
	let metadata: Uint8Array | null = null; let offset = 0; let started = false; let publishing = false;
	let identity: string | null = null; let published: string | null = null; let complete!: (digest: string) => void; let failed!: (error: unknown) => void;
	const completion = new Promise<string>((resolve, reject) => { complete = resolve; failed = reject; });
	const rpc = createMotionLinkRpc(options.port, options.session, async (request, signal) => {
		signal.throwIfAborted();
		if (request.kind === 'offer-start') {
			if (started) throw new Error('Motion link accepts one offer in flight.'); started = true;
			published = null; offset = 0; metadata = new Uint8Array(request.byteLength); return { kind: 'ack' };
		}
		if (request.kind === 'offer-chunk') {
			if (!metadata || publishing || request.offset !== offset || request.bytes.byteLength > metadata.length - offset) throw new Error('Motion link metadata chunk changed its sequence or length.');
			metadata.set(new Uint8Array(request.bytes), offset); offset += request.bytes.byteLength; return { kind: 'ack' };
		}
		if (request.kind !== 'publish' || publishing || !metadata || offset !== metadata.length) throw new Error('Motion link cannot publish an incomplete offer.');
		publishing = true;
		const offer = normalizeMotionCompositionOffer(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata)) as unknown); metadata = null;
		const key = `${offer.revision.projectId}/${offer.compositionId}`;
		if (identity && identity !== key) throw new Error('Motion link receiver source identity changed.'); identity = key;
		const assets = new Map(offer.revision.project.assets.map((asset) => [asset.sha256, asset])); const finished = new Set<string>(); let reading = false;
		await options.receive(offer, { signal, async readAsset(asset, suppliedSignal) {
			signal.throwIfAborted(); suppliedSignal?.throwIfAborted();
			const retained = assets.get(asset.sha256);
			if (!retained || retained.byteLength !== asset.byteLength || reading || finished.has(asset.sha256)) throw new Error('Motion link asset request exceeds its retained sequential closure.'); reading = true;
			const opened = await rpc.request({ kind: 'asset-open', digest: asset.sha256 });
			if (opened.kind !== 'asset-size' || opened.byteLength !== asset.byteLength) throw new Error('Motion link asset size differs from the retained offer.');
			let position = 0; let streamTaken = false; const hash = sha256.create();
			return { size: asset.byteLength, stream() {
				if (streamTaken) throw new Error('Motion link asset stream is single-use.'); streamTaken = true;
				return new ReadableStream<Uint8Array>({ async pull(controller) {
					try {
						signal.throwIfAborted(); suppliedSignal?.throwIfAborted(); const result = await rpc.request({ kind: 'asset-next', offset: position });
						if (result.kind !== 'asset-chunk' || result.offset !== position) throw new Error('Motion link asset chunk changed its acknowledgement.');
						if (result.bytes === null) {
							if (position !== asset.byteLength || bytesToHex(hash.digest()) !== asset.sha256) throw new Error('Motion link asset digest or length differs from its offer.');
							ack(await rpc.request({ kind: 'asset-close' })); finished.add(asset.sha256); reading = false; controller.close(); return;
						}
						if (result.bytes.byteLength > asset.byteLength - position) throw new Error('Motion link asset exceeded its declared length.');
						const bytes = new Uint8Array(result.bytes); hash.update(bytes); position += bytes.length; controller.enqueue(bytes);
					} catch (error) { controller.error(error); rpc.fail(error); }
				}, async cancel() { reading = false; if (!signal.aborted) ack(await rpc.request({ kind: 'asset-close' })); } }, { highWaterMark: 0 });
			} };
		} });
		signal.throwIfAborted(); if (finished.size !== assets.size || reading) throw new Error('Motion link receiver did not retain the complete asset closure.');
		return { kind: 'published', digest: offer.revision.digest };
	}, { ...options, allowIdle: () => Boolean(options.persistent && !started), onHandled(response) { if (response.kind === 'published') { published = response.digest; if (options.persistent) { started = false; publishing = false; } } }, onPeerClose() { if (published) complete(published); } });
	const cancelled = () => { failed(rpc.signal.reason as unknown); }; rpc.signal.addEventListener('abort', cancelled, { once: true }); if (rpc.signal.aborted) cancelled();
	try { return await completion; } finally { metadata = null; rpc.signal.removeEventListener('abort', cancelled); await rpc.dispose(); }
}
