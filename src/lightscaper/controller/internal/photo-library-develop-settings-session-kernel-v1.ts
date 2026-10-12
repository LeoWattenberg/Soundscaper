/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopBatchRequestV2, PhotoLibraryDevelopBatchReceiptV2, PhotoLibraryDevelopBatchOutcomeV2,
	PhotoLibraryDevelopSettingsPortV2 } from '../../../common/editor/photo-library-develop-settings-port-v2.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { array, field, id, integer, name, oneOf, record, utcTimestamp } from '../../catalog/value-validation.ts';
import type { PhotoCommandOwnerCurrentV1 } from '../photo-command-owner-current-v1.ts';
import type { PhotoLibraryDevelopSettingsPortV3, PhotoLibraryDevelopBatchRequestV3, PhotoLibraryDevelopBatchReceiptV3 } from '../../../common/editor/photo-library-develop-settings-port-v3.ts';
import { copyImageDevelopSettingsV3, adjustImageDevelopSettingsV3 } from '../../../common/editor/imaging/image-develop-settings-v3.ts';
import { createPhotoDevelopSelectedSettingsCurrentV1, type PhotoDevelopSelectedSettingsHostCurrentV1 } from '../photo-library-develop-settings-selected-current-v1.ts';
import type { PhotoCommandOwnerV2 } from '../photo-command-owner-v2.ts';
import { adjustImageDevelopSettingsV2, copyImageDevelopSettingsV2, mergeImageDevelopSettingsV2, normalizeImageDevelopSettingsPacketV1OrV2 } from '../../../common/editor/imaging/image-develop-settings-v2.ts';
import { normalizeImageDevelopRelativeActionV1, checkImageDevelopSettingsBytesV1 } from '../../../common/editor/imaging/image-develop-settings-v1.ts';

export interface PhotoLibraryDevelopSettingsSessionHostV2 {
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly withPhoto: <Result>(catalogId: string, photoId: string, signal: AbortSignal,
		run: (owner: PhotoCommandOwnerV2, signal: AbortSignal) => Promise<Result>) => Promise<Result>;
}
export interface PhotoLibraryDevelopSettingsSessionHostCurrentV1 extends PhotoDevelopSelectedSettingsHostCurrentV1 {
	readonly mutate: PhotoLibraryDevelopSettingsSessionHostV2['mutate'];
	readonly withPhoto: <Result>(catalogId: string, photoId: string, signal: AbortSignal,
		run: (owner: PhotoCommandOwnerCurrentV1, signal: AbortSignal) => Promise<Result>) => Promise<Result>;
}
type Profile = 'legacy2' | 'current3';
type Host = PhotoLibraryDevelopSettingsSessionHostV2 | PhotoLibraryDevelopSettingsSessionHostCurrentV1;
type Request = PhotoLibraryDevelopBatchRequestV2 | PhotoLibraryDevelopBatchRequestV3;
type Receipt = PhotoLibraryDevelopBatchReceiptV2 | PhotoLibraryDevelopBatchReceiptV3;
type Selected = ReturnType<typeof createPhotoDevelopSelectedSettingsCurrentV1>;
type Owner = PhotoCommandOwnerV2 | PhotoCommandOwnerCurrentV1;
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

export function createPhotoLibraryDevelopSettingsSessionForProfileV1(profile: 'legacy2', host: PhotoLibraryDevelopSettingsSessionHostV2): Readonly<PhotoLibraryDevelopSettingsPortV2>;
export function createPhotoLibraryDevelopSettingsSessionForProfileV1(profile: 'current3', host: PhotoLibraryDevelopSettingsSessionHostCurrentV1): Readonly<PhotoLibraryDevelopSettingsPortV3>;
/** One fixed-profile writer/batch loop. Current copy admits resources only
 * through its same-child selected source adapter; legacy behavior stays strict. */
export function createPhotoLibraryDevelopSettingsSessionForProfileV1(profile: Profile, host: Host): Readonly<PhotoLibraryDevelopSettingsPortV2 | PhotoLibraryDevelopSettingsPortV3> {
	assertProfile(profile); const mutate = host.mutate, withPhoto = host.withPhoto;
	if (typeof mutate !== 'function' || typeof withPhoto !== 'function') throw new TypeError('Develop batches require the Session writer and photo owner.');
	const pinned = { mutate: (run: Parameters<typeof mutate>[0], signal?: AbortSignal) => Reflect.apply(mutate, host, [run, signal]) as Promise<unknown>,
		withPhoto: (catalogId: string, photoId: string, signal: AbortSignal, run: (owner: Owner, signal: AbortSignal) => Promise<void>) => Reflect.apply(withPhoto, host, [catalogId, photoId, signal, run]) as Promise<void> };
	const selected = profile === 'current3' ? createPhotoDevelopSelectedSettingsCurrentV1(host as PhotoLibraryDevelopSettingsSessionHostCurrentV1) : undefined;
	return Object.freeze({ copy: profile === 'legacy2' ? copyImageDevelopSettingsV2 : copyImageDevelopSettingsV3,
		merge: selected ? selected.merge : mergeImageDevelopSettingsV2, adjust: profile === 'legacy2' ? adjustImageDevelopSettingsV2 : adjustImageDevelopSettingsV3,
		...(selected ? { copySelected: selected.copySelected } : {}),
		async applyBatch(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}) {
			if (profile === 'current3') {
				const native = Object.getOwnPropertyDescriptor(options, 'signal');
				if (native && Object.hasOwn(native, 'value')) check(native.value as AbortSignal | undefined);
			}
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			if (profile === 'current3') check(signal);
			let request: Request;
			try { request = normalizePhotoLibraryDevelopBatchForProfileV1(profile, value, selected); } catch (error) { if (profile === 'current3') check(signal); throw error; }
			check(signal); return applyBatch(profile, pinned, request, selected, signal);
		} }) as Readonly<PhotoLibraryDevelopSettingsPortV2 | PhotoLibraryDevelopSettingsPortV3>;
}

/** Snap every target and the single shared action before any initialization, lease or await. */
export function normalizePhotoLibraryDevelopBatchForProfileV1(profile: Profile, value: unknown, selected?: Selected): Request {
	assertProfile(profile); const schemaVersion = profile === 'current3' ? 3 : 2;
	const input = record(value, 'Develop batch', ['schemaVersion', 'catalogId', 'targets', 'action', 'label', 'createdAt']);
	if (field(input, 'schemaVersion') !== schemaVersion) throw new RangeError('Unsupported Develop batch version.');
	const seen = new Set<string>();
	const targets = array(field(input, 'targets'), 'Develop batch targets', 1, 64).map(value => {
		const target = record(value, 'Develop batch target', ['photoId', 'versionId', 'expectedRevision']);
		const photoId = id(field(target, 'photoId'), 'Develop target photo ID');
		if (seen.has(photoId)) throw new RangeError('Develop batch has duplicate photo identities.');
		seen.add(photoId);
		return Object.freeze({ photoId, versionId: id(field(target, 'versionId'), 'Develop target version ID'),
			expectedRevision: integer(field(target, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop target revision') });
	});
	const actionInput = record(field(input, 'action'), 'Develop batch action', ['kind', 'settings', 'effectType', 'changes'], ['kind']);
	const kind = oneOf(field(actionInput, 'kind'), ['paste', 'relative'] as const, 'Develop batch action kind');
	let action: Request['action'];
	if (kind === 'paste') {
		record(actionInput, 'Develop batch paste', ['kind', 'settings']);
		action = Object.freeze({ kind, settings: selected ? selected.admit(field(actionInput, 'settings'), id(field(input, 'catalogId'), 'Develop batch catalog ID')) : normalizeImageDevelopSettingsPacketV1OrV2(field(actionInput, 'settings')) });
	} else {
		record(actionInput, 'Develop batch relative', ['kind', 'effectType', 'changes']);
		action = Object.freeze({ kind, ...normalizeImageDevelopRelativeActionV1({ effectType: field(actionInput, 'effectType'), changes: field(actionInput, 'changes') }) });
	}
	const request = Object.freeze({ schemaVersion, catalogId: id(field(input, 'catalogId'), 'Develop batch catalog ID'),
		targets: Object.freeze(targets), action, label: name(field(input, 'label'), 'Develop batch history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'Develop batch history time') });
	checkImageDevelopSettingsBytesV1(request); return request as Request;
}

async function applyBatch(profile: Profile, host: { mutate: (run: (catalogId: string, signal: AbortSignal) => Promise<void>, signal?: AbortSignal) => Promise<unknown>;
	withPhoto: (catalogId: string, photoId: string, signal: AbortSignal, run: (owner: Owner, signal: AbortSignal) => Promise<void>) => Promise<void> },
	request: Request, selected: Selected | undefined, outerSignal?: AbortSignal): Promise<Receipt> {
	const outcomes: PhotoLibraryDevelopBatchOutcomeV2[] = request.targets.map((target, index) => ({
		index, photoId: target.photoId, versionId: target.versionId, status: 'not-attempted', revision: null, historyCursor: null, code: null,
	}));
	let started = false, activeSignal: AbortSignal | undefined;
	let completion: PhotoLibraryDevelopBatchReceiptV2['completion'] = 'finished';
	const notices: 'cleanup-failed'[] = [];
	try {
		await host.mutate(async (catalogId, signal) => {
			if (catalogId !== request.catalogId) throw new RangeError('Develop batch belongs to another catalog.');
			started = true; activeSignal = signal;
			for (let index = 0; index < request.targets.length; index++) {
				const target = request.targets[index]!, slot = outcomes[index]!;
				try {
					Reflect.apply(nativeAbort, signal, []);
					await host.withPhoto(catalogId, target.photoId, signal, async (owner, admitted) => {
						const before = owner.history.present;
						if (before.revision !== target.expectedRevision) {
							outcomes[index] = { ...slot, status: 'conflict', code: 'revision-conflict' }; return;
						}
						const version = before.versions.find(version => version.id === target.versionId);
						if (!version) { outcomes[index] = { ...slot, status: 'failed', code: 'version-missing' }; return; }
						const schemaVersion = profile === 'current3' ? 3 : 2;
						const develop = request.action.kind === 'paste'
							? selected ? selected.merge({ schemaVersion, target: version.develop, settings: request.action.settings })
								: mergeImageDevelopSettingsV2({ schemaVersion, target: version.develop, settings: request.action.settings })
							: (profile === 'current3' ? adjustImageDevelopSettingsV3 : adjustImageDevelopSettingsV2)({ schemaVersion, target: version.develop, effectType: request.action.effectType, changes: request.action.changes });
						if (JSON.stringify(develop) === JSON.stringify(version.develop)) {
							outcomes[index] = { ...slot, status: 'unchanged', revision: before.revision, historyCursor: version.workspace?.cursor ?? 0 }; return;
						}
						const saved = await Reflect.apply(owner.execute, owner, [{ type: 'record-develop', versionId: target.versionId, develop,
							label: request.label, createdAt: request.createdAt }, { signal: admitted }]) as PhotoCommandOwnerCurrentV1['history']['present'];
						// Capture the durable ACK before surrounding cleanup or cancellation can fail.
						outcomes[index] = { ...slot, status: 'applied', revision: saved.revision,
							historyCursor: saved.versions.find(version => version.id === target.versionId)!.workspace!.cursor };
					});
				} catch (error) {
					if (aborted(signal) || outcomes[index]!.status !== 'not-attempted') throw error;
					const conflict = revisionConflict(error);
					outcomes[index] = { ...slot, status: conflict ? 'conflict' : 'failed', code: conflict ? 'revision-conflict' : 'operation-failed' };
				}
				if (index + 1 < request.targets.length) await new Promise<void>(resolve => { setTimeout(resolve, 0); });
			}
		}, outerSignal);
	} catch (error) {
		if (!started) throw error;
		const pending = outcomes.some(outcome => outcome.status === 'not-attempted');
		const cancelled = aborted(activeSignal) && pending && Object.is(error, Reflect.apply(nativeReason, activeSignal, []));
		completion = cancelled ? 'cancelled' : 'interrupted';
		if (completion === 'interrupted') notices.push('cleanup-failed');
	}
	const receipt = Object.freeze({ schemaVersion: profile === 'current3' ? 3 as const : 2 as const, catalogId: request.catalogId, completion,
		outcomes: Object.freeze(outcomes.map(outcome => Object.freeze(outcome))), notices: Object.freeze(notices) });
	// 64 scalar outcomes fit comfortably; no settings/document/media inventory is returned.
	if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > 65_536) throw new RangeError('Develop batch receipt exceeded its scalar bound.');
	return receipt as Receipt;
}

function aborted(signal?: AbortSignal): boolean { return signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true; }
function revisionConflict(error: unknown): boolean {
	try {
		if (!error || typeof error !== 'object') return false;
		const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
		return descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.value === 'PHOTO_REVISION_CONFLICT';
	} catch { return false; }
}

function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeAbort, signal, []); }
function assertProfile(profile: unknown): asserts profile is Profile {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed settings Session profile.');
}
