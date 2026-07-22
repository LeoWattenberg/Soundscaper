/*
 * SPDX-License-Identifier: MIT
 *
 * Minimal design-only extraction from Signalsmith DSP filters.h v1.7.1,
 * commit 2d20161915e733f117545c6be8cd3275a739a1e3.
 * Copyright (c) 2021 Geraint Luff / Signalsmith Audio Ltd.
 *
 * The runtime does not process audio with this direct-form reference. The
 * repository-owned designer uses these matched-filter equations, improves
 * their low-frequency endpoint calculations, and converts the result to TPT.
 */

#ifndef SOUNDSCAPER_SIGNALSMITH_VICANEK_REFERENCE_H
#define SOUNDSCAPER_SIGNALSMITH_VICANEK_REFERENCE_H

#include <algorithm>
#include <cmath>

namespace signalsmith_reference {
enum class Type {
    highpass,
    lowpass,
    notch,
    peak
};

struct Coefficients {
    double b0;
    double b1;
    double b2;
    double a1;
    double a2;
};

/* This function retains the upstream variable names to make audits simple. */
inline Coefficients designVicanek(
    Type type,
    double scaledFreq,
    double qValue,
    double gainDb = 0.0)
{
    constexpr double pi = 3.14159265358979323846264338327950288;
    scaledFreq = std::max(1e-6, std::min(0.4999, scaledFreq));
    const double w0 = 2 * pi * scaledFreq;
    const double sqrtGain = std::pow(10.0, gainDb * 0.025);
    const double inv2Q = 0.5 / qValue;
    const double Q = type == Type::peak ? 0.5 * sqrtGain / inv2Q : 0.5 / inv2Q;
    const double q = type == Type::peak ? inv2Q / sqrtGain : inv2Q;
    const double expmqw = std::exp(-q * w0);
    double a1;
    if (q <= 1) {
        a1 = -2 * expmqw * std::cos(std::sqrt(1 - q * q) * w0);
    } else {
        a1 = -2 * expmqw * std::cosh(std::sqrt(q * q - 1) * w0);
    }
    const double a2 = expmqw * expmqw;
    const double sinpd2 = std::sin(w0 / 2);
    const double p0 = 1 - sinpd2 * sinpd2;
    const double p1 = sinpd2 * sinpd2;
    const double p2 = 4 * p0 * p1;
    double A0 = 1 + a1 + a2;
    double A1 = 1 - a1 + a2;
    const double A2 = -4 * a2;
    A0 *= A0;
    A1 *= A1;
    double b0 = 0;
    double b1 = 0;
    double b2 = 0;
    if (type == Type::lowpass) {
        const double R1 = (A0 * p0 + A1 * p1 + A2 * p2) * Q * Q;
        const double B0 = A0;
        const double B1 = (R1 - B0 * p0) / p1;
        b0 = 0.5 * (std::sqrt(B0) + std::sqrt(std::max(0.0, B1)));
        b1 = std::sqrt(B0) - b0;
    } else if (type == Type::highpass) {
        b2 = b0 = std::sqrt(A0 * p0 + A1 * p1 + A2 * p2) * Q / (4 * p1);
        b1 = -2 * b0;
    } else if (type == Type::notch) {
        b0 = 1;
        b1 = -2 * std::cos(w0);
        b2 = 1;
        const double scale = std::sqrt(A0) / (b0 + b1 + b2);
        b0 *= scale;
        b1 *= scale;
        b2 *= scale;
    } else {
        const double G2 = sqrtGain * sqrtGain * sqrtGain * sqrtGain;
        const double R1 = (A0 * p0 + A1 * p1 + A2 * p2) * G2;
        const double R2 = (-A0 + A1 + 4 * (p0 - p1) * A2) * G2;
        const double B0 = A0;
        const double B2 = (R1 - R2 * p1 - B0) / (4 * p1 * p1);
        const double B1 = R2 + B0 + 4 * (p1 - p0) * B2;
        const double W = 0.5 * (std::sqrt(B0) + std::sqrt(std::max(0.0, B1)));
        b0 = 0.5 * (W + std::sqrt(std::max(0.0, W * W + B2)));
        b1 = 0.5 * (std::sqrt(B0) - std::sqrt(std::max(0.0, B1)));
        b2 = -B2 / (4 * b0);
    }
    return { b0, b1, b2, a1, a2 };
}
} // namespace signalsmith_reference

#endif /* SOUNDSCAPER_SIGNALSMITH_VICANEK_REFERENCE_H */
