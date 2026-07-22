/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_NYQUIST_BROWSER_H
#define SOUNDSCAPER_NYQUIST_BROWSER_H

#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Implemented by the generated, read-only runtime resource table. */
FILE *nyquist_runtime_open(const char *name, const char *mode);

#ifdef __cplusplus
}
#endif

#endif
