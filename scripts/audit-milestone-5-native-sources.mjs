#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import {
	MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS,
	auditMilestone5NativeSourceAcquisitions,
} from './lib/milestone-5-native-source-acquisitions.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRootArgument = process.argv.indexOf('--source-root');
const sourceRoot = sourceRootArgument < 0 ? undefined : resolve(process.argv[sourceRootArgument + 1]);
const audit = auditMilestone5NativeSourceAcquisitions(repositoryRoot, sourceRoot);
const authenticated = audit.sources.filter(({ authenticationStatus }) => (
	authenticationStatus === 'authenticated'
)).length;

console.log(`${MILESTONE_5_NATIVE_SOURCE_ACQUISITIONS}: ${authenticated}/${audit.sources.length} exact archive/extracted-tree inputs authenticated; `
	+ `${audit.delegatedSources.length} delegated source manifests; status=${audit.status}.`);
if (process.argv.includes('--require-authenticated') && audit.status !== 'authenticated') process.exitCode = 1;
