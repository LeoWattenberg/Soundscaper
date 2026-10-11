/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryDevelopCommandV2, PhotoLibraryDevelopSettingsV2, PhotoLibraryDevelopPortV2 } from '../../photo-library-develop-port-v2.ts';
import { capturePhotoLibraryDevelopMaskRasterPortV1 } from '../../photo-library-develop-mask-raster-port-v1.ts';

import type { PhotoDevelopExecutionContextV2 } from './photo-library-develop-workflow-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../imaging/image-develop-state-v2.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Closed current transport admits actual process1/2 recipes; references never prove resource bodies. */
export function detachPhotoLibraryDevelopCommandV2(value: unknown): PhotoLibraryDevelopCommandV2 {
	const input = record(value, 'develop command', ['type', 'versionId', 'develop', 'label', 'createdAt', 'cursor', 'id', 'name', 'snapshotId', 'sourceVersionId'], ['type']);
	const type = field(input, 'type', 'develop command');
	const fields = {
		'record-develop': ['type', 'versionId', 'develop', 'label', 'createdAt'],
		'select-develop-history': ['type', 'versionId', 'cursor'],
		'save-develop-snapshot': ['type', 'versionId', 'id', 'name', 'createdAt'],
		'delete-develop-snapshot': ['type', 'versionId', 'snapshotId'],
		'restore-develop-snapshot': ['type', 'versionId', 'snapshotId', 'label', 'createdAt'],
		'create-virtual-copy': ['type', 'id', 'name', 'createdAt', 'sourceVersionId'],
		'activate-version': ['type', 'versionId'], 'delete-virtual-copy': ['type', 'versionId'],
		'rename-virtual-copy': ['type', 'versionId', 'name'],
	} as const;
	if (typeof type !== 'string' || !Object.hasOwn(fields, type)) throw new TypeError('Unsupported develop command.');
	const command = detached(record(value, 'develop command', fields[type as keyof typeof fields]), 2_097_152 + 8192) as PhotoLibraryDevelopCommandV2;
	return command.type === 'record-develop' ? Object.freeze({ ...command, develop: detachPhotoLibraryDevelopSettingsV2(command.develop) }) : command;
}

export function detachPhotoLibraryDevelopSettingsV2(value: unknown): PhotoLibraryDevelopSettingsV2 {
	return normalizeImageDevelopStateV1OrV2(detached(value));
}

function detached(value: unknown, maximumBytes = 2_097_152): unknown {
	let bytes = 0;
	const encoder = new TextEncoder();
	const charge = (length: number) => { bytes += length; if (bytes > maximumBytes) throw new RangeError('Develop intent exceeds its byte budget.'); };
	const scalar = (candidate: null | boolean | number | string) => { charge(encoder.encode(JSON.stringify(candidate)).byteLength); return candidate; };
	const copy = (candidate: unknown, depth: number): unknown => {
		if (depth > 32) throw new RangeError('Develop intent exceeds its scalar depth budget.');
		if (candidate === null || typeof candidate === 'boolean') return scalar(candidate);
		if (typeof candidate === 'number' && Number.isFinite(candidate)) return scalar(candidate);
		if (typeof candidate === 'string' && candidate.length <= maximumBytes) return scalar(candidate);
		if (Array.isArray(candidate)) {
			const input = array(candidate, 'develop array', 0, 65_536); charge(2 + Math.max(0, input.length - 1));
			return Object.freeze(input.map(item => copy(item, depth + 1)));
		}
		if (!candidate || typeof candidate !== 'object') throw new TypeError('Develop intent requires inert scalar data.');
		const keys = Reflect.ownKeys(candidate);
		if (keys.some(key => typeof key !== 'string')) throw new TypeError('Develop intent contains a symbol.');
		charge(2 + Math.max(0, keys.length - 1));
		const input = record(candidate, 'develop data', keys as string[]), output: Record<string, unknown> = {};
		for (const key of keys as string[]) {
			scalar(key); charge(1);
			Object.defineProperty(output, key, { value: copy(field(input, key, 'develop data'), depth + 1), enumerable: true });
		}
		return Object.freeze(output);
	};
	return copy(value, 0);
}

/** Borrow only current scalar authoring methods under the caller's existing Session scope. */
export function capturePhotoLibraryDevelopPortV2(port: PhotoLibraryDevelopPortV2): Readonly<PhotoLibraryDevelopPortV2> {
	if (field(port as unknown as Record<string, unknown>, 'schemaVersion', 'current Develop capability') !== 2) throw new RangeError('Current Develop requires a schema2 capability.');
	const read = port.read, apply = port.apply, settings = port.settings, presets = port.presets, maskRasters = port.maskRasters;
	return Object.freeze({ schemaVersion: 2, read: pin(read, port), apply: pin(apply, port),
		...(maskRasters === undefined ? {} : { maskRasters: capturePhotoLibraryDevelopMaskRasterPortV1(maskRasters) }),
		...(settings === undefined ? {} : { settings: Object.freeze({ copy: pin(settings.copy, settings), merge: pin(settings.merge, settings),
			adjust: pin(settings.adjust, settings), applyBatch: pin(settings.applyBatch, settings) }) }),
		...(presets === undefined ? {} : { presets: Object.freeze({ create: pin(presets.create, presets), parse: pin(presets.parse, presets),
			serialize: pin(presets.serialize, presets), list: pin(presets.list, presets), read: pin(presets.read, presets), write: pin(presets.write, presets) }) }),
	});
}
function pin<Method extends (...args: never[]) => unknown>(method: Method, receiver: unknown): Method {
	if (typeof method !== 'function') throw new TypeError('Current Develop requires callable capabilities.');
	return ((...args: unknown[]) => Reflect.apply(method, receiver, args)) as unknown as Method;
}

/** Snapshot a borrowed scope's methods and receiver before any asynchronous action. */
export function capturePhotoDevelopExecutionContextV2(context: PhotoDevelopExecutionContextV2, signal: AbortSignal): Readonly<PhotoDevelopExecutionContextV2> {
	Reflect.apply(CHECK, signal, []);
	try {
		const acquire = context.acquire, isCurrent = context.isCurrent, refresh = context.refresh;
		const captured = Object.freeze({ signal, acquire: pin(acquire, context), isCurrent: pin(isCurrent, context), refresh: pin(refresh, context) });
		Reflect.apply(CHECK, signal, []); return captured;
	} catch (error) { Reflect.apply(CHECK, signal, []); throw error; }
}
