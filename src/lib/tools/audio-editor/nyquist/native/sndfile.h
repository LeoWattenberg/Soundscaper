/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_DISABLED_SNDFILE_H
#define SOUNDSCAPER_DISABLED_SNDFILE_H

#include <stdint.h>

typedef int64_t sf_count_t;
typedef struct SNDFILE_tag SNDFILE;
typedef struct {
    sf_count_t frames;
    int samplerate;
    int channels;
    int format;
    int sections;
    int seekable;
} SF_INFO;

#endif
