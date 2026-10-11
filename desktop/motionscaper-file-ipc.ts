/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionDesktopFiles } from '../src/motionscaper/desktop-file-contract.ts';

/** One closed method surface keeps file capabilities separate from other products' native services. */
export async function dispatchMotionscaperFileCall(files: MotionDesktopFiles, method: unknown, payload: unknown): Promise<unknown> {
	if (method === 'selectOpen') { record(payload, []); return files.selectOpen(); }
	if (method === 'read') {
		const value = record(payload, ['token', 'offset', 'length']);
		return files.read({ token: text(value.token), offset: number(value.offset), length: number(value.length) });
	}
	if (method === 'release' || method === 'cancel') {
		const value = record(payload, ['token']); return files[method]({ token: text(value.token) });
	}
	if (method === 'bindOpened') {
		const value = record(payload, ['token', 'projectId']); return files.bindOpened({ token: text(value.token), projectId: text(value.projectId) });
	}
	if (method === 'beginSave') {
		const value = record(payload, ['projectId', 'suggestedName', 'saveAs'], ['saveCopy']);
		if (typeof value.saveAs !== 'boolean') throw new TypeError('Invalid Motionscaper saveAs flag.');
		if (value.saveCopy !== undefined && typeof value.saveCopy !== 'boolean') throw new TypeError('Invalid Motionscaper saveCopy flag.');
		return files.beginSave({ projectId: text(value.projectId), suggestedName: text(value.suggestedName), saveAs: value.saveAs,
			...(value.saveCopy === undefined ? {} : { saveCopy: value.saveCopy }) });
	}
	if (method === 'write') {
		const value = record(payload, ['token', 'offset', 'bytes']);
		if (!(value.bytes instanceof Uint8Array)) throw new TypeError('Motionscaper file chunks must be byte arrays.');
		return files.write({ token: text(value.token), offset: number(value.offset), bytes: value.bytes });
	}
	if (method === 'commit') {
		const value = record(payload, ['token', 'byteLength']);
		return files.commit({ token: text(value.token), byteLength: number(value.byteLength) });
	}
	throw new TypeError('Unknown Motionscaper file method.');
}
function record(value: unknown, fields: readonly string[], optional: readonly string[] = []): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Motionscaper file request must be a record.');
	const keys = Reflect.ownKeys(value);
	if (fields.some((key) => !keys.includes(key)) || keys.some((key) => typeof key !== 'string' || ![...fields, ...optional].includes(key))) throw new TypeError('Motionscaper file request has unsupported fields.');
	const output: Record<string, unknown> = {};
	for (const key of [...fields, ...optional.filter((field) => keys.includes(field))]) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Motionscaper file request requires own data properties.');
		output[key] = descriptor.value;
	}
	return output;
}
function text(value: unknown): string { if (typeof value !== 'string' || value.length > 512) throw new TypeError('Invalid Motionscaper file request text.'); return value; }
function number(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError('Invalid Motionscaper file request count.'); return value as number; }
