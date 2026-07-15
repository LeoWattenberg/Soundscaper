/* SPDX-License-Identifier: AGPL-3.0-only */

#include "xlisp.h"
#include "sound.h"

#include <stdint.h>

/* File import/export is intentionally unavailable in the browser runtime. */
LVAL snd_make_read(unsigned char *filename, time_type offset, time_type t0,
                   long *format, long *channels, long *mode, long *bits,
                   long *swap, double *srate, double *dur, long *flags)
{
    (void)filename; (void)offset; (void)t0; (void)format; (void)channels;
    (void)mode; (void)bits; (void)swap; (void)srate; (void)dur; (void)flags;
    xlerror("Sound-file input is disabled in the browser", NIL);
    return NIL;
}

double sound_save(LVAL sound, int64_t frames, unsigned char *filename,
                  long format, long mode, long bits, long swap, double *rate,
                  long *channels, double *duration, LVAL play, int64_t progress)
{
    (void)sound; (void)frames; (void)filename; (void)format; (void)mode;
    (void)bits; (void)swap; (void)rate; (void)channels; (void)duration;
    (void)play; (void)progress;
    xlerror("Sound-file output is disabled in the browser", NIL);
    return 0.0;
}

double sound_overwrite(LVAL sound, int64_t frames, unsigned char *filename,
                       double offset, double *duration, int64_t progress)
{
    (void)sound; (void)frames; (void)filename; (void)offset; (void)duration;
    (void)progress;
    xlerror("Sound-file output is disabled in the browser", NIL);
    return 0.0;
}

void write_pv_frame(long zeros, float *frame, long fftsize, char *prefix)
{
    (void)zeros; (void)frame; (void)fftsize; (void)prefix;
}

void local_toplevel(void)
{
}

void portaudio_exit(void)
{
}
