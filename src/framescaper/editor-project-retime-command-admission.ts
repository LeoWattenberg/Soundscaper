/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_RETIME_COMMAND_MAXIMUM_TRAVERSAL_NODES = 400_000;
export const FRAMESCAPER_RETIME_COMMAND_MAXIMUM_TRAVERSAL_DEPTH = 160;

interface VisitWork { readonly kind: 'visit'; readonly value: unknown; readonly depth: number }
interface LeaveWork { readonly kind: 'leave'; readonly value: object }
type Work = VisitWork | LeaveWork;

/** Bound the complete inert command graph before independently snapshotting its wires. */
export function admitFramescaperProjectCommandRetimeStructure(value: unknown): void {
	const active = new Set<object>();
	const stack: Work[] = [{ kind: 'visit', value, depth: 0 }];
	let nodes = 0;
	while (stack.length > 0) {
		const work = stack.pop();
		if (!work) continue;
		if (work.kind === 'leave') {
			active.delete(work.value);
			continue;
		}
		nodes += 1;
		if (nodes > FRAMESCAPER_RETIME_COMMAND_MAXIMUM_TRAVERSAL_NODES) {
			throw new RangeError('Framescaper retime command exceeds its aggregate structural node limit.');
		}
		if (work.depth > FRAMESCAPER_RETIME_COMMAND_MAXIMUM_TRAVERSAL_DEPTH) {
			throw new RangeError('Framescaper retime command exceeds its aggregate structural nesting depth limit.');
		}
		const candidate = work.value;
		if (candidate === null || typeof candidate !== 'object') {
			if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean'
				|| (typeof candidate === 'number' && Number.isFinite(candidate))) continue;
			throw new TypeError('Framescaper retime commands must contain JSON-compatible values.');
		}
		if (candidate instanceof Uint8Array || candidate instanceof ArrayBuffer) continue;
		if (ArrayBuffer.isView(candidate)) {
			throw new TypeError('Framescaper retime commands support only Uint8Array and ArrayBuffer binary values.');
		}
		const prototype = Object.getPrototypeOf(candidate) as unknown;
		if (Array.isArray(candidate)) {
			if (prototype !== Array.prototype) {
				throw new TypeError('Framescaper retime command arrays must be ordinary arrays.');
			}
		} else if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError('Framescaper retime command values must be plain objects.');
		}
		for (const key in candidate) {
			if (!Object.hasOwn(candidate, key)) {
				throw new TypeError('Framescaper retime commands cannot inherit enumerable properties.');
			}
		}
		if (active.has(candidate)) {
			throw new TypeError('Cyclic Framescaper retime command batches or values are unsupported.');
		}
		active.add(candidate);
		stack.push({ kind: 'leave', value: candidate });
		const keys = Reflect.ownKeys(candidate);
		if (keys.length > FRAMESCAPER_RETIME_COMMAND_MAXIMUM_TRAVERSAL_NODES - nodes) {
			throw new RangeError('Framescaper retime command exceeds its aggregate structural node limit.');
		}
		for (let index = keys.length - 1; index >= 0; index -= 1) {
			const key = keys[index];
			if (typeof key !== 'string') {
				throw new TypeError('Framescaper retime commands cannot contain symbol properties.');
			}
			if (Array.isArray(candidate) && key === 'length') continue;
			if (Array.isArray(candidate) && !canonicalArrayIndex(key, candidate.length)) {
				throw new TypeError('Framescaper retime command arrays cannot contain named properties.');
			}
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError('Framescaper retime command properties must be enumerable data properties.');
			}
			stack.push({ kind: 'visit', value: descriptor.value, depth: work.depth + 1 });
		}
	}
}

function canonicalArrayIndex(value: string, length: number): boolean {
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false;
	const index = Number(value);
	return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === value;
}
