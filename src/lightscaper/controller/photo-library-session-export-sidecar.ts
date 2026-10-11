/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryExportSidecarRequest, PhotoLibraryExportJournalPort } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryExportJournalHostV1, PhotoLibraryExportJournalHostCurrentV1 } from './internal/photo-library-export-journal-kernel-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../catalog/photo-export-sidecar-current-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { admitPhotoLibraryExportSidecarBindingV1, readPhotoLibraryExportSignalOptionsV1 } from './internal/photo-library-export-request-v1.ts';

interface SidecarHost {
	readonly ready: () => Promise<string>;
	readonly catalog: Pick<PhotoLibrarySessionPortsCurrentV1['catalog'], 'loadPhoto'>;
	readonly operation: PhotoLibraryExportJournalHostV1['operation'];
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

export function readPhotoLibrarySessionExportSidecarForProfileV1(profile: 'legacy2' | 'current3', host: SidecarHost, value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<string> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed Session sidecar profile.');
	const { signal } = profile === 'current3' ? readPhotoLibraryExportSignalOptionsV1(options) : readPhotoDevelopSignalOptionsV2(options);
	const run = host.operation, initialize = host.ready, catalog = host.catalog, load = catalog.loadPhoto;
	let binding!: Readonly<PhotoLibraryExportSidecarRequest>;
	return Reflect.apply(run, host, [async (admitted: AbortSignal) => {
		try {
			const catalogId = await Reflect.apply(initialize, host, []) as string; check(admitted);
			if (catalogId !== binding.catalogId) throw new Error('Photo sidecar selected catalog changed.');
			const photo = await Reflect.apply(load, catalog, [catalogId, binding.photoId]) as unknown; check(admitted);
			if (!photo) throw new ReferenceError('The photo is missing.');
			const text = profile === 'current3' ? serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo, binding))
				: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding));
			check(admitted); return text;
		} catch (error) { if (profile === 'current3') check(admitted); throw error; }
	}, signal, () => { binding = admitPhotoLibraryExportSidecarBindingV1(value); }]) as Promise<string>;
}

export function createPhotoLibrarySessionExportJournalPortV1(profile: 'legacy2', host: PhotoLibraryExportJournalHostV1): Readonly<PhotoLibraryExportJournalPort>;
export function createPhotoLibrarySessionExportJournalPortV1(profile: 'current3', host: PhotoLibraryExportJournalHostCurrentV1): Readonly<PhotoLibraryExportJournalPort>;
export function createPhotoLibrarySessionExportJournalPortV1(profile: 'legacy2' | 'current3', host: PhotoLibraryExportJournalHostV1 | PhotoLibraryExportJournalHostCurrentV1): Readonly<PhotoLibraryExportJournalPort> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed Session journal profile.');
	const initialize = host.ready, run = host.operation, original = host.loadOriginal, verify = host.verifyResources;
	const packet = Object.freeze({ settings: host.settings, catalog: host.catalog,
		ready: () => Reflect.apply(initialize, host, []) as Promise<string>,
		operation: <Result>(work: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal, admit?: () => void) =>
			Reflect.apply(run<Result>, host, [work, caller, admit]) as Promise<Result>,
		...(original ? { loadOriginal: (...args: Parameters<typeof original>) => Reflect.apply(original, host, args) as ReturnType<typeof original> } : {}),
		...(verify ? { verifyResources: (...args: Parameters<NonNullable<typeof verify>>) => Reflect.apply(verify, host, args) as Promise<void> } : {}) });
	return Object.freeze({ open(options: Readonly<{ signal?: AbortSignal }> = {}) {
		const { signal } = profile === 'current3' ? readPhotoLibraryExportSignalOptionsV1(options) : readPhotoDevelopSignalOptionsV2(options);
		return Reflect.apply(run, host, [async (admitted: AbortSignal) => {
			const open = profile === 'current3' ? (await import('./photo-library-export-journal-current-session.ts')).openPhotoLibraryExportJournalCurrentSession
				: (await import('./photo-library-export-journal-session.ts')).openPhotoLibraryExportJournalSession;
			check(admitted); return Reflect.apply(open, undefined, [packet, { signal }]) as ReturnType<typeof open>;
		}, signal]) as ReturnType<PhotoLibraryExportJournalPort['open']>;
	} });
}
