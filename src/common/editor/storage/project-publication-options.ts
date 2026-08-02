/* SPDX-License-Identifier: AGPL-3.0-only */

export type ProjectPublicationAdmission = (
	bytes: number,
) => PromiseLike<unknown> | unknown;

/** Validate the closed optional admission hook accepted by project saves. */
export function projectPublicationAdmission(options: unknown): ProjectPublicationAdmission | null {
	if (!options
		|| typeof options !== 'object'
		|| Array.isArray(options)
		|| Object.getPrototypeOf(options) !== Object.prototype) {
		throw new TypeError('Project save options must be a plain object.');
	}
	const record = options as Record<string, unknown>;
	for (const name of Object.keys(record)) {
		if (name !== 'admitProjectPublication') {
			throw new TypeError(`Unsupported project save option: ${name}.`);
		}
	}
	const admission = record.admitProjectPublication;
	if (admission === undefined) return null;
	if (typeof admission !== 'function') {
		throw new TypeError('Project publication admission must be a function.');
	}
	return admission as ProjectPublicationAdmission;
}
