/* SPDX-License-Identifier: AGPL-3.0-only */

// Desktop Soundscaper has no Framescaper surfaces. Preserve their inventory
// import contracts without shipping the unavailable product's copy owners.
const EMPTY_COPY: Readonly<Record<string, string>> = Object.freeze({});

export const FRAMESCAPER_NATIVE_SERVICES_COPY = EMPTY_COPY;
export const FRAMESCAPER_FINISHING_ADDITIONAL_COPY = EMPTY_COPY;
export const FRAMESCAPER_FINISHING_ADDITIONAL_GERMAN_COPY = EMPTY_COPY;
export const FRAMESCAPER_VISUAL_INSPECTOR_ADDITIONAL_COPY = EMPTY_COPY;
export const FRAMESCAPER_MENUS_ADDITIONAL_COPY = EMPTY_COPY;
export const FRAMESCAPER_FINISHING_SURFACE_COPY: Readonly<Record<string,
	Readonly<Record<string, string>>>> = Object.freeze({});
