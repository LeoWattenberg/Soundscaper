/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The build's application version, for files that name their producer.
 *
 * Vite substitutes `__SCAPE_VERSION__` at build time; under Node — tests, the
 * desktop main process — the identifier does not exist, so the read is guarded
 * rather than trusted. Interchange files carry this as the `Application`
 * version a receiving DAW shows, which is why "unknown" is preferred to a
 * crash or an invented number.
 */
export function applicationVersion(): string {
	return typeof __SCAPE_VERSION__ === 'string' && __SCAPE_VERSION__ ? __SCAPE_VERSION__ : 'unknown';
}
