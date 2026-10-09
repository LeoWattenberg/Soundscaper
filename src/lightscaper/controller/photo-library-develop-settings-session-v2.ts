/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopBatchRequestV2, PhotoLibraryDevelopBatchReceiptV2, PhotoLibraryDevelopBatchOutcomeV2,
	PhotoLibraryDevelopSettingsPortV2 } from '../../common/editor/photo-library-develop-settings-port-v2.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { array, field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';
import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import { adjustImageDevelopSettingsV2, copyImageDevelopSettingsV2, mergeImageDevelopSettingsV2, normalizeImageDevelopSettingsPacketV1OrV2 } from '../../common/editor/imaging/image-develop-settings-v2.ts';
import { normalizeImageDevelopRelativeActionV1, checkImageDevelopSettingsBytesV1 } from '../../common/editor/imaging/image-develop-settings-v1.ts';

export interface PhotoLibraryDevelopSettingsSessionHostV2 {
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly withPhoto: <Result>(catalogId: string, photoId: string, signal: AbortSignal,
		run: (owner: PhotoCommandOwnerV2, signal: AbortSignal) => Promise<Result>) => Promise<Result>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

export function createPhotoLibraryDevelopSettingsSessionV2(host: PhotoLibraryDevelopSettingsSessionHostV2): Readonly<PhotoLibraryDevelopSettingsPortV2> {
	const mutate = host.mutate, withPhoto = host.withPhoto;
	if (typeof mutate !== 'function' || typeof withPhoto !== 'function') throw new TypeError('Develop batches require the Session writer and photo owner.');
	const pinned: PhotoLibraryDevelopSettingsSessionHostV2 = {
		mutate: (run, signal) => Reflect.apply(mutate, host, [run, signal]),
		withPhoto: (...args) => Reflect.apply(withPhoto, host, args),
	};
	return Object.freeze({ copy: copyImageDevelopSettingsV2, merge: mergeImageDevelopSettingsV2, adjust: adjustImageDevelopSettingsV2,
		async applyBatch(value, options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const request = normalizePhotoLibraryDevelopBatchV2(value);
			if (signal) Reflect.apply(nativeAbort, signal, []);
			return applyBatch(pinned, request, signal);
		} } satisfies PhotoLibraryDevelopSettingsPortV2);
}

/** Snap every target and the single shared action before any initialization, lease or await. */
export function normalizePhotoLibraryDevelopBatchV2(value: unknown): PhotoLibraryDevelopBatchRequestV2 {
	const input = record(value, 'Develop batch', ['schemaVersion', 'catalogId', 'targets', 'action', 'label', 'createdAt']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported Develop batch version.');
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
	let action: PhotoLibraryDevelopBatchRequestV2['action'];
	if (kind === 'paste') {
		record(actionInput, 'Develop batch paste', ['kind', 'settings']);
		action = Object.freeze({ kind, settings: normalizeImageDevelopSettingsPacketV1OrV2(field(actionInput, 'settings')) });
	} else {
		record(actionInput, 'Develop batch relative', ['kind', 'effectType', 'changes']);
		action = Object.freeze({ kind, ...normalizeImageDevelopRelativeActionV1({ effectType: field(actionInput, 'effectType'), changes: field(actionInput, 'changes') }) });
	}
	const request: PhotoLibraryDevelopBatchRequestV2 = Object.freeze({ schemaVersion: 2, catalogId: id(field(input, 'catalogId'), 'Develop batch catalog ID'),
		targets: Object.freeze(targets), action, label: name(field(input, 'label'), 'Develop batch history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'Develop batch history time') });
	checkImageDevelopSettingsBytesV1(request); return request;
}

async function applyBatch(host: PhotoLibraryDevelopSettingsSessionHostV2, request: PhotoLibraryDevelopBatchRequestV2,
	outerSignal?: AbortSignal): Promise<PhotoLibraryDevelopBatchReceiptV2> {
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
						const develop = request.action.kind === 'paste'
							? mergeImageDevelopSettingsV2({ schemaVersion: 2, target: version.develop, settings: request.action.settings })
							: adjustImageDevelopSettingsV2({ schemaVersion: 2, target: version.develop, effectType: request.action.effectType, changes: request.action.changes });
						if (JSON.stringify(develop) === JSON.stringify(version.develop)) {
							outcomes[index] = { ...slot, status: 'unchanged', revision: before.revision, historyCursor: version.workspace?.cursor ?? 0 }; return;
						}
						const saved = await owner.execute({ type: 'record-develop', versionId: target.versionId, develop,
							label: request.label, createdAt: request.createdAt }, { signal: admitted });
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
	const receipt: PhotoLibraryDevelopBatchReceiptV2 = Object.freeze({ schemaVersion: 2, catalogId: request.catalogId, completion,
		outcomes: Object.freeze(outcomes.map(outcome => Object.freeze(outcome))), notices: Object.freeze(notices) });
	// 64 scalar outcomes fit comfortably; no settings/document/media inventory is returned.
	if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > 65_536) throw new RangeError('Develop batch receipt exceeded its scalar bound.');
	return receipt;
}

function aborted(signal?: AbortSignal): boolean { return signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true; }
function revisionConflict(error: unknown): boolean {
	try {
		if (!error || typeof error !== 'object') return false;
		const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
		return descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.value === 'PHOTO_REVISION_CONFLICT';
	} catch { return false; }
}
