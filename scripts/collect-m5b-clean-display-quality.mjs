/* SPDX-License-Identifier: AGPL-3.0-only */

import { runM5bQualityCollectorCli } from './lib/m5b-quality-collector.mjs';

await runM5bQualityCollectorCli('clean-display', import.meta.url);
