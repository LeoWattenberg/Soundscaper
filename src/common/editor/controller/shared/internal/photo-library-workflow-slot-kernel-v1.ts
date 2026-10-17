/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryWorkflowSlotV1 } from '../photo-library-workflow-slot.ts';
import type { PhotoLibrarySessionPortV2 } from '../../../photo-library-session-port-v2.ts';
import type { CubeLutSourcePortV1 } from '../../../imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../../imaging/mask-raster-source-port-v1.ts';
import { captureMaskRasterSourceV1 } from '../../../imaging/mask-raster-source-scope-v1.ts';

type Profile = 'legacy2' | 'current3';
type SelectedSession = Pick<PhotoLibrarySessionPortV2, 'close' | 'cubeLuts' | 'maskRasterSource'>;
export interface PhotoLibraryWorkflowSlotKernelV1<Session extends SelectedSession, Runtime> extends Omit<PhotoLibraryWorkflowSlotV1, 'factory' | 'pending'> {
	readonly factory: (() => Promise<Session>) | undefined;
	readonly proxyFactory: ((source: Readonly<CubeLutSourcePortV1>, maskSource?: Readonly<MaskRasterSourcePortV1>) => Promise<Readonly<Runtime>>) | undefined;
	pending: Promise<Session> | null;
	proxyPending: Promise<Readonly<Runtime>> | null;
	closeOwner: (() => Promise<void>) | null;
}
function admit(profile: Profile): void { if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unknown selected photo profile.'); }
const nativeCheck = AbortSignal.prototype.throwIfAborted;
function check(current: Pick<PhotoLibraryWorkflowSlotV1, 'lifetime'>): void { Reflect.apply(nativeCheck, current.lifetime.signal, []); }

/** Register ownership before calling a lazy factory and pin the native owner's close receiver. */
export function acquirePhotoLibraryWorkflowSlotForProfileV1<Session extends SelectedSession, Runtime>(profile: Profile, current: PhotoLibraryWorkflowSlotKernelV1<Session, Runtime>): Promise<Session> {
	admit(profile);
	if (!current.live) return Promise.reject(new DOMException('The photo library generation is closed.', 'AbortError'));
	if (!current.pending) {
		const pending = Promise.resolve().then(async () => {
			if (current.beforeDrain) await current.beforeDrain;
			check(current);
			if (!current.factory) throw new Error('The photo library is unavailable.');
			const owner = await current.factory(), close = owner.close;
			if (typeof close !== 'function') throw new TypeError('The photo library owner cannot close.');
			current.closeOwner = () => Reflect.apply(close, owner, []) as Promise<void>;
			return owner;
		});
		current.pending = pending;
		void pending.catch(() => { if (current.pending === pending) current.pending = null; });
	}
	return current.pending;
}

/** One lazy renderer per generation, constructed with only that Session's captured source. */
export function loadPhotoLibraryDevelopProxyForProfileV1<Session extends SelectedSession, Runtime>(profile: Profile, current: PhotoLibraryWorkflowSlotKernelV1<Session, Runtime>): Promise<Readonly<Runtime>> {
	admit(profile);
	if (!current.live) return Promise.reject(new DOMException('The photo renderer generation is closed.', 'AbortError'));
	if (!current.proxyPending) {
		const pending = Promise.resolve().then(async () => {
			check(current);
			if (!current.proxyFactory) throw new Error('Photo develop preview is unavailable.');
			const owner = await acquirePhotoLibraryWorkflowSlotForProfileV1(profile, current); check(current);
			const selectedMaskSource = owner.maskRasterSource;
			const maskSource = selectedMaskSource === undefined ? undefined : captureMaskRasterSourceV1(selectedMaskSource);
			const source = owner.cubeLuts.source, withBytes = source.withBytes;
			if (typeof withBytes !== 'function') throw new TypeError('The selected library LUT source is unavailable.');
			const captured: Readonly<CubeLutSourcePortV1> = Object.freeze({
				withBytes<Result>(reference: Parameters<CubeLutSourcePortV1['withBytes']>[0], consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>,
					options?: Readonly<{ signal?: AbortSignal }>) { return Reflect.apply(withBytes, source, [reference, consume, options]) as Promise<Result>; },
			});
			check(current);
			const runtime = await current.proxyFactory(captured, maskSource); check(current); return runtime;
		});
		current.proxyPending = pending;
		void pending.catch(() => { if (current.proxyPending === pending && current.live) current.proxyPending = null; });
	}
	return current.proxyPending;
}

/** Fence synchronously, settle destinations, then join renderer creation and native close together. */
export function retirePhotoLibraryWorkflowSlotForProfileV1<Session extends SelectedSession, Runtime>(profile: Profile, current: PhotoLibraryWorkflowSlotKernelV1<Session, Runtime>, cancelDestinations: () => Promise<void>): Promise<void> {
	admit(profile);
	if (current.retirement) return current.retirement;
	let resolve!: () => void, reject!: (error: unknown) => void;
	const closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	current.retirement = closing; void closing.catch(() => undefined);
	current.live = false;
	const pending = current.pending, renderer = current.proxyPending;
	current.lifetime.abort(); current.active?.abort();
	let destinations: Promise<void>;
	try { destinations = cancelDestinations(); } catch (error) { destinations = Promise.reject(error); }
	void destinations.catch(() => undefined);
	void (async () => {
		const errors: unknown[] = [];
		const before = await Promise.allSettled([current.beforeDrain, destinations]);
		for (const result of before) if (result.status === 'rejected') errors.push(result.reason as unknown);
		await pending?.catch(() => undefined);
		const settled = await Promise.allSettled([renderer?.catch(() => undefined), Promise.resolve().then(() => current.closeOwner?.())]);
		for (const result of settled) if (result.status === 'rejected') errors.push(result.reason as unknown);
		if (errors.length === 1) throw errors[0];
		if (errors.length) throw new AggregateError(errors, 'Photo library generation cleanup failed.');
	})().then(resolve, reject);
	return closing;
}
