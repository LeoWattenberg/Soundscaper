/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { createStableId } from './stable-id.js';

interface Effect { readonly id: string; readonly type: string; readonly enabled: boolean; readonly params: Readonly<Record<string, number>> }
interface Profile {
	readonly name: string;
	readonly typeError: string;
	readonly normalizeParams: (value: unknown) => Readonly<Record<string, number>>;
	readonly normalizeEffect: (value: unknown) => Effect;
}
/** Internal registry utility: only fixed owning callbacks select admission.
 * It preserves the pre-existing wheel/detail closed options and diagnostics;
 * no generic parameter tree or externally selected effect profile persists. */
export function createClosedVideoEffect(type: string, options: unknown, profile: Profile) {
	const { name, typeError, normalizeParams, normalizeEffect } = profile;
	const closed = record(options, name, ['id','type','enabled','params','index'], []);
	const take = (key: string) => Object.hasOwn(closed,key) ? field(closed,key,name) : undefined;
	if (Object.hasOwn(closed,'type') && take('type') !== type) throw new RangeError(typeError);
	const index = take('index'); if(index!==undefined && (!Number.isSafeInteger(index) || (index as number)<0 || (index as number)>100_000)) throw new RangeError('Invalid effect insertion index.');
	const normalized = normalizeEffect({ id:Object.hasOwn(closed,'id')?take('id'):createStableId('video-effect'), type,
		enabled:Object.hasOwn(closed,'enabled')?take('enabled'):true,params:normalizeParams(take('params')) });
	return { ...normalized, params:{ ...normalized.params } };
}
