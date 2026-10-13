#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseArgs } from 'node:util';
import { qualifyMotionscaperAuthoredTitle } from '../desktop/motionscaper-authored-qualification.ts';
const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Authored native qualification requires an exclusive --output directory.');
await qualifyMotionscaperAuthoredTitle(values.output);
