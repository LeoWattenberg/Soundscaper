/* SPDX-License-Identifier: AGPL-3.0-only */

/** Diagnostic accounting only: these categories overlap and do not prove live allocation ownership. */
export type MotionMemoryByteDetail = Readonly<{ status: 'available'; bytes: number }
	| { status: 'unavailable'; reason: 'not-reported' | 'invalid' | 'duplicate' }>;
const unavailable = (reason: 'not-reported' | 'invalid' | 'duplicate'): MotionMemoryByteDetail => ({ status: 'unavailable', reason });
function optionalBytes(value: unknown): MotionMemoryByteDetail {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
		? { status: 'available', bytes: value } : unavailable('invalid');
}

/** Preserve optional fields from the existing response; absence never means zero. */
export function motionCdpMemoryDetails(heap: Readonly<Record<string, unknown>>) {
	const read = (name: string): MotionMemoryByteDetail => {
		const descriptor = Object.getOwnPropertyDescriptor(heap, name);
		if (!descriptor) return unavailable('not-reported');
		return 'value' in descriptor ? optionalBytes(descriptor.value) : unavailable('invalid');
	};
	return { backingStorageBytes: read('backingStorageSize'), embedderHeapBytes: read('embedderHeapUsedSize') };
}
export type MotionCdpMemoryDetails = ReturnType<typeof motionCdpMemoryDetails>;

/** Parse the same smaps_rollup text already read for RSS/PSS. Optional failures remain diagnostic
 * unavailability; they neither revoke a valid required observation nor add a new memory gate.
 */
export function motionProcessMemoryDetails(text: string) {
	const lines = text.split('\n').map(line => line.trimStart());
	const read = (name: string): MotionMemoryByteDetail => {
		const prefix = new RegExp(`^${name}(?:\\s|:|$)`, 'u');
		const reported = lines.filter(line => prefix.test(line));
		if (!reported.length) return unavailable('not-reported');
		if (reported.length !== 1) return unavailable('duplicate');
		const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'u').exec(reported[0]!);
		return match ? optionalBytes(Number(match[1]) * 1024) : unavailable('invalid');
	};
	return {
		privateCleanBytes: read('Private_Clean'), privateDirtyBytes: read('Private_Dirty'),
		sharedCleanBytes: read('Shared_Clean'), sharedDirtyBytes: read('Shared_Dirty'),
		anonymousBytes: read('Anonymous'), pssAnonymousBytes: read('Pss_Anon'),
		pssFileBytes: read('Pss_File'), pssSharedMemoryBytes: read('Pss_Shmem'),
	};
}
export type MotionProcessMemoryDetails = ReturnType<typeof motionProcessMemoryDetails>;
