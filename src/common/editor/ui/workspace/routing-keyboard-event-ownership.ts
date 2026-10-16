/* SPDX-License-Identifier: AGPL-3.0-only */

/** Graph gestures leave configured project/browser commands and handled keys to their owner. */
export function routingGraphOwnsKeyboardEvent(event: Readonly<{
	defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
}>): boolean {
	return !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey;
}
