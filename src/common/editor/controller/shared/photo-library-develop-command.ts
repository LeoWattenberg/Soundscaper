/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryDevelopCommandV1, PhotoLibraryDevelopSettingsV1 } from '../../photo-library-develop-port-v1.ts';

/** Transport detachment only. The shared effect registry and product Session own semantics. */
export function detachPhotoLibraryDevelopCommandV1(value: unknown): PhotoLibraryDevelopCommandV1 {
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
	return detached(record(value, 'develop command', fields[type as keyof typeof fields]), 2_097_152 + 8192) as PhotoLibraryDevelopCommandV1;
}

export function detachPhotoLibraryDevelopSettingsV1(value: unknown): PhotoLibraryDevelopSettingsV1 {
	return detached(record(value, 'develop settings', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings'])) as PhotoLibraryDevelopSettingsV1;
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
