/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitAudioEditorProjectValidationStructure,
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from './project-validation-budget.ts';
import { MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES } from './project-publication-admission.ts';

type VideoExportSnapshotRole = 'keyframe' | 'offline';

const LABELS: Readonly<Record<VideoExportSnapshotRole, string>> = Object.freeze({
	keyframe: 'Video keyframe export',
	offline: 'Offline video export',
});

/** The two exporters share snapshot admission, traversal, cloning, and freezing. */
export function cloneFrozenVideoExportProject<Value extends object>(
	project: Value,
	role: VideoExportSnapshotRole,
	validateClone?: (snapshot: unknown) => void,
): Value {
	admitAudioEditorProjectValidationStructure(project, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	assertSnapshotPayloadBound(project, role);
	let snapshot: unknown;
	try {
		snapshot = structuredClone(project);
	} catch (cause) {
		throw new TypeError(`${LABELS[role]} project must be structured-clone data.`, { cause });
	}
	validateClone?.(snapshot);
	return freezeProjectSnapshot(snapshot, role) as Value;
}

function assertSnapshotPayloadBound(value: object, role: VideoExportSnapshotRole): void {
	const stack: unknown[] = [value];
	const seen = new WeakSet<object>();
	let textCodeUnits = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current === 'string') {
			textCodeUnits += current.length;
			if (textCodeUnits > MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES) {
				throw new RangeError(`${LABELS[role]} project text exceeds its snapshot byte bound.`);
			}
			continue;
		}
		if (!current || typeof current !== 'object' || seen.has(current)) continue;
		if (isBinary(current, role)) {
			throw new TypeError(`${LABELS[role]} projects cannot embed binary data.`);
		}
		seen.add(current);
		for (const key of Reflect.ownKeys(current)) {
			stack.push(Object.getOwnPropertyDescriptor(current, key)?.value);
		}
	}
}

function isBinary(value: object, role: VideoExportSnapshotRole): boolean {
	if (role === 'keyframe') return value instanceof Uint8Array || value instanceof ArrayBuffer;
	return value instanceof ArrayBuffer
		|| ArrayBuffer.isView(value)
		|| (typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer);
}

function freezeProjectSnapshot(value: unknown, role: VideoExportSnapshotRole): unknown {
	if (!value || typeof value !== 'object') return value;
	if (isBinary(value, role)) {
		throw new TypeError(`${LABELS[role]} projects cannot embed binary data.`);
	}
	const stack: object[] = [value];
	const seen = new WeakSet<object>();
	const order: object[] = [];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		if (role === 'offline' && isBinary(current, role)) {
			throw new TypeError(`${LABELS[role]} projects cannot embed binary data.`);
		}
		order.push(current);
		for (const key of Reflect.ownKeys(current)) {
			const nested = Object.getOwnPropertyDescriptor(current, key)?.value;
			if (nested && typeof nested === 'object') stack.push(nested as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}
