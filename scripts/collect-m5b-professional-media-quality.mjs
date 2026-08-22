/* SPDX-License-Identifier: AGPL-3.0-only */

import { runM5bQualityCollectorCli } from './lib/m5b-quality-pipeline.mjs';

await runM5bQualityCollectorCli('professional-media', import.meta.url);
