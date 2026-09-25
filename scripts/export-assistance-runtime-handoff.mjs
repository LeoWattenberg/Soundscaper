#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { exportDesktopAssistanceRuntimeHandoff } from './lib/desktop-assistance-runtime-handoff.mjs';

const root = resolve(import.meta.dirname, '..');
const handoffRoot = process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT;
if (!handoffRoot) throw new Error('SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT is required.');
const targetId = `${process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM}-${process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH}`;
const sourceRevision = process.env.SOUNDSCAPER_SOURCE_REVISION;
await exportDesktopAssistanceRuntimeHandoff({
	buildRoot: resolve(root, '.desktop-build'), handoffRoot: resolve(handoffRoot),
	sourceRevision, targetId,
});
console.log(`Exported verified AI runtime handoff for ${targetId} at ${sourceRevision}.`);
