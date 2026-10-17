#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMotionscaperNativeSourceManifest, MOTION_NATIVE_SOURCE_MANIFEST } from './lib/motionscaper-native-source.ts';
const root = resolve(import.meta.dirname, '..');
const manifest = await createMotionscaperNativeSourceManifest(root);
await writeFile(resolve(root, MOTION_NATIVE_SOURCE_MANIFEST), `${JSON.stringify(manifest, null, '\t')}\n`);
