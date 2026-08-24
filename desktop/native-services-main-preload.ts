/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFramescaperNativeQueueProjection,
	assertFramescaperNativeRootProjection,
	assertFramescaperNativeServicesSnapshot,
	assertFramescaperNativeWatchProjection,
	framescaperNativeQueueControlRequest,
	framescaperNativeQueueRemoveRequest,
	framescaperNativeQueueReorderRequest,
	framescaperNativePreferenceRequest,
	framescaperNativeServicePreferences,
	type FramescaperNativePreferenceRequest,
	type FramescaperNativeServicePreferences,
	type FramescaperNativeQueueControlRequest,
	type FramescaperNativeQueueProjection,
	type FramescaperNativeQueueRemoveRequest,
	type FramescaperNativeQueueReorderRequest,
	type FramescaperNativeServicesSnapshot,
} from './native-services-controller.ts';
import {
	framescaperNativeCheckpointLifecycleRequest,
	framescaperNativeExternalDisplayRequest,
	framescaperNativeLifecycleIdRequest,
	framescaperNativePublicationLifecycleRequest,
	framescaperNativeQueueEnqueueRequest,
	framescaperNativeWatchCreateRequest,
	framescaperNativeWatchEnabledRequest,
	type FramescaperNativeCheckpointLifecycleRequest,
	type FramescaperNativeExternalDisplayProjection,
	type FramescaperNativePublicationLifecycleRequest,
	type FramescaperNativeQueueEnqueueRequest,
	type FramescaperNativeWatchCreateRequest,
	type FramescaperNativeWatchEnabledRequest,
} from './native-services-lifecycle.ts';
import type {
	FramescaperNativePublicationResult,
	NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';
import {
	assertNativeMediaCapabilitySnapshotV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS } from './native-services-main-ipc.ts';
import type {
	FramescaperNativeImageSequenceSelectionV1,
} from './native-image-sequence-selection.ts';
import {
	framescaperNativeWatchImportClaim,
	framescaperNativeWatchImportClaimRequest,
	framescaperNativeWatchImportCompletionRequest,
	type FramescaperNativeWatchImportClaim,
	type FramescaperNativeWatchImportClaimRequest,
	type FramescaperNativeWatchImportCompletionRequest,
} from './native-services-watch-import-broker.ts';
import { nativeRenderInputStageIdRequest } from './native-services-render-input-contract.ts';
import {
	framescaperOpenFxPluginControlRequestV1,
	framescaperOpenFxPluginProjectionV1,
	type FramescaperOpenFxPluginControlRequestV1,
	type FramescaperOpenFxPluginProjectionV1,
} from '../src/common/editor/native-ofx-service-contract.ts';
import {
	framescaperOpenFxInteractRequestV1,
	framescaperOpenFxInteractResultV1,
	type FramescaperOpenFxInteractRequestV1,
	type FramescaperOpenFxInteractResultV1,
} from '../src/common/editor/native-ofx-interact-contract.ts';

export interface FramescaperNativeServicesMainPreloadBridge {
	readonly capabilities: () => Promise<NativeMediaCapabilitySnapshotV1>;
	readonly snapshot: () => Promise<FramescaperNativeServicesSnapshot>;
	readonly control: (
		request: FramescaperNativeQueueControlRequest,
	) => Promise<FramescaperNativeQueueProjection>;
	readonly reorder: (
		request: FramescaperNativeQueueReorderRequest,
	) => Promise<readonly FramescaperNativeQueueProjection[]>;
	readonly remove: (request: FramescaperNativeQueueRemoveRequest) => Promise<boolean>;
	readonly enqueue: (
		request: FramescaperNativeQueueEnqueueRequest,
	) => Promise<FramescaperNativeQueueProjection>;
	readonly abandonRenderInputs: (request: Readonly<{ stageId: string }>) => Promise<boolean>;
	readonly selectRoot: () => Promise<FramescaperNativeServicesSnapshot['roots'][number] | null>;
	readonly reauthorizeQueueRoot: (
		request: Readonly<{ jobId: string }>,
	) => Promise<FramescaperNativeQueueProjection | null>;
	readonly revalidateRoot: (request: Readonly<{ grantId: string }>) => Promise<boolean>;
	readonly revokeRoot: (request: Readonly<{ grantId: string }>) => Promise<boolean>;
	readonly createWatch: (
		request: FramescaperNativeWatchCreateRequest,
	) => Promise<FramescaperNativeServicesSnapshot['watchRules'][number]>;
	readonly setWatchEnabled: (
		request: FramescaperNativeWatchEnabledRequest,
	) => Promise<FramescaperNativeServicesSnapshot['watchRules'][number]>;
	readonly removeWatch: (request: Readonly<{ ruleId: string }>) => Promise<boolean>;
	readonly reconcileWatch: () => Promise<FramescaperNativeServicesSnapshot>;
	readonly claimWatchImport: (
		request: FramescaperNativeWatchImportClaimRequest,
	) => Promise<FramescaperNativeWatchImportClaim | null>;
	readonly completeWatchImport: (
		request: FramescaperNativeWatchImportCompletionRequest,
	) => Promise<boolean>;
	readonly cleanupScratch: () => Promise<readonly string[]>;
	readonly settleScratch: (request: Readonly<{ jobId: string }>) => Promise<'released' | 'retained'>;
	readonly publish: (
		request: FramescaperNativePublicationLifecycleRequest,
	) => Promise<FramescaperNativePublicationResult>;
	readonly checkpoint: (
		request: FramescaperNativeCheckpointLifecycleRequest,
	) => Promise<NativeImageSequenceCheckpointResultV1>;
	readonly externalDisplays: () => Promise<FramescaperNativeExternalDisplayProjection>;
	readonly setExternalDisplay: (
		request: Readonly<{ displayId: string | null }>,
	) => Promise<FramescaperNativeExternalDisplayProjection>;
	readonly presentExternalDisplay: (request: unknown) => Promise<FramescaperNativeExternalDisplayProjection>;
	readonly preferences: () => Promise<FramescaperNativeServicePreferences>;
	readonly setPreference: (request: FramescaperNativePreferenceRequest) => Promise<boolean>;
	readonly selectImageSequence: () => Promise<FramescaperNativeImageSequenceSelectionV1 | null>;
	readonly readImageSequenceFile: (request: Readonly<{
		readonly selectionId: string;
		readonly fileId: string;
		readonly offset: number;
		readonly length: number;
	}>) => Promise<Uint8Array>;
	readonly releaseImageSequence: (request: Readonly<{ readonly selectionId: string }>) => Promise<boolean>;
	readonly scanOpenFxPlugin: () => Promise<FramescaperOpenFxPluginProjectionV1 | null>;
	readonly listOpenFxPlugins: () => Promise<readonly FramescaperOpenFxPluginProjectionV1[]>;
	readonly controlOpenFxPlugin: (
		request: FramescaperOpenFxPluginControlRequestV1,
	) => Promise<FramescaperOpenFxPluginProjectionV1>;
	readonly runOpenFxInteract: (
		request: FramescaperOpenFxInteractRequestV1,
	) => Promise<FramescaperOpenFxInteractResultV1>;
}

/** Pathless API intended for `framescaperDesktop.v1.nativeServices`. */
export function createFramescaperNativeServicesMainPreloadBridge(
	value: unknown,
): FramescaperNativeServicesMainPreloadBridge {
	const hasFramePort = Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'presentFrame'));
	const options = closedRecord(
		value, hasFramePort ? ['invoke', 'presentFrame'] : ['invoke'],
		'Framescaper native-services preload options',
	);
	if (typeof options.invoke !== 'function') {
		throw new TypeError('Framescaper native-services preload requires an IPC invoke seam.');
	}
	const invoke = options.invoke as (channel: string, request?: unknown) => Promise<unknown>;
	const presentFrame = hasFramePort && typeof options.presentFrame === 'function'
		? options.presentFrame as (request: unknown) => Promise<unknown>
		: null;
	return Object.freeze({
		async capabilities(): Promise<NativeMediaCapabilitySnapshotV1> {
			const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.capabilities));
			assertNativeMediaCapabilitySnapshotV1(result);
			return result;
		},
		async snapshot(): Promise<FramescaperNativeServicesSnapshot> {
			const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.snapshot));
			assertFramescaperNativeServicesSnapshot(result);
			return result;
		},
		async control(requestValue: FramescaperNativeQueueControlRequest): Promise<FramescaperNativeQueueProjection> {
			const request = framescaperNativeQueueControlRequest(requestValue);
			const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.control, request));
			assertFramescaperNativeQueueProjection(result);
			return result;
		},
		async reorder(requestValue: FramescaperNativeQueueReorderRequest): Promise<readonly FramescaperNativeQueueProjection[]> {
			const request = framescaperNativeQueueReorderRequest(requestValue);
			const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.reorder, request));
			if (!Array.isArray(result) || result.length > 100_000) {
				throw new TypeError('Framescaper native-services reorder returned an invalid queue.');
			}
			result.forEach(assertFramescaperNativeQueueProjection);
			return Object.freeze(result);
		},
			async remove(requestValue: FramescaperNativeQueueRemoveRequest): Promise<boolean> {
			const request = framescaperNativeQueueRemoveRequest(requestValue);
			const result = await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.remove, request);
			if (typeof result !== 'boolean') {
				throw new TypeError('Framescaper native-services removal returned an invalid acknowledgement.');
			}
				return result;
			},
			async enqueue(requestValue: FramescaperNativeQueueEnqueueRequest): Promise<FramescaperNativeQueueProjection> {
				const request = framescaperNativeQueueEnqueueRequest(requestValue);
				const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.enqueue, request));
				assertFramescaperNativeQueueProjection(result);
				return result;
			},
			async abandonRenderInputs(requestValue: Readonly<{ stageId: string }>): Promise<boolean> {
				const request = nativeRenderInputStageIdRequest(requestValue, 'abandonment');
				return booleanResult(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.renderInputAbandon, request,
				), 'render-input abandonment');
			},
			async selectRoot() {
				const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.selectRoot));
				if (result === null) return null;
				assertFramescaperNativeRootProjection(result);
				return result as FramescaperNativeServicesSnapshot['roots'][number];
			},
			async reauthorizeQueueRoot(requestValue: Readonly<{ jobId: string }>) {
				const request = framescaperNativeLifecycleIdRequest(requestValue, 'jobId');
				const result = clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.reauthorizeQueueRoot, request,
				));
				if (result === null) return null;
				assertFramescaperNativeQueueProjection(result);
				return result;
			},
			async revalidateRoot(requestValue: Readonly<{ grantId: string }>): Promise<boolean> {
				const request = framescaperNativeLifecycleIdRequest(requestValue, 'grantId');
				return booleanResult(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.revalidateRoot, request,
				), 'root revalidation');
			},
			async revokeRoot(requestValue: Readonly<{ grantId: string }>): Promise<boolean> {
				const request = framescaperNativeLifecycleIdRequest(requestValue, 'grantId');
				return booleanResult(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.revokeRoot, request,
				), 'root revocation');
			},
			async createWatch(requestValue: FramescaperNativeWatchCreateRequest): Promise<FramescaperNativeServicesSnapshot['watchRules'][number]> {
				const request = framescaperNativeWatchCreateRequest(requestValue);
				const result = clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.createWatch, request,
				));
				assertFramescaperNativeWatchProjection(result);
				return result as FramescaperNativeServicesSnapshot['watchRules'][number];
			},
			async setWatchEnabled(requestValue: FramescaperNativeWatchEnabledRequest): Promise<FramescaperNativeServicesSnapshot['watchRules'][number]> {
				const request = framescaperNativeWatchEnabledRequest(requestValue);
				const result = clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.setWatchEnabled, request,
				));
				assertFramescaperNativeWatchProjection(result);
				return result as FramescaperNativeServicesSnapshot['watchRules'][number];
			},
			async removeWatch(requestValue: Readonly<{ ruleId: string }>): Promise<boolean> {
				const request = framescaperNativeLifecycleIdRequest(requestValue, 'ruleId');
				return booleanResult(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.removeWatch, request,
				), 'watch removal');
			},
			async reconcileWatch() {
				const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.reconcileWatch));
				assertFramescaperNativeServicesSnapshot(result);
				return result;
			},
			async claimWatchImport(requestValue: FramescaperNativeWatchImportClaimRequest) {
				const request = framescaperNativeWatchImportClaimRequest(requestValue);
				const result = clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.claimWatchImport, request,
				));
				return result === null ? null : framescaperNativeWatchImportClaim(result);
			},
			async completeWatchImport(requestValue: FramescaperNativeWatchImportCompletionRequest) {
				const request = framescaperNativeWatchImportCompletionRequest(requestValue);
				return booleanResult(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.completeWatchImport, request,
				), 'watch-import completion');
			},
			async cleanupScratch() {
				const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.cleanupScratch));
				if (!Array.isArray(result) || result.length > 100_000) {
					throw new TypeError('Framescaper scratch cleanup returned an invalid job list.');
				}
				result.forEach((jobId) => framescaperNativeLifecycleIdRequest({ jobId }, 'jobId'));
				return Object.freeze(result as string[]);
			},
			async settleScratch(requestValue: Readonly<{ jobId: string }>): Promise<'released' | 'retained'> {
				const request = framescaperNativeLifecycleIdRequest(requestValue, 'jobId');
				const result = await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.settleScratch, request);
				if (result !== 'released' && result !== 'retained') {
					throw new TypeError('Framescaper scratch settlement returned an invalid state.');
				}
				return result;
			},
			async publish(requestValue: FramescaperNativePublicationLifecycleRequest): Promise<FramescaperNativePublicationResult> {
				const request = framescaperNativePublicationLifecycleRequest(requestValue);
				return publicationResult(clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.publish, request,
				)));
			},
			async checkpoint(requestValue: FramescaperNativeCheckpointLifecycleRequest): Promise<NativeImageSequenceCheckpointResultV1> {
				const request = framescaperNativeCheckpointLifecycleRequest(requestValue);
				return checkpointResult(clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.checkpoint, request,
				)));
			},
			async externalDisplays() {
				return externalDisplayProjection(clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.externalDisplays,
				)));
			},
			async setExternalDisplay(requestValue: Readonly<{ displayId: string | null }>): Promise<FramescaperNativeExternalDisplayProjection> {
				const request = framescaperNativeExternalDisplayRequest(requestValue);
				return externalDisplayProjection(clone(await invoke(
					FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.setExternalDisplay, request,
				)));
			},
			async presentExternalDisplay(requestValue: unknown): Promise<FramescaperNativeExternalDisplayProjection> {
				if (presentFrame === null) {
					throw new Error('Framescaper external-display RGBA MessagePort transport is unavailable.');
				}
				return externalDisplayProjection(clone(await presentFrame(clone(requestValue))));
			},
		async preferences(): Promise<FramescaperNativeServicePreferences> {
			return framescaperNativeServicePreferences(clone(
				await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.preferences),
			));
		},
		async setPreference(requestValue: FramescaperNativePreferenceRequest): Promise<boolean> {
			const request = framescaperNativePreferenceRequest(requestValue);
			const result = await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.setPreference, request);
			if (typeof result !== 'boolean') {
				throw new TypeError('Framescaper native-service preference update returned an invalid result.');
			}
			return result;
		},
		async selectImageSequence(): Promise<FramescaperNativeImageSequenceSelectionV1 | null> {
			const result = clone(await invoke(
				FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.selectImageSequence, {},
			));
			return result === null ? null : imageSequenceSelection(result);
		},
		async readImageSequenceFile(requestValue: Readonly<{
			selectionId: string; fileId: string; offset: number; length: number;
		}>) {
			const request = imageSequenceReadRequest(requestValue);
			const bytes = binary(await invoke(
				FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.readImageSequenceFile, request,
			));
			if (bytes.byteLength !== request.length) {
				throw new Error('Framescaper image-sequence range read was short.');
			}
			return bytes;
		},
		async releaseImageSequence(requestValue: Readonly<{ selectionId: string }>) {
			const request = imageSequenceReleaseRequest(requestValue);
			return booleanResult(await invoke(
				FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.releaseImageSequence, request,
			), 'image-sequence release');
		},
		async scanOpenFxPlugin(): Promise<FramescaperOpenFxPluginProjectionV1 | null> {
			const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.openFxScan));
			return result === null ? null : framescaperOpenFxPluginProjectionV1(result);
		},
		async listOpenFxPlugins(): Promise<readonly FramescaperOpenFxPluginProjectionV1[]> {
			const result = clone(await invoke(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.openFxInventory));
			if (!Array.isArray(result) || result.length > 1_024) {
				throw new TypeError('Framescaper returned an invalid OpenFX plug-in inventory.');
			}
			return Object.freeze(result.map(framescaperOpenFxPluginProjectionV1));
		},
		async controlOpenFxPlugin(requestValue: FramescaperOpenFxPluginControlRequestV1) {
			const request = framescaperOpenFxPluginControlRequestV1(requestValue);
			return framescaperOpenFxPluginProjectionV1(clone(await invoke(
				FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.openFxControl, request,
			)));
		},
		async runOpenFxInteract(requestValue: FramescaperOpenFxInteractRequestV1) {
			const request = framescaperOpenFxInteractRequestV1(requestValue);
			return framescaperOpenFxInteractResultV1(clone(await invoke(
				FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.openFxInteract, request,
			)), request);
		},
	});
}

function clone(value: unknown): unknown {
	return structuredClone(value);
}

function booleanResult(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`Framescaper ${label} returned an invalid result.`);
	return value;
}

function imageSequenceSelection(value: unknown): FramescaperNativeImageSequenceSelectionV1 {
	const result = closedRecord(value, ['selectionId', 'files'], 'image-sequence selection');
	const selectionId = imageSequenceOpaqueId(result.selectionId, 'selection ID');
	if (!Array.isArray(result.files) || result.files.length === 0 || result.files.length > 1_000_000
		|| Reflect.ownKeys(result.files).length !== result.files.length + 1) {
		throw new TypeError('Framescaper returned an invalid image-sequence file inventory.');
	}
	const fileIds = new Set<string>();
	const files = result.files.map((value, index) => {
		const file = closedRecord(value, ['fileId', 'name', 'byteLength'], `image-sequence file ${String(index)}`);
		const fileId = imageSequenceOpaqueId(file.fileId, 'file ID');
		if (fileIds.has(fileId) || typeof file.name !== 'string' || file.name.length < 1
			|| file.name.length > 512 || file.name.includes('/') || file.name.includes('\\')
			|| file.name.includes('\0') || !Number.isSafeInteger(file.byteLength)
			|| Number(file.byteLength) < 1 || Number(file.byteLength) > 512 * 1024 * 1024) {
			throw new TypeError('Framescaper returned an invalid pathless image-sequence file.');
		}
		fileIds.add(fileId);
		return Object.freeze({ fileId, name: file.name, byteLength: Number(file.byteLength) });
	});
	return Object.freeze({ selectionId, files: Object.freeze(files) });
}

function imageSequenceReadRequest(value: unknown) {
	const request = closedRecord(
		value, ['selectionId', 'fileId', 'offset', 'length'], 'image-sequence read request',
	);
	if (!Number.isSafeInteger(request.offset) || Number(request.offset) < 0
		|| !Number.isSafeInteger(request.length) || Number(request.length) < 1
		|| Number(request.length) > 16 * 1024 * 1024) {
		throw new RangeError('Framescaper image-sequence range is invalid.');
	}
	return Object.freeze({
		selectionId: imageSequenceOpaqueId(request.selectionId, 'selection ID'),
		fileId: imageSequenceOpaqueId(request.fileId, 'file ID'),
		offset: Number(request.offset), length: Number(request.length),
	});
}

function imageSequenceReleaseRequest(value: unknown) {
	const request = closedRecord(value, ['selectionId'], 'image-sequence release request');
	return Object.freeze({ selectionId: imageSequenceOpaqueId(request.selectionId, 'selection ID') });
}

function imageSequenceOpaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError(`Framescaper image-sequence ${label} is invalid.`);
	}
	return value;
}

function binary(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	}
	throw new TypeError('Framescaper image-sequence range result is not bytes.');
}

function publicationResult(value: unknown): FramescaperNativePublicationResult {
	const result = closedRecord(
		value, ['outcome', 'relativeDestination', 'byteLength', 'sha256'], 'publication result',
	);
	if (result.outcome !== 'published' && result.outcome !== 'already-published') {
		throw new TypeError('Framescaper publication returned an invalid outcome.');
	}
	if (typeof result.relativeDestination !== 'string' || result.relativeDestination.length === 0
		|| !Number.isSafeInteger(result.byteLength) || Number(result.byteLength) < 0
		|| typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(result.sha256)) {
		throw new TypeError('Framescaper publication returned invalid output identity.');
	}
	return Object.freeze(result as unknown as FramescaperNativePublicationResult);
}

function checkpointResult(value: unknown): NativeImageSequenceCheckpointResultV1 {
	const result = closedRecord(
		value, ['verifiedFrameCount', 'plannedFrameCount', 'complete'], 'checkpoint result',
	);
	if (!Number.isSafeInteger(result.verifiedFrameCount) || Number(result.verifiedFrameCount) < 0
		|| !Number.isSafeInteger(result.plannedFrameCount) || Number(result.plannedFrameCount) < 0
		|| Number(result.verifiedFrameCount) > Number(result.plannedFrameCount)
		|| typeof result.complete !== 'boolean') {
		throw new TypeError('Framescaper checkpoint returned invalid progress.');
	}
	return Object.freeze(result as unknown as NativeImageSequenceCheckpointResultV1);
}

function externalDisplayProjection(value: unknown): FramescaperNativeExternalDisplayProjection {
	const result = closedRecord(value, ['displays', 'activeDisplayId'], 'external display projection');
	if (!Array.isArray(result.displays) || result.displays.length > 64) {
		throw new TypeError('Framescaper returned an invalid external display inventory.');
	}
	const displays = result.displays.map((display) => {
		const row = closedRecord(display, [
			'displayId', 'label', 'primary', 'width', 'height', 'hdrCapable', 'colorManaged',
		], 'external display');
		if (typeof row.displayId !== 'string' || row.displayId.length === 0 || row.displayId.length > 128
			|| typeof row.label !== 'string' || row.label.length === 0 || row.label.length > 256
			|| !Number.isSafeInteger(row.width) || Number(row.width) < 1
			|| !Number.isSafeInteger(row.height) || Number(row.height) < 1
			|| typeof row.primary !== 'boolean' || typeof row.hdrCapable !== 'boolean'
			|| typeof row.colorManaged !== 'boolean') {
			throw new TypeError('Framescaper returned an invalid external display.');
		}
		return Object.freeze(row as unknown as FramescaperNativeExternalDisplayProjection['displays'][number]);
	});
	if (result.activeDisplayId !== null
		&& (typeof result.activeDisplayId !== 'string'
			|| !displays.some((display) => display.displayId === result.activeDisplayId))) {
		throw new TypeError('Framescaper returned an invalid active external display.');
	}
	return Object.freeze({
		displays: Object.freeze(displays),
		activeDisplayId: result.activeDisplayId as string | null,
	});
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}
