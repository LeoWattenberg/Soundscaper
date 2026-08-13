/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_NODES = 400_000;
export const FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_DEPTH = 160;

interface VisitWork { readonly kind: 'visit'; readonly value: unknown; readonly depth: number }
interface LeaveWork { readonly kind: 'leave'; readonly value: object }
type Work = VisitWork | LeaveWork;

/** Bound the complete history graph once before per-entry semantic validation. */
export function admitFramescaperProjectHistoryV20Structure(value: unknown): void {
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
		if (nodes > FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_NODES) {
			throw new RangeError('Framescaper V20 history exceeds its aggregate structural node limit.');
		}
		if (work.depth > FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_DEPTH) {
			throw new RangeError('Framescaper V20 history exceeds its aggregate structural depth limit.');
		}
		const candidate = work.value;
		if (candidate === null || typeof candidate !== 'object') {
			if (candidate === null) continue;
			if (typeof candidate === 'string' || typeof candidate === 'boolean'
				|| (typeof candidate === 'number' && Number.isFinite(candidate))) continue;
			throw new TypeError('Framescaper V20 history must contain JSON-compatible values.');
		}
		if (candidate instanceof Uint8Array || candidate instanceof ArrayBuffer) continue;
		if (ArrayBuffer.isView(candidate)) {
			throw new TypeError('Framescaper V20 history supports only Uint8Array and ArrayBuffer binary values.');
		}
		const prototype = Object.getPrototypeOf(candidate) as unknown;
		if (Array.isArray(candidate)) {
			if (prototype !== Array.prototype) throw new TypeError('Framescaper V20 history arrays must be ordinary arrays.');
		} else if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError('Framescaper V20 history values must be plain objects.');
		}
		if (active.has(candidate)) throw new TypeError('Cyclic Framescaper V20 history values are unsupported.');
		active.add(candidate);
		stack.push({ kind: 'leave', value: candidate });
		const keys = Reflect.ownKeys(candidate);
		if (keys.length > FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_NODES - nodes) {
			throw new RangeError('Framescaper V20 history exceeds its aggregate structural node limit.');
		}
		for (let index = keys.length - 1; index >= 0; index -= 1) {
			const key = keys[index];
			if (typeof key !== 'string') throw new TypeError('Framescaper V20 history cannot contain symbol properties.');
			if (Array.isArray(candidate) && key === 'length') continue;
			if (Array.isArray(candidate) && !canonicalArrayIndex(key, candidate.length)) {
				throw new TypeError('Framescaper V20 history arrays cannot contain named properties.');
			}
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError('Framescaper V20 history properties must be enumerable data properties.');
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
