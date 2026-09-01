/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The primitive admission rules the milestone-5B native contracts share.
 *
 * Every native module admits untrusted input through the same five checks — a
 * plain record, exactly its schema keys, a canonical string, a lowercase
 * SHA-256 digest, a non-negative safe integer — and each one used to carry its
 * own copy. Ten copies of one rule is ten places a tightened edge case has to
 * land, and the copy that misses the change goes on admitting what the others
 * have started refusing.
 *
 * The rule is shared; the refusal is not. A caller binds its own raise callback
 * and its own subject, so a queue row still fails with a
 * `NativeQueueRecordError` reading "A native queue record …" and a plan still
 * fails as a canonical-form violation. Sharing a predicate must never change
 * which error a caller catches or what that error says.
 *
 * Where a module deliberately checks more than the others — the canonical plan
 * refuses a record with an exotic prototype — the difference is a parameter
 * rather than something flattened into or out of everyone else.
 */

/** One lowercase SHA-256 digest, the only digest form the native tier stores. */
export const NATIVE_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export interface NativeValidators {
	/** `<subject> <label> is not in its canonical form.` */
	pattern(value: unknown, expression: RegExp, label: string): string;
	/** The pattern rule, bound to the shared SHA-256 form. */
	digest(value: unknown, label: string): string;
	/** `<subject> <label> must be a non-negative safe integer.` */
	nonNegativeInteger(value: unknown, label: string): number;
	/** `<article> <label> must be a plain record.` */
	plainRecord(value: unknown, label: string): Record<string, unknown>;
	/** `<article> <label> must carry exactly its schema keys.` */
	exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void;
}

export interface NativeValidatorOptions {
	/** How this module names itself in a labelled refusal, article included. */
	readonly subject: string;
	/** The article the record rules put in front of their own label. */
	readonly article?: string;
	/** Turn one failed rule into this module's own error. */
	readonly raise: (message: string) => never;
	/** Also refuse a record carrying a prototype other than `Object` or none. */
	readonly requirePlainPrototype?: boolean;
}

/** Bind the shared rules to one module's subject, article, and refusal. */
export function createNativeValidators(options: NativeValidatorOptions): NativeValidators {
	const raise: (message: string) => never = options.raise;
	const subject = options.subject;
	const article = options.article ?? 'A';
	const requirePlainPrototype = options.requirePlainPrototype === true;

	const pattern = (value: unknown, expression: RegExp, label: string): string => {
		if (typeof value !== 'string' || !expression.test(value)) {
			raise(`${subject} ${label} is not in its canonical form.`);
		}
		return value;
	};

	return Object.freeze({
		pattern,
		digest(value: unknown, label: string): string {
			return pattern(value, NATIVE_SHA256_HEX_PATTERN, label);
		},
		nonNegativeInteger(value: unknown, label: string): number {
			if (!Number.isSafeInteger(value) || (value as number) < 0) {
				raise(`${subject} ${label} must be a non-negative safe integer.`);
			}
			return value as number;
		},
		plainRecord(value: unknown, label: string): Record<string, unknown> {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				raise(`${article} ${label} must be a plain record.`);
			}
			if (requirePlainPrototype) {
				const prototype = Object.getPrototypeOf(value) as unknown;
				if (prototype !== Object.prototype && prototype !== null) {
					raise(`${article} ${label} must be a plain record.`);
				}
			}
			for (const key of Reflect.ownKeys(value)) {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
					raise(`${article} ${label} must be a plain record.`);
				}
			}
			return value as Record<string, unknown>;
		},
		exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
			const present = Object.keys(record);
			if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
				raise(`${article} ${label} must carry exactly its schema keys.`);
			}
		},
	});
}
