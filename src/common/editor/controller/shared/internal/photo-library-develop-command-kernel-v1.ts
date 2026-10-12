/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../closed-domain-value.ts';
import type { PhotoLibraryDevelopCommandV2, PhotoLibraryDevelopSettingsV2, PhotoLibraryDevelopPortV2 } from '../../../photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopCommandV3, PhotoLibraryDevelopSettingsV3, PhotoLibraryDevelopPortV3 } from '../../../photo-library-develop-port-v3.ts';
import { capturePhotoLibraryDevelopMaskRasterPortV1 } from '../../../photo-library-develop-mask-raster-port-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../../photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopPresetsPortV3 } from '../../../photo-library-develop-presets-port-v3.ts';
import type { PhotoLibraryDevelopSettingsPortV3 } from '../../../photo-library-develop-settings-port-v3.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../../imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../imaging/image-develop-state-current-v1.ts';
import type { PhotoDevelopExecutionContextForProfileV1 } from './photo-library-develop-workflow-kernel-v1.ts';

export type PhotoDevelopProfileV1 = 'legacy2' | 'current3';
export type PhotoDevelopCommandForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopCommandV2 : PhotoLibraryDevelopCommandV3;
export type PhotoDevelopSettingsForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopSettingsV2 : PhotoLibraryDevelopSettingsV3;
export type PhotoDevelopPortForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopPortV2 : PhotoLibraryDevelopPortV3;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Fixed owners share detachment; callers cannot inject a normalizer or schema policy. */
export function detachPhotoDevelopCommandForProfileV1<Profile extends PhotoDevelopProfileV1>(profile: Profile, value: unknown): PhotoDevelopCommandForProfileV1<Profile> {
	admitProfile(profile);
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
	const command = detached(record(value, 'develop command', fields[type as keyof typeof fields]), 2_097_152 + 8192) as PhotoDevelopCommandForProfileV1<Profile>;
	return (command.type === 'record-develop' ? Object.freeze({ ...command,
		develop: detachPhotoDevelopSettingsForProfileV1(profile, command.develop) }) : command) as PhotoDevelopCommandForProfileV1<Profile>;
}
export function detachPhotoDevelopSettingsForProfileV1<Profile extends PhotoDevelopProfileV1>(profile: Profile, value: unknown): PhotoDevelopSettingsForProfileV1<Profile> {
	admitProfile(profile); const input = detached(value);
	return (profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(input) : normalizeImageDevelopStateCurrentV1(input)) as PhotoDevelopSettingsForProfileV1<Profile>;
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

/** The Current policy captures genuine Original custody; the legacy scalar view remains exact. */
export function capturePhotoDevelopPortForProfileV1<Profile extends PhotoDevelopProfileV1>(profile: Profile,
	port: PhotoDevelopPortForProfileV1<Profile>): Readonly<PhotoDevelopPortForProfileV1<Profile>> {
	admitProfile(profile); const schemaVersion = profile === 'legacy2' ? 2 : 3;
	if (field(port as unknown as Record<string, unknown>, 'schemaVersion', 'current Develop capability') !== schemaVersion) {
		throw new RangeError(`Current Develop requires a schema${schemaVersion} capability.`);
	}
	if (profile === 'legacy2') {
		const legacy = port as PhotoLibraryDevelopPortV2;
		const read = legacy.read, apply = legacy.apply, settings = legacy.settings, presets = legacy.presets, maskRasters = legacy.maskRasters;
		return Object.freeze({ schemaVersion: 2, read: pin(read, port), apply: pin(apply, port),
			...(maskRasters === undefined ? {} : { maskRasters: capturePhotoLibraryDevelopMaskRasterPortV1(maskRasters) }),
			...(settings === undefined ? {} : { settings: Object.freeze({ copy: pin(settings.copy, settings), merge: pin(settings.merge, settings),
				adjust: pin(settings.adjust, settings), applyBatch: pin(settings.applyBatch, settings) }) }),
			...(presets === undefined ? {} : { presets: Object.freeze({ create: pin(presets.create, presets), parse: pin(presets.parse, presets),
				serialize: pin(presets.serialize, presets), list: pin(presets.list, presets), read: pin(presets.read, presets), write: pin(presets.write, presets) }) }),
		}) as Readonly<PhotoDevelopPortForProfileV1<Profile>>;
	}
	const current = record(port, 'current Develop capability', ['schemaVersion', 'read', 'apply', 'original', 'maskRasters', 'settingsCurrent', 'presetsCurrent'], ['schemaVersion', 'read', 'apply']);
	const read = field(current, 'read', 'current Develop capability') as PhotoLibraryDevelopPortV3['read'];
	const apply = field(current, 'apply', 'current Develop capability') as PhotoLibraryDevelopPortV3['apply'];
	const original = Object.hasOwn(current, 'original') ? captureOriginal(field(current, 'original', 'current Develop capability')) : undefined;
	const maskRasters = Object.hasOwn(current, 'maskRasters') ? field(current, 'maskRasters', 'current Develop capability') : undefined;
	const settingsCurrent = Object.hasOwn(current, 'settingsCurrent') ? captureSettingsCurrent(field(current, 'settingsCurrent', 'current Develop capability')) : undefined;
	const presetsCurrent = Object.hasOwn(current, 'presetsCurrent') ? capturePresetsCurrent(field(current, 'presetsCurrent', 'current Develop capability')) : undefined;
	return Object.freeze({ schemaVersion: 3, read: pin(read, port), apply: pin(apply, port),
		...(original === undefined ? {} : { original }),
		...(maskRasters === undefined ? {} : { maskRasters: capturePhotoLibraryDevelopMaskRasterPortV1(maskRasters) }),
		...(settingsCurrent === undefined ? {} : { settingsCurrent }),
		...(presetsCurrent === undefined ? {} : { presetsCurrent }),
	}) as Readonly<PhotoDevelopPortForProfileV1<Profile>>;
}
function capturePresetsCurrent(value: unknown): Readonly<PhotoLibraryDevelopPresetsPortV3> | undefined {
	if (value === undefined) return undefined;
	const input = record(value, 'Current presets capability', ['create', 'parse', 'serialize', 'list', 'read', 'write']);
	return Object.freeze({ create: pin(field(input, 'create', 'Current presets capability') as PhotoLibraryDevelopPresetsPortV3['create'], value),
		parse: pin(field(input, 'parse', 'Current presets capability') as PhotoLibraryDevelopPresetsPortV3['parse'], value),
		serialize: pin(field(input, 'serialize', 'Current presets capability') as PhotoLibraryDevelopPresetsPortV3['serialize'], value),
		list: pin(field(input, 'list', 'Current presets capability') as PhotoLibraryDevelopPresetsPortV3['list'], value),
		read: pin(field(input, 'read', 'Current presets capability') as PhotoLibraryDevelopPresetsPortV3['read'], value),
		write: pin(field(input, 'write', 'Current presets capability') as PhotoLibraryDevelopPresetsPortV3['write'], value) });
}
function captureSettingsCurrent(value: unknown): Readonly<PhotoLibraryDevelopSettingsPortV3> | undefined {
	if (value === undefined) return undefined;
	const input = record(value, 'Current settings capability', ['copy', 'copySelected', 'merge', 'adjust', 'applyBatch']);
	return Object.freeze({ copy: pin(field(input, 'copy', 'Current settings capability') as PhotoLibraryDevelopSettingsPortV3['copy'], value),
		copySelected: pin(field(input, 'copySelected', 'Current settings capability') as PhotoLibraryDevelopSettingsPortV3['copySelected'], value),
		merge: pin(field(input, 'merge', 'Current settings capability') as PhotoLibraryDevelopSettingsPortV3['merge'], value),
		adjust: pin(field(input, 'adjust', 'Current settings capability') as PhotoLibraryDevelopSettingsPortV3['adjust'], value),
		applyBatch: pin(field(input, 'applyBatch', 'Current settings capability') as PhotoLibraryDevelopSettingsPortV3['applyBatch'], value) });
}
function captureOriginal(value: unknown): Readonly<PhotoLibraryDevelopOriginalPortV1> | undefined {
	if (value === undefined) return undefined;
	const input = record(value, 'Develop Original capability', ['withFrame']);
	return Object.freeze({ withFrame: pin(field(input, 'withFrame', 'Develop Original capability') as PhotoLibraryDevelopOriginalPortV1['withFrame'], value) });
}
function pin<Method extends (...args: never[]) => unknown>(method: Method, receiver: unknown): Method {
	if (typeof method !== 'function') throw new TypeError('Current Develop requires callable capabilities.');
	return ((...args: unknown[]) => Reflect.apply(method, receiver, args)) as unknown as Method;
}
export function capturePhotoDevelopContextForProfileV1<Profile extends PhotoDevelopProfileV1>(profile: Profile,
	context: PhotoDevelopExecutionContextForProfileV1<Profile>, signal: AbortSignal): Readonly<PhotoDevelopExecutionContextForProfileV1<Profile>> {
	admitProfile(profile); Reflect.apply(CHECK, signal, []);
	try {
		const acquire = context.acquire, isCurrent = context.isCurrent, refresh = context.refresh;
		const captured = Object.freeze({ signal, acquire: pin(acquire, context), isCurrent: pin(isCurrent, context), refresh: pin(refresh, context) });
		Reflect.apply(CHECK, signal, []); return captured;
	} catch (error) { Reflect.apply(CHECK, signal, []); throw error; }
}
function admitProfile(value: PhotoDevelopProfileV1): void {
	if (value !== 'legacy2' && value !== 'current3') throw new TypeError('Unsupported Develop authoring profile.');
}
