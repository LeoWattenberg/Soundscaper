/* SPDX-License-Identifier: AGPL-3.0-only */
import type { VideoCubeLutReferenceV1 } from '../../video-color-cube-lut-v27.ts';

/** Scalar UI binding. The product owner privately authenticates its identity;
 * bodies remain in immutable resource storage and never enter effect params. */
export interface CubeLutEffectBindingV1 { readonly clipId: string; readonly effectId: string; }
export interface CubeLutEffectPortV1 {
	capture(clipId: string, effectId: string, expectedEffects?: readonly unknown[]): Readonly<CubeLutEffectBindingV1> | null;
	isCurrent(binding: Readonly<CubeLutEffectBindingV1>): boolean;
	importFile(binding: Readonly<CubeLutEffectBindingV1>, file: Blob, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<VideoCubeLutReferenceV1>>;
	clear(binding: Readonly<CubeLutEffectBindingV1>): Promise<void>;
	close(): Promise<void>;
}
const PORTS = new WeakMap<object, Readonly<CubeLutEffectPortV1>>();
const RETIREMENTS = new WeakMap<object, Map<object, () => Promise<void>>>(), CLOSING = new WeakMap<object, Promise<void>>();
export function bindCubeLutEffectPortV1(owner: object, port: Readonly<CubeLutEffectPortV1>, resourceOwner: object = owner): void {
	if (CLOSING.has(resourceOwner)) throw new Error('The LUT resource owner is retired.');
	const close = port.close, retirements = RETIREMENTS.get(resourceOwner) ?? new Map<object, () => Promise<void>>();
	if (typeof close !== 'function') throw new TypeError('The LUT action requires a captured retirement method.');
	if (CLOSING.has(resourceOwner)) throw new Error('The LUT resource owner is retired.');
	retirements.set(port, () => Reflect.apply(close, port, []) as Promise<void>); RETIREMENTS.set(resourceOwner, retirements); PORTS.set(owner, port);
}
export function cubeLutEffectPortV1For(owner: object): Readonly<CubeLutEffectPortV1> | null { return PORTS.get(owner) ?? null; }

/** Storage is borrowed. The actual controller owner joins every bound action
 * before closing its store; its existing failure fence keeps storage open. */
export function retireCubeLutEffectPortsV1(resourceOwner: object): Promise<void> {
	const previous = CLOSING.get(resourceOwner); if (previous) return previous;
	let resolve!: () => void, reject!: (error: unknown) => void;
	const result = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); CLOSING.set(resourceOwner, result);
	void result.catch(() => undefined);
	const failures: unknown[] = [], joined: Promise<void>[] = [];
	const record = (error: unknown) => { if (!failures.some(value => Object.is(value, error))) failures.push(error); };
	for (const close of RETIREMENTS.get(resourceOwner)?.values() ?? []) {
		try { joined.push(Promise.resolve(close()).then(() => undefined, record)); } catch (error) { record(error); }
	}
	void Promise.all(joined).then(() => {
		if (failures.length === 1) reject(failures[0]);
		else if (failures.length > 1) reject(new AggregateError(failures, 'LUT action retirements failed.', { cause: failures[0] }));
		else resolve();
	});
	return result;
}
