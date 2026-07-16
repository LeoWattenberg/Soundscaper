/* SPDX-License-Identifier: AGPL-3.0-only */

#include "parametric_eq_wasm.h"

#include <cmath>
#include <cstdint>

namespace {
constexpr int kAbiVersion = 2;
constexpr int kLinearMemoryBytes = 1024 * 1024;
constexpr int kMaximumBlockSize = 1024;
constexpr int kMaximumChannels = 32;
constexpr int kMaximumBands = 12;
constexpr int kMaximumSections = 48;
constexpr int kMaximumSectionsPerBand = 4;
constexpr int kMaximumTransitionFrames = 1000000;
constexpr int kDesignIntervalFrames = 16;
constexpr double kMaximumCoefficient = 1e12;
constexpr double kMaximumOutputGainDb = 120.0;
constexpr double kStateFlushThreshold = 1e-30;
constexpr double kMinimumResponseMagnitudeSquared = 1e-60;
constexpr double kSmoothingTimeSeconds = 0.005;
constexpr double kSemanticSnapThreshold = 1e-13;
constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr double kDecibelsToNaturalLog = 0.11512925464970228420089957273422;

struct TptValues {
    double g;
    double k;
    double m0;
    double m1;
    double m2;
};

struct TptSection {
    TptValues current {};
    TptValues target {};
    TptValues finalTarget {};
    TptValues step {};
    double inverseDenominator = 1.0;
    double state[kMaximumChannels][2] {};
    bool configured = false;
};

struct Band {
    int firstSection = 0;
    int sectionCount = 0;
    double wet = 1.0;
    double wetStart = 1.0;
    double wetTarget = 1.0;
    int wetTotalFrames = 0;
    int wetRemainingFrames = 0;
    int type = PEQ_BAND_PEAKING;
    int slopeDbPerOctave = 12;
    double log2Frequency = 0.0;
    double targetLog2Frequency = 0.0;
    double logQ = 0.0;
    double targetLogQ = 0.0;
    double gainDb = 0.0;
    double targetGainDb = 0.0;
    bool semanticActive = false;
    bool finishAfterSlice = false;
    bool semanticConfigured = false;
    bool exactIdentity = false;
    bool configured = false;
};

struct Bank {
    TptSection sections[kMaximumSections] {};
    Band bands[kMaximumBands] {};
    int bandCount = 0;
    int sectionCount = 0;
    double outputGainDb = 0.0;
    double outputGainTargetDb = 0.0;
    double outputGainStepDb = 0.0;
    double outputGain = 1.0;
    int smoothTotalFrames = 0;
    int smoothRemainingFrames = 0;
    int semanticSliceRemainingFrames = 0;
    bool semanticBandsActive = false;
    bool outputSemanticActive = false;
    bool semanticConfiguration = false;
    bool building = false;
    bool valid = false;
};

struct BiquadValues {
    double b0;
    double b1;
    double b2;
    double a1;
    double a2;
    double d0;
    double dpi;
    double n0;
    double npi;
};

struct DenominatorValues {
    double a1;
    double a2;
    double d0;
    double dpi;
};

struct ComplexValue {
    double real;
    double imaginary;
};

alignas(16) float gInput[kMaximumChannels][kMaximumBlockSize] {};
alignas(16) float gOutput[kMaximumChannels][kMaximumBlockSize] {};
Bank gBanks[2] {};
int gSampleRate = 0;
int gChannels = 0;
int gActiveBank = 0;
int gTransitionTargetBank = -1;
int gTransitionTotalFrames = 0;
int gTransitionRemainingFrames = 0;
int gFramesUntilStateFlush = 128;
double gSmoothingRetention = 0.0;
double gDesignIntervalRetention = 0.0;

bool IsFinite(double value)
{
    return std::isfinite(value);
}

bool IsBoundedCoefficient(double value)
{
    return IsFinite(value) && std::fabs(value) <= kMaximumCoefficient;
}

double Clamp(double value, double minimum, double maximum)
{
    return value < minimum ? minimum : value > maximum ? maximum : value;
}

bool IsValidBandType(int type)
{
    return type >= PEQ_BAND_PEAKING && type <= PEQ_BAND_AUDITION_BANDPASS;
}

bool IsGainBandType(int type)
{
    return type == PEQ_BAND_PEAKING
        || type == PEQ_BAND_LOWSHELF
        || type == PEQ_BAND_HIGHSHELF;
}

int SectionCountForBand(int type, int slopeDbPerOctave)
{
    if (type == PEQ_BAND_HIGHPASS || type == PEQ_BAND_LOWPASS) {
        return slopeDbPerOctave / 12;
    }
    return 1;
}

bool IsValidBiquad(const BiquadValues& values)
{
    if (!IsBoundedCoefficient(values.b0)
        || !IsBoundedCoefficient(values.b1)
        || !IsBoundedCoefficient(values.b2)
        || !IsBoundedCoefficient(values.a1)
        || !IsBoundedCoefficient(values.a2)
        || !IsBoundedCoefficient(values.d0)
        || !IsBoundedCoefficient(values.dpi)
        || !IsBoundedCoefficient(values.n0)
        || !IsBoundedCoefficient(values.npi)
        || !(values.d0 > 0.0) || !(values.dpi > 0.0)) {
        return false;
    }
    return values.a2 < 1.0
        && values.a2 > std::fabs(values.a1) - 1.0;
}

DenominatorValues MappedDenominator(double w0, double damping)
{
    if (damping <= 1.0) {
        const double radius = std::exp(-damping * w0);
        const double theta = std::sqrt(
            damping < 1.0 ? 1.0 - damping * damping : 0.0) * w0;
        const double oneMinusRadius = -std::expm1(-damping * w0);
        const double sinHalf = std::sin(theta * 0.5);
        const double cosHalf = std::cos(theta * 0.5);
        return {
            -2.0 * radius * std::cos(theta),
            radius * radius,
            oneMinusRadius * oneMinusRadius
                + 4.0 * radius * sinHalf * sinHalf,
            oneMinusRadius * oneMinusRadius
                + 4.0 * radius * cosHalf * cosHalf
        };
    }
    const double spread = std::sqrt(damping * damping - 1.0);
    const double exponent1 = (-damping + spread) * w0;
    const double exponent2 = (-damping - spread) * w0;
    const double pole1 = std::exp(exponent1);
    const double pole2 = std::exp(exponent2);
    return {
        -(pole1 + pole2),
        pole1 * pole2,
        (-std::expm1(exponent1)) * (-std::expm1(exponent2)),
        (1.0 + pole1) * (1.0 + pole2)
    };
}

bool InvertBiquad(const BiquadValues& input, BiquadValues& output)
{
    const double scale = input.b0;
    if (!IsFinite(scale) || std::fabs(scale) < 1e-18) {
        return false;
    }
    output = {
        1.0 / scale,
        input.a1 / scale,
        input.a2 / scale,
        input.b1 / scale,
        input.b2 / scale,
        input.n0 / scale,
        input.npi / scale,
        input.d0 / scale,
        input.dpi / scale
    };
    return IsValidBiquad(output);
}

bool DesignIdentityWithMatchedPoles(double frequencyHz, BiquadValues& output)
{
    const double scaledFrequency = Clamp(
        frequencyHz / static_cast<double>(gSampleRate), 1e-8, 0.49);
    const DenominatorValues denominator = MappedDenominator(
        2.0 * kPi * scaledFrequency, 1.0 / std::sqrt(2.0));
    output = {
        1.0,
        denominator.a1,
        denominator.a2,
        denominator.a1,
        denominator.a2,
        denominator.d0,
        denominator.dpi,
        denominator.d0,
        denominator.dpi
    };
    return IsValidBiquad(output);
}

bool DesignMatchedSection(
    int type,
    double frequencyHz,
    double qValue,
    double gainDb,
    BiquadValues& output)
{
    if (type == PEQ_BAND_PEAKING && gainDb < 0.0) {
        BiquadValues positive {};
        return DesignMatchedSection(type, frequencyHz, qValue, -gainDb, positive)
            && InvertBiquad(positive, output);
    }
    const double scaledFrequency = Clamp(
        frequencyHz / static_cast<double>(gSampleRate), 1e-8, 0.49);
    const double w0 = 2.0 * kPi * scaledFrequency;
    const double userQ = qValue > 0.01 ? qValue : 0.01;
    const double sqrtGain = std::pow(10.0, gainDb / 40.0);
    const double inverseTwoQ = 0.5 / userQ;
    const double designQ = type == PEQ_BAND_PEAKING
        ? userQ * sqrtGain
        : userQ;
    const double poleDamping = type == PEQ_BAND_PEAKING
        ? inverseTwoQ / sqrtGain
        : inverseTwoQ;
    const DenominatorValues denominator = MappedDenominator(w0, poleDamping);
    const double a1 = denominator.a1;
    const double a2 = denominator.a2;
    const double d0 = denominator.d0;
    const double dpi = denominator.dpi;
    const double sinHalf = std::sin(w0 * 0.5);
    const double p1 = sinHalf * sinHalf;
    const double p0 = 1.0 - p1;
    const double p2 = 4.0 * p0 * p1;
    const double A0 = d0 * d0;
    const double A1 = dpi * dpi;
    const double A2 = -4.0 * a2;
    double b0 = 0.0;
    double b1 = 0.0;
    double b2 = 0.0;

    if (type == PEQ_BAND_LOWPASS) {
        const double R1 = (A0 * p0 + A1 * p1 + A2 * p2)
            * designQ * designQ;
        const double B0 = A0;
        const double B1 = (R1 - B0 * p0) / p1;
        b0 = 0.5 * (std::sqrt(B0) + std::sqrt(B1 > 0.0 ? B1 : 0.0));
        b1 = std::sqrt(B0) - b0;
    } else if (type == PEQ_BAND_HIGHPASS) {
        const double value = A0 * p0 + A1 * p1 + A2 * p2;
        b0 = std::sqrt(value > 0.0 ? value : 0.0)
            * designQ / (4.0 * p1);
        b1 = -2.0 * b0;
        b2 = b0;
    } else if (type == PEQ_BAND_AUDITION_BANDPASS) {
        const double R1 = A0 * p0 + A1 * p1 + A2 * p2;
        const double R2 = -A0 + A1 + 4.0 * (p0 - p1) * A2;
        const double B2 = (R1 - R2 * p1) / (4.0 * p1 * p1);
        const double B1 = R2 + 4.0 * (p1 - p0) * B2;
        b1 = -0.5 * std::sqrt(B1 > 0.0 ? B1 : 0.0);
        const double rootValue = B2 + 0.25 * B1;
        b0 = 0.5 * (std::sqrt(rootValue > 0.0 ? rootValue : 0.0) - b1);
        b2 = -b0 - b1;
    } else if (type == PEQ_BAND_NOTCH) {
        const double scale = d0 / (4.0 * p1);
        b0 = scale;
        b1 = -2.0 * std::cos(w0) * scale;
        b2 = scale;
    } else if (type == PEQ_BAND_PEAKING) {
        const double G2 = sqrtGain * sqrtGain * sqrtGain * sqrtGain;
        const double R1 = (A0 * p0 + A1 * p1 + A2 * p2) * G2;
        const double R2 = (-A0 + A1 + 4.0 * (p0 - p1) * A2) * G2;
        const double B0 = A0;
        const double B2 = (R1 - R2 * p1 - B0) / (4.0 * p1 * p1);
        const double B1 = R2 + B0 + 4.0 * (p1 - p0) * B2;
        const double W = 0.5 * (
            std::sqrt(B0) + std::sqrt(B1 > 0.0 ? B1 : 0.0));
        const double rootValue = W * W + B2;
        b0 = 0.5 * (W + std::sqrt(rootValue > 0.0 ? rootValue : 0.0));
        b1 = 0.5 * (
            std::sqrt(B0) - std::sqrt(B1 > 0.0 ? B1 : 0.0));
        b2 = -B2 / (4.0 * b0);
    } else {
        return false;
    }

    double n0;
    double npi;
    if (type == PEQ_BAND_PEAKING) {
        n0 = d0;
        npi = b0 - b1 + b2;
    } else if (type == PEQ_BAND_LOWPASS) {
        n0 = d0;
        npi = b0 - b1 + b2;
    } else if (type == PEQ_BAND_HIGHPASS) {
        n0 = 0.0;
        npi = 4.0 * b0;
    } else if (type == PEQ_BAND_AUDITION_BANDPASS) {
        n0 = 0.0;
        npi = -2.0 * b1;
    } else {
        n0 = d0;
        npi = 4.0 * p0 * (d0 / (4.0 * p1));
    }
    output = { b0, b1, b2, a1, a2, d0, dpi, n0, npi };
    return IsValidBiquad(output);
}

void ShelfMatch(
    double fc4,
    double frequency,
    double gain,
    double inverseGain,
    double& magnitudeSquared,
    double& phi)
{
    const double square = frequency * frequency;
    const double fourth = square * square;
    const double sine = std::sin(0.5 * kPi * frequency);
    magnitudeSquared = (fc4 + fourth * gain)
        / (fc4 + fourth * inverseGain);
    phi = sine * sine;
}

bool DesignMatchedShelf(
    int type,
    double frequencyHz,
    double gainDb,
    BiquadValues& output)
{
    if (gainDb < 0.0) {
        BiquadValues positive {};
        return DesignMatchedShelf(type, frequencyHz, -gainDb, positive)
            && InvertBiquad(positive, output);
    }
    if (gainDb == 0.0) {
        return DesignIdentityWithMatchedPoles(frequencyHz, output);
    }
    const double fc = Clamp(
        frequencyHz / (0.5 * static_cast<double>(gSampleRate)), 2e-8, 0.98);
    const double gain = std::pow(10.0, gainDb / 20.0);
    const bool lowShelf = type == PEQ_BAND_LOWSHELF;
    const double g = lowShelf ? 1.0 / gain : gain;
    const double inverseGain = 1.0 / g;
    const double fc2 = fc * fc;
    const double fc4 = fc2 * fc2;
    const double hNyquist = (fc4 + g) / (fc4 + inverseGain);
    const double f1 = fc / std::sqrt(0.160 + 1.543 * fc2);
    const double f2 = fc / std::sqrt(0.947 + 3.806 * fc2);
    double h1;
    double phi1;
    double h2;
    double phi2;
    ShelfMatch(fc4, f1, g, inverseGain, h1, phi1);
    ShelfMatch(fc4, f2, g, inverseGain, h2, phi2);
    const double d1 = (h1 - 1.0) * (1.0 - phi1);
    const double d2 = (h2 - 1.0) * (1.0 - phi2);
    const double c11 = -phi1 * d1;
    const double c12 = phi1 * phi1 * (hNyquist - h1);
    const double c21 = -phi2 * d2;
    const double c22 = phi2 * phi2 * (hNyquist - h2);
    const double determinant = c11 * c22 - c12 * c21;
    const double determinantScale = std::fabs(c11 * c22)
        + std::fabs(c12 * c21);
    if (!IsFinite(determinant) || !IsFinite(determinantScale)
        || determinantScale == 0.0
        || std::fabs(determinant) / determinantScale < 1e-12) {
        return false;
    }
    const double alpha1 = (c22 * d1 - c12 * d2) / determinant;
    const double AA1 = (c11 * d2 - d1 * c21) / determinant;
    const double BB1 = hNyquist * AA1;
    const double AA2 = 0.25 * (alpha1 - AA1);
    const double BB2 = 0.25 * (alpha1 - BB1);
    const double sqrtAA1 = std::sqrt(AA1 > 0.0 ? AA1 : 0.0);
    const double sqrtBB1 = std::sqrt(BB1 > 0.0 ? BB1 : 0.0);
    const double v = 0.5 * (1.0 + sqrtAA1);
    const double w = 0.5 * (1.0 + sqrtBB1);
    const double aRoot = v * v + AA2;
    const double a0 = 0.5 * (v + std::sqrt(aRoot > 0.0 ? aRoot : 0.0));
    const double inverseA0 = 1.0 / a0;
    const double a1 = (1.0 - v) * inverseA0;
    const double a2 = -0.25 * AA2 * inverseA0 * inverseA0;
    double b0;
    double b1;
    double b2;
    const double bRoot = w * w + BB2;
    if (lowShelf) {
        const double gainInverseA0 = inverseGain * inverseA0;
        b0 = 0.5 * (w + std::sqrt(bRoot > 0.0 ? bRoot : 0.0));
        b1 = (1.0 - w) * gainInverseA0;
        b2 = (-0.25 * BB2 / b0) * gainInverseA0;
        b0 *= gainInverseA0;
    } else {
        b0 = 0.5 * (w + std::sqrt(bRoot > 0.0 ? bRoot : 0.0)) * inverseA0;
        b1 = (1.0 - w) * inverseA0;
        b2 = (-0.25 * BB2 / b0) * inverseA0 * inverseA0;
    }
    const double endpointFactor = lowShelf ? inverseGain : 1.0;
    output = {
        b0,
        b1,
        b2,
        a1,
        a2,
        inverseA0,
        sqrtAA1 * inverseA0,
        endpointFactor * inverseA0,
        endpointFactor * sqrtBB1 * inverseA0
    };
    return IsValidBiquad(output);
}

bool BiquadToTpt(const BiquadValues& values, TptValues& output)
{
    if (!IsValidBiquad(values)) {
        return false;
    }
    const double root = std::sqrt(values.d0 * values.dpi);
    output = {
        std::sqrt(values.d0 / values.dpi),
        2.0 * (1.0 - values.a2) / root,
        values.npi / values.dpi,
        2.0 * (values.b0 - values.b2) / root,
        values.n0 / values.d0
    };
    return output.g > 0.0 && output.k > 0.0
        && IsBoundedCoefficient(output.g)
        && IsBoundedCoefficient(output.k)
        && IsBoundedCoefficient(output.m0)
        && IsBoundedCoefficient(output.m1)
        && IsBoundedCoefficient(output.m2);
}

bool DesignBandAt(
    const Band& band,
    double log2Frequency,
    double gainDb,
    double logQ,
    TptValues output[kMaximumSectionsPerBand])
{
    const double requestedFrequency = std::exp2(log2Frequency);
    const double frequencyHz = Clamp(
        requestedFrequency, 10.0,
        0.49 * static_cast<double>(gSampleRate) < 24000.0
            ? 0.49 * static_cast<double>(gSampleRate)
            : 24000.0);
    const double q = std::exp(logQ);
    const int sectionCount = SectionCountForBand(
        band.type, band.slopeDbPerOctave);
    for (int section = 0; section < sectionCount; ++section) {
        BiquadValues biquad {};
        bool designed;
        if (band.type == PEQ_BAND_LOWSHELF
            || band.type == PEQ_BAND_HIGHSHELF) {
            designed = DesignMatchedShelf(
                band.type, frequencyHz, gainDb, biquad);
        } else {
            double sectionQ = q;
            if (band.type == PEQ_BAND_HIGHPASS
                || band.type == PEQ_BAND_LOWPASS) {
                const int order = sectionCount * 2;
                sectionQ = 1.0 / (2.0 * std::cos(
                    (2.0 * static_cast<double>(section + 1) - 1.0)
                    * kPi / (2.0 * static_cast<double>(order))));
            }
            designed = DesignMatchedSection(
                band.type, frequencyHz, sectionQ, gainDb, biquad);
        }
        if (!designed || !BiquadToTpt(biquad, output[section])) {
            return false;
        }
    }
    return true;
}

TptValues Add(const TptValues& value, const TptValues& increment)
{
    return {
        value.g + increment.g,
        value.k + increment.k,
        value.m0 + increment.m0,
        value.m1 + increment.m1,
        value.m2 + increment.m2
    };
}

TptValues DifferencePerFrame(
    const TptValues& target,
    const TptValues& current,
    int frames)
{
    const double inverseFrames = 1.0 / static_cast<double>(frames);
    return {
        (target.g - current.g) * inverseFrames,
        (target.k - current.k) * inverseFrames,
        (target.m0 - current.m0) * inverseFrames,
        (target.m1 - current.m1) * inverseFrames,
        (target.m2 - current.m2) * inverseFrames
    };
}

bool IsValidTpt(const TptValues& values)
{
    if (!(values.g > 0.0) || !(values.k > 0.0)
        || !IsBoundedCoefficient(values.g)
        || !IsBoundedCoefficient(values.k)
        || !IsBoundedCoefficient(values.m0)
        || !IsBoundedCoefficient(values.m1)
        || !IsBoundedCoefficient(values.m2)) {
        return false;
    }
    const double denominator = 1.0 + values.g * (values.g + values.k);
    return IsFinite(denominator) && denominator > 0.0;
}

void UpdateSectionCache(TptSection& section)
{
    const TptValues& values = section.current;
    section.inverseDenominator = 1.0
        / (1.0 + values.g * (values.g + values.k));
}

void UpdateOutputGainCache(Bank& bank)
{
    bank.outputGain = std::exp(kDecibelsToNaturalLog * bank.outputGainDb);
}

void ClearSectionState(TptSection& section)
{
    for (int channel = 0; channel < kMaximumChannels; ++channel) {
        section.state[channel][0] = 0.0;
        section.state[channel][1] = 0.0;
    }
}

void ResetBankState(Bank& bank)
{
    for (int section = 0; section < bank.sectionCount; ++section) {
        ClearSectionState(bank.sections[section]);
    }
}

void CancelBankSmoothing(Bank& bank)
{
    bank.smoothTotalFrames = 0;
    bank.smoothRemainingFrames = 0;
    bank.semanticSliceRemainingFrames = 0;
    bank.semanticBandsActive = false;
    bank.outputSemanticActive = false;
    bank.outputGainDb = bank.outputGainTargetDb;
    bank.outputGainStepDb = 0.0;
    UpdateOutputGainCache(bank);
    for (int section = 0; section < bank.sectionCount; ++section) {
        bank.sections[section].current = bank.sections[section].finalTarget;
        bank.sections[section].target = bank.sections[section].finalTarget;
        bank.sections[section].step = {};
        UpdateSectionCache(bank.sections[section]);
    }
    for (int band = 0; band < bank.bandCount; ++band) {
        Band& value = bank.bands[band];
        value.log2Frequency = value.targetLog2Frequency;
        value.logQ = value.targetLogQ;
        value.gainDb = value.targetGainDb;
        value.semanticActive = false;
        value.finishAfterSlice = false;
        value.exactIdentity = bank.semanticConfiguration
            && IsGainBandType(value.type) && value.gainDb == 0.0;
        value.wet = value.wetTarget;
        value.wetStart = value.wetTarget;
        value.wetTotalFrames = 0;
        value.wetRemainingFrames = 0;
    }
}

void FinishCoefficientSmoothing(Bank& bank)
{
    bank.smoothTotalFrames = 0;
    bank.smoothRemainingFrames = 0;
    bank.outputGainDb = bank.outputGainTargetDb;
    bank.outputGainStepDb = 0.0;
    UpdateOutputGainCache(bank);
    for (int section = 0; section < bank.sectionCount; ++section) {
        bank.sections[section].current = bank.sections[section].finalTarget;
        bank.sections[section].target = bank.sections[section].finalTarget;
        bank.sections[section].step = {};
        UpdateSectionCache(bank.sections[section]);
    }
}

void ClearAudioOutput(int frames)
{
    const int boundedFrames = frames > 0 && frames <= kMaximumBlockSize
        ? frames
        : kMaximumBlockSize;
    for (int channel = 0; channel < kMaximumChannels; ++channel) {
        for (int frame = 0; frame < boundedFrames; ++frame) {
            gOutput[channel][frame] = 0.0f;
        }
    }
}

bool HasSameTopology(const Bank& first, const Bank& second)
{
    if (first.bandCount != second.bandCount
        || first.sectionCount != second.sectionCount
        || first.semanticConfiguration != second.semanticConfiguration) {
        return false;
    }
    for (int band = 0; band < first.bandCount; ++band) {
        if (first.bands[band].firstSection != second.bands[band].firstSection
            || first.bands[band].sectionCount != second.bands[band].sectionCount
            || (first.semanticConfiguration
                && (first.bands[band].type != second.bands[band].type
                    || first.bands[band].slopeDbPerOctave
                        != second.bands[band].slopeDbPerOctave))) {
            return false;
        }
    }
    return true;
}

bool IsCompleteConfiguration(const Bank& bank)
{
    if (!bank.building || bank.bandCount < 0 || bank.bandCount > kMaximumBands
        || bank.sectionCount < 0 || bank.sectionCount > kMaximumSections) {
        return false;
    }
    if ((bank.bandCount == 0) != (bank.sectionCount == 0)) {
        return false;
    }
    int expectedSection = 0;
    for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
        const Band& band = bank.bands[bandIndex];
        if (!band.configured || band.firstSection != expectedSection
            || band.sectionCount < 1
            || band.sectionCount > kMaximumSectionsPerBand
            || !IsFinite(band.wetTarget)
            || band.wetTarget < 0.0 || band.wetTarget > 1.0
            || (bank.semanticConfiguration && !band.semanticConfigured)) {
            return false;
        }
        expectedSection += band.sectionCount;
    }
    if (expectedSection != bank.sectionCount) {
        return false;
    }
    for (int section = 0; section < bank.sectionCount; ++section) {
        if (!bank.sections[section].configured
            || !IsValidTpt(bank.sections[section].target)) {
            return false;
        }
    }
    return IsFinite(bank.outputGainTargetDb)
        && std::fabs(bank.outputGainTargetDb) <= kMaximumOutputGainDb;
}

bool FinalizeSemanticConfiguration(Bank& bank)
{
    if (!bank.semanticConfiguration || !bank.building) {
        return !bank.semanticConfiguration;
    }
    int firstSection = 0;
    for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
        Band& band = bank.bands[bandIndex];
        if (!band.semanticConfigured) {
            return false;
        }
        const int sectionCount = SectionCountForBand(
            band.type, band.slopeDbPerOctave);
        if (sectionCount < 1 || sectionCount > kMaximumSectionsPerBand
            || firstSection + sectionCount > kMaximumSections) {
            return false;
        }
        band.firstSection = firstSection;
        band.sectionCount = sectionCount;
        band.configured = true;
        TptValues designed[kMaximumSectionsPerBand] {};
        if (!DesignBandAt(
                band,
                band.targetLog2Frequency,
                band.targetGainDb,
                band.targetLogQ,
                designed)) {
            return false;
        }
        for (int offset = 0; offset < sectionCount; ++offset) {
            TptSection& section = bank.sections[firstSection + offset];
            section.current = designed[offset];
            section.target = designed[offset];
            section.finalTarget = designed[offset];
            section.step = {};
            UpdateSectionCache(section);
            section.configured = true;
        }
        band.log2Frequency = band.targetLog2Frequency;
        band.logQ = band.targetLogQ;
        band.gainDb = band.targetGainDb;
        band.semanticActive = false;
        band.finishAfterSlice = false;
        band.exactIdentity = IsGainBandType(band.type) && band.gainDb == 0.0;
        firstSection += sectionCount;
    }
    bank.sectionCount = firstSection;
    return (bank.bandCount == 0) == (bank.sectionCount == 0);
}

double RaisedCosine(double progress)
{
    if (progress <= 0.0) {
        return 0.0;
    }
    if (progress >= 1.0) {
        return 1.0;
    }
    return 0.5 - 0.5 * std::cos(kPi * progress);
}

bool SemanticValueAtTarget(double current, double target)
{
    return current == target
        || std::fabs(current - target) <= kSemanticSnapThreshold;
}

bool PrepareSemanticSlice(Bank& bank)
{
    const double retention = gDesignIntervalRetention;
    bool anyActive = false;
    for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
        Band& band = bank.bands[bandIndex];
        if (!band.semanticActive) {
            continue;
        }
        anyActive = true;
        const bool finishing = SemanticValueAtTarget(
                band.log2Frequency, band.targetLog2Frequency)
            && SemanticValueAtTarget(band.logQ, band.targetLogQ)
            && SemanticValueAtTarget(band.gainDb, band.targetGainDb);
        band.finishAfterSlice = finishing;
        const double nextFrequency = finishing
            ? band.targetLog2Frequency
            : band.targetLog2Frequency
                + (band.log2Frequency - band.targetLog2Frequency) * retention;
        const double nextQ = finishing
            ? band.targetLogQ
            : band.targetLogQ + (band.logQ - band.targetLogQ) * retention;
        const double nextGain = finishing
            ? band.targetGainDb
            : band.targetGainDb + (band.gainDb - band.targetGainDb) * retention;
        TptValues designed[kMaximumSectionsPerBand] {};
        if (!DesignBandAt(band, nextFrequency, nextGain, nextQ, designed)) {
            return false;
        }
        for (int offset = 0; offset < band.sectionCount; ++offset) {
            TptSection& section = bank.sections[band.firstSection + offset];
            section.target = finishing ? section.finalTarget : designed[offset];
            section.step = DifferencePerFrame(
                section.target, section.current, kDesignIntervalFrames);
        }
    }
    bank.semanticSliceRemainingFrames = anyActive
        ? kDesignIntervalFrames
        : 0;
    return true;
}

void FinishSemanticSlice(Bank& bank)
{
    bool anyActive = false;
    for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
        Band& band = bank.bands[bandIndex];
        if (!band.semanticActive) {
            continue;
        }
        for (int offset = 0; offset < band.sectionCount; ++offset) {
            TptSection& section = bank.sections[band.firstSection + offset];
            section.current = section.target;
            section.step = {};
            UpdateSectionCache(section);
        }
        if (band.finishAfterSlice) {
            band.log2Frequency = band.targetLog2Frequency;
            band.logQ = band.targetLogQ;
            band.gainDb = band.targetGainDb;
            band.semanticActive = false;
            band.finishAfterSlice = false;
            band.exactIdentity = IsGainBandType(band.type)
                && band.gainDb == 0.0;
        }
        anyActive = anyActive || band.semanticActive;
    }
    bank.semanticBandsActive = anyActive;
}

bool AdvanceBank(Bank& bank)
{
    if (bank.semanticConfiguration) {
        if (bank.semanticBandsActive
            && bank.semanticSliceRemainingFrames == 0
            && !PrepareSemanticSlice(bank)) {
            return false;
        }
        if (bank.semanticSliceRemainingFrames > 0) {
            for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
                Band& band = bank.bands[bandIndex];
                if (!band.semanticActive) {
                    continue;
                }
                band.log2Frequency = band.targetLog2Frequency
                    + (band.log2Frequency - band.targetLog2Frequency)
                        * gSmoothingRetention;
                band.logQ = band.targetLogQ
                    + (band.logQ - band.targetLogQ) * gSmoothingRetention;
                band.gainDb = band.targetGainDb
                    + (band.gainDb - band.targetGainDb) * gSmoothingRetention;
                for (int offset = 0; offset < band.sectionCount; ++offset) {
                    TptSection& section = bank.sections[band.firstSection + offset];
                    section.current = Add(section.current, section.step);
                    UpdateSectionCache(section);
                }
            }
            --bank.semanticSliceRemainingFrames;
            if (bank.semanticSliceRemainingFrames == 0) {
                FinishSemanticSlice(bank);
            }
        }
        if (bank.outputSemanticActive) {
            bank.outputGainDb = bank.outputGainTargetDb
                + (bank.outputGainDb - bank.outputGainTargetDb)
                    * gSmoothingRetention;
            if (SemanticValueAtTarget(
                    bank.outputGainDb, bank.outputGainTargetDb)) {
                bank.outputGainDb = bank.outputGainTargetDb;
                bank.outputSemanticActive = false;
            }
            UpdateOutputGainCache(bank);
        }
    } else if (bank.smoothRemainingFrames > 0) {
        for (int section = 0; section < bank.sectionCount; ++section) {
            bank.sections[section].current = Add(
                bank.sections[section].current,
                bank.sections[section].step);
            UpdateSectionCache(bank.sections[section]);
        }
        bank.outputGainDb += bank.outputGainStepDb;
        UpdateOutputGainCache(bank);
        --bank.smoothRemainingFrames;
        if (bank.smoothRemainingFrames == 0) {
            FinishCoefficientSmoothing(bank);
        }
    }
    for (int band = 0; band < bank.bandCount; ++band) {
        Band& value = bank.bands[band];
        if (value.wetRemainingFrames <= 0) {
            continue;
        }
        const int completed = value.wetTotalFrames
            - value.wetRemainingFrames + 1;
        const double mix = RaisedCosine(
            static_cast<double>(completed)
            / static_cast<double>(value.wetTotalFrames));
        value.wet = value.wetStart
            + (value.wetTarget - value.wetStart) * mix;
        --value.wetRemainingFrames;
        if (value.wetRemainingFrames == 0) {
            value.wet = value.wetTarget;
            value.wetStart = value.wetTarget;
            value.wetTotalFrames = 0;
        }
    }
    return true;
}

double ProcessSection(TptSection& section, double input, int channel)
{
    const TptValues& values = section.current;
    double& state1 = section.state[channel][0];
    double& state2 = section.state[channel][1];
    const double high = (input - (values.g + values.k) * state1 - state2)
        * section.inverseDenominator;
    const double band = state1 + values.g * high;
    const double low = state2 + values.g * band;
    state1 = 2.0 * band - state1;
    state2 = 2.0 * low - state2;
    return values.m0 * high + values.m1 * band + values.m2 * low;
}

double ProcessBank(Bank& bank, double input, int channel)
{
    double output = input;
    for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
        const Band& band = bank.bands[bandIndex];
        const double dry = output;
        for (int offset = 0; offset < band.sectionCount; ++offset) {
            output = ProcessSection(
                bank.sections[band.firstSection + offset], output, channel);
        }
        output = band.exactIdentity
            ? dry
            : dry + (output - dry) * band.wet;
    }
    return output * bank.outputGain;
}

void FlushBankStates(Bank& bank)
{
    for (int section = 0; section < bank.sectionCount; ++section) {
        for (int channel = 0; channel < gChannels; ++channel) {
            for (int state = 0; state < 2; ++state) {
                double& value = bank.sections[section].state[channel][state];
                if (std::fabs(value) < kStateFlushThreshold) {
                    value = 0.0;
                }
            }
        }
    }
}

ComplexValue Multiply(ComplexValue first, ComplexValue second)
{
    return {
        first.real * second.real - first.imaginary * second.imaginary,
        first.real * second.imaginary + first.imaginary * second.real
    };
}

ComplexValue Divide(ComplexValue numerator, ComplexValue denominator)
{
    const double scale = denominator.real * denominator.real
        + denominator.imaginary * denominator.imaginary;
    if (!(scale > 0.0) || !IsFinite(scale)) {
        return { 0.0, 0.0 };
    }
    return {
        (numerator.real * denominator.real
            + numerator.imaginary * denominator.imaginary) / scale,
        (numerator.imaginary * denominator.real
            - numerator.real * denominator.imaginary) / scale
    };
}

ComplexValue SectionResponse(const TptValues& values, double omega)
{
    /* Evaluate the normalized trapezoidal-SVF transfer directly.  This avoids
       reconstructing cancellation-prone direct-form endpoint sums. */
    const double x = std::tan(0.5 * omega) / values.g;
    if (std::fabs(x) <= 1.0) {
        const double square = x * x;
        return Divide(
            { values.m2 - values.m0 * square, values.m1 * x },
            { 1.0 - square, values.k * x });
    }
    const double inverse = 1.0 / x;
    const double square = inverse * inverse;
    return Divide(
        { -values.m0 + values.m2 * square, values.m1 * inverse },
        { -1.0 + square, values.k * inverse });
}

ComplexValue BankResponse(const Bank& bank, double frequencyHz)
{
    const double omega = 2.0 * kPi * frequencyHz
        / static_cast<double>(gSampleRate);
    ComplexValue response { 1.0, 0.0 };
    for (int bandIndex = 0; bandIndex < bank.bandCount; ++bandIndex) {
        const Band& band = bank.bands[bandIndex];
        if (band.exactIdentity) {
            continue;
        }
        ComplexValue bandResponse { 1.0, 0.0 };
        for (int offset = 0; offset < band.sectionCount; ++offset) {
            bandResponse = Multiply(
                bandResponse,
                SectionResponse(
                    bank.sections[band.firstSection + offset].current,
                    omega));
        }
        bandResponse.real = 1.0 + band.wet * (bandResponse.real - 1.0);
        bandResponse.imaginary *= band.wet;
        response = Multiply(response, bandResponse);
    }
    const double gain = std::exp(kDecibelsToNaturalLog * bank.outputGainDb);
    response.real *= gain;
    response.imaginary *= gain;
    return response;
}

int StagingBankIndex()
{
    return 1 - gActiveBank;
}
} // namespace

extern "C" {
int peq_abi_version()
{
    return kAbiVersion;
}

int peq_maximum_block_size()
{
    return kMaximumBlockSize;
}

int peq_maximum_channels()
{
    return kMaximumChannels;
}

int peq_maximum_bands()
{
    return kMaximumBands;
}

int peq_maximum_sections()
{
    return kMaximumSections;
}

int peq_linear_memory_bytes()
{
    return kLinearMemoryBytes;
}

int peq_initialize(int sampleRate, int channels)
{
    if (sampleRate < 8000 || sampleRate > 768000
        || channels < 1 || channels > kMaximumChannels) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    gSampleRate = sampleRate;
    gChannels = channels;
    gActiveBank = 0;
    gTransitionTargetBank = -1;
    gTransitionTotalFrames = 0;
    gTransitionRemainingFrames = 0;
    gFramesUntilStateFlush = 128;
    gSmoothingRetention = std::exp(
        -1.0 / (kSmoothingTimeSeconds * static_cast<double>(sampleRate)));
    gDesignIntervalRetention = std::exp(
        -static_cast<double>(kDesignIntervalFrames)
        / (kSmoothingTimeSeconds * static_cast<double>(sampleRate)));
    for (int bankIndex = 0; bankIndex < 2; ++bankIndex) {
        Bank& bank = gBanks[bankIndex];
        bank.bandCount = 0;
        bank.sectionCount = 0;
        bank.outputGainDb = 0.0;
        bank.outputGainTargetDb = 0.0;
        bank.outputGainStepDb = 0.0;
        bank.outputGain = 1.0;
        bank.smoothTotalFrames = 0;
        bank.smoothRemainingFrames = 0;
        bank.semanticSliceRemainingFrames = 0;
        bank.semanticBandsActive = false;
        bank.outputSemanticActive = false;
        bank.semanticConfiguration = false;
        bank.building = false;
        bank.valid = false;
        ResetBankState(bank);
    }
    ClearAudioOutput(kMaximumBlockSize);
    return PEQ_OK;
}

int peq_channel_count()
{
    return gChannels;
}

int peq_sample_rate()
{
    return gSampleRate;
}

float* peq_input_pointer(int channel)
{
    return channel >= 0 && channel < kMaximumChannels
        ? gInput[channel]
        : nullptr;
}

float* peq_output_pointer(int channel)
{
    return channel >= 0 && channel < kMaximumChannels
        ? gOutput[channel]
        : nullptr;
}

int peq_begin_configuration(
    int bandCount,
    int sectionCount,
    double outputGainDb)
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (gTransitionTargetBank >= 0) {
        return PEQ_ERROR_BUSY;
    }
    if (bandCount < 0 || bandCount > kMaximumBands
        || sectionCount < 0 || sectionCount > kMaximumSections
        || (bandCount == 0) != (sectionCount == 0)
        || !IsFinite(outputGainDb)
        || std::fabs(outputGainDb) > kMaximumOutputGainDb) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    Bank& bank = gBanks[StagingBankIndex()];
    bank.bandCount = bandCount;
    bank.sectionCount = sectionCount;
    bank.outputGainDb = outputGainDb;
    bank.outputGainTargetDb = outputGainDb;
    bank.outputGainStepDb = 0.0;
    UpdateOutputGainCache(bank);
    bank.smoothTotalFrames = 0;
    bank.smoothRemainingFrames = 0;
    bank.semanticSliceRemainingFrames = 0;
    bank.semanticBandsActive = false;
    bank.outputSemanticActive = false;
    bank.semanticConfiguration = false;
    bank.building = true;
    bank.valid = false;
    for (int band = 0; band < kMaximumBands; ++band) {
        bank.bands[band].configured = false;
    }
    for (int section = 0; section < kMaximumSections; ++section) {
        bank.sections[section].configured = false;
    }
    return PEQ_OK;
}

int peq_set_band(
    int bandIndex,
    int firstSection,
    int sectionCount,
    double wet)
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (gTransitionTargetBank >= 0) {
        return PEQ_ERROR_BUSY;
    }
    Bank& bank = gBanks[StagingBankIndex()];
    if (!bank.building || bandIndex < 0 || bandIndex >= bank.bandCount
        || firstSection < 0 || sectionCount < 1
        || sectionCount > kMaximumSectionsPerBand
        || firstSection + sectionCount > bank.sectionCount
        || !IsFinite(wet) || wet < 0.0 || wet > 1.0) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    Band& band = bank.bands[bandIndex];
    band.firstSection = firstSection;
    band.sectionCount = sectionCount;
    band.wet = wet;
    band.wetStart = wet;
    band.wetTarget = wet;
    band.wetTotalFrames = 0;
    band.wetRemainingFrames = 0;
    band.semanticConfigured = false;
    band.semanticActive = false;
    band.finishAfterSlice = false;
    band.exactIdentity = false;
    band.configured = true;
    return PEQ_OK;
}

int peq_set_section(
    int sectionIndex,
    double g,
    double k,
    double m0,
    double m1,
    double m2)
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (gTransitionTargetBank >= 0) {
        return PEQ_ERROR_BUSY;
    }
    Bank& bank = gBanks[StagingBankIndex()];
    const TptValues values { g, k, m0, m1, m2 };
    if (!bank.building || sectionIndex < 0
        || sectionIndex >= bank.sectionCount || !IsValidTpt(values)) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    TptSection& section = bank.sections[sectionIndex];
    section.current = values;
    section.target = values;
    section.finalTarget = values;
    section.step = {};
    UpdateSectionCache(section);
    section.configured = true;
    return PEQ_OK;
}

int peq_begin_semantic_configuration(int bandCount, double outputGainDb)
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (gTransitionTargetBank >= 0) {
        return PEQ_ERROR_BUSY;
    }
    if (bandCount < 0 || bandCount > kMaximumBands
        || !IsFinite(outputGainDb)
        || std::fabs(outputGainDb) > kMaximumOutputGainDb) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    Bank& bank = gBanks[StagingBankIndex()];
    bank.bandCount = bandCount;
    bank.sectionCount = 0;
    bank.outputGainDb = outputGainDb;
    bank.outputGainTargetDb = outputGainDb;
    bank.outputGainStepDb = 0.0;
    UpdateOutputGainCache(bank);
    bank.smoothTotalFrames = 0;
    bank.smoothRemainingFrames = 0;
    bank.semanticSliceRemainingFrames = 0;
    bank.semanticBandsActive = false;
    bank.outputSemanticActive = false;
    bank.semanticConfiguration = true;
    bank.building = true;
    bank.valid = false;
    for (int band = 0; band < kMaximumBands; ++band) {
        bank.bands[band].configured = false;
        bank.bands[band].semanticConfigured = false;
        bank.bands[band].semanticActive = false;
        bank.bands[band].finishAfterSlice = false;
    }
    for (int section = 0; section < kMaximumSections; ++section) {
        bank.sections[section].configured = false;
    }
    return PEQ_OK;
}

int peq_set_semantic_band(
    int bandIndex,
    int type,
    int slopeDbPerOctave,
    double frequencyHz,
    double gainDb,
    double q,
    double wet)
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (gTransitionTargetBank >= 0) {
        return PEQ_ERROR_BUSY;
    }
    Bank& bank = gBanks[StagingBankIndex()];
    if (!bank.building || !bank.semanticConfiguration
        || bandIndex < 0 || bandIndex >= bank.bandCount
        || !IsValidBandType(type)
        || (slopeDbPerOctave != 12 && slopeDbPerOctave != 24
            && slopeDbPerOctave != 36 && slopeDbPerOctave != 48)
        || !IsFinite(frequencyHz) || frequencyHz < 10.0 || frequencyHz > 24000.0
        || !IsFinite(gainDb) || gainDb < -24.0 || gainDb > 24.0
        || !IsFinite(q) || q < 0.1 || q > 30.0
        || !IsFinite(wet) || wet < 0.0 || wet > 1.0) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    Band& band = bank.bands[bandIndex];
    band.type = type;
    band.slopeDbPerOctave = slopeDbPerOctave;
    band.targetLog2Frequency = std::log2(frequencyHz);
    band.targetLogQ = std::log(q);
    band.targetGainDb = gainDb;
    band.wet = wet;
    band.wetStart = wet;
    band.wetTarget = wet;
    band.wetTotalFrames = 0;
    band.wetRemainingFrames = 0;
    band.semanticConfigured = true;
    band.configured = false;
    return PEQ_OK;
}

int peq_commit_configuration(int mode, int transitionFrames)
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (gTransitionTargetBank >= 0) {
        return PEQ_ERROR_BUSY;
    }
    if (mode < PEQ_COMMIT_IMMEDIATE || mode > PEQ_COMMIT_CROSSFADE
        || transitionFrames < 0
        || transitionFrames > kMaximumTransitionFrames) {
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    const int stagingIndex = StagingBankIndex();
    Bank& staging = gBanks[stagingIndex];
    if (!FinalizeSemanticConfiguration(staging)
        || !IsCompleteConfiguration(staging)) {
        return PEQ_ERROR_INVALID_CONFIGURATION;
    }
    staging.building = false;
    staging.valid = true;
    if (mode == PEQ_COMMIT_IMMEDIATE
        || transitionFrames == 0
        || !gBanks[gActiveBank].valid) {
        CancelBankSmoothing(staging);
        ResetBankState(staging);
        gActiveBank = stagingIndex;
        return PEQ_OK;
    }
    Bank& active = gBanks[gActiveBank];
    if (mode == PEQ_COMMIT_SMOOTH) {
        if (!HasSameTopology(active, staging)) {
            staging.building = true;
            return PEQ_ERROR_INVALID_CONFIGURATION;
        }
        const int bypassFrames = (gSampleRate + 50) / 100;
        if (active.semanticConfiguration) {
            active.smoothTotalFrames = 0;
            active.smoothRemainingFrames = 0;
            active.semanticSliceRemainingFrames = 0;
            active.semanticBandsActive = false;
            active.outputGainTargetDb = staging.outputGainTargetDb;
            active.outputGainStepDb = 0.0;
            active.outputSemanticActive = active.outputGainDb
                != active.outputGainTargetDb;
            for (int band = 0; band < active.bandCount; ++band) {
                Band& activeBand = active.bands[band];
                const Band& stagingBand = staging.bands[band];
                activeBand.targetLog2Frequency = stagingBand.targetLog2Frequency;
                activeBand.targetLogQ = stagingBand.targetLogQ;
                activeBand.targetGainDb = stagingBand.targetGainDb;
                activeBand.semanticActive = activeBand.log2Frequency
                        != activeBand.targetLog2Frequency
                    || activeBand.logQ != activeBand.targetLogQ
                    || activeBand.gainDb != activeBand.targetGainDb;
                activeBand.finishAfterSlice = false;
                activeBand.exactIdentity = !activeBand.semanticActive
                    && IsGainBandType(activeBand.type)
                    && activeBand.gainDb == 0.0;
                active.semanticBandsActive = active.semanticBandsActive
                    || activeBand.semanticActive;
                const double wetTarget = stagingBand.wetTarget;
                if (activeBand.wetTarget != wetTarget) {
                    activeBand.wetStart = activeBand.wet;
                    activeBand.wetTarget = wetTarget;
                    activeBand.wetTotalFrames = bypassFrames;
                    activeBand.wetRemainingFrames = bypassFrames;
                }
                for (int offset = 0; offset < activeBand.sectionCount; ++offset) {
                    TptSection& activeSection = active.sections[
                        activeBand.firstSection + offset];
                    const TptSection& stagingSection = staging.sections[
                        stagingBand.firstSection + offset];
                    activeSection.target = activeSection.current;
                    activeSection.finalTarget = stagingSection.finalTarget;
                    activeSection.step = {};
                }
            }
            return PEQ_OK;
        }
        const int defaultParameterFrames = (gSampleRate + 100) / 200;
        const int parameterFrames = transitionFrames < defaultParameterFrames
            ? transitionFrames
            : defaultParameterFrames;
        active.smoothTotalFrames = parameterFrames;
        active.smoothRemainingFrames = parameterFrames;
        active.outputGainTargetDb = staging.outputGainTargetDb;
        active.outputGainStepDb = (active.outputGainTargetDb - active.outputGainDb)
            / static_cast<double>(parameterFrames);
        for (int band = 0; band < active.bandCount; ++band) {
            Band& activeBand = active.bands[band];
            const double wetTarget = staging.bands[band].wetTarget;
            if (activeBand.wetTarget != wetTarget) {
                activeBand.wetStart = activeBand.wet;
                activeBand.wetTarget = wetTarget;
                activeBand.wetTotalFrames = bypassFrames;
                activeBand.wetRemainingFrames = bypassFrames;
            }
        }
        for (int section = 0; section < active.sectionCount; ++section) {
            active.sections[section].target = staging.sections[section].target;
            active.sections[section].finalTarget = staging.sections[section].target;
            active.sections[section].step = DifferencePerFrame(
                active.sections[section].target,
                active.sections[section].current,
                parameterFrames);
        }
        return PEQ_OK;
    }
    CancelBankSmoothing(staging);
    ResetBankState(staging);
    gTransitionTargetBank = stagingIndex;
    gTransitionTotalFrames = transitionFrames;
    gTransitionRemainingFrames = transitionFrames;
    return PEQ_OK;
}

int peq_is_transitioning()
{
    return gTransitionTargetBank >= 0 ? 1 : 0;
}

int peq_process(int frames)
{
    if (gChannels == 0) {
        ClearAudioOutput(frames);
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    if (!gBanks[gActiveBank].valid) {
        ClearAudioOutput(frames);
        return PEQ_ERROR_NO_ACTIVE_CONFIGURATION;
    }
    if (frames <= 0 || frames > kMaximumBlockSize) {
        ClearAudioOutput(frames);
        return PEQ_ERROR_INVALID_ARGUMENT;
    }
    for (int channel = 0; channel < gChannels; ++channel) {
        for (int frame = 0; frame < frames; ++frame) {
            if (!std::isfinite(gInput[channel][frame])) {
                ClearAudioOutput(frames);
                ResetBankState(gBanks[gActiveBank]);
                if (gTransitionTargetBank >= 0) {
                    ResetBankState(gBanks[gTransitionTargetBank]);
                }
                return PEQ_ERROR_NONFINITE_AUDIO;
            }
        }
    }
    for (int frame = 0; frame < frames; ++frame) {
        Bank& active = gBanks[gActiveBank];
        if (!AdvanceBank(active)) {
            ClearAudioOutput(frames);
            ResetBankState(active);
            if (gTransitionTargetBank >= 0) {
                ResetBankState(gBanks[gTransitionTargetBank]);
            }
            return PEQ_ERROR_INVALID_CONFIGURATION;
        }
        const bool transitioning = gTransitionTargetBank >= 0;
        Bank* target = transitioning ? &gBanks[gTransitionTargetBank] : nullptr;
        const double crossfade = transitioning
            ? RaisedCosine(static_cast<double>(
                gTransitionTotalFrames - gTransitionRemainingFrames + 1)
                / static_cast<double>(gTransitionTotalFrames))
            : 0.0;
        for (int channel = 0; channel < gChannels; ++channel) {
            const double input = static_cast<double>(gInput[channel][frame]);
            const double activeOutput = ProcessBank(active, input, channel);
            const double output = target
                ? activeOutput
                    + (ProcessBank(*target, input, channel) - activeOutput)
                        * crossfade
                : activeOutput;
            if (!IsFinite(output)) {
                ClearAudioOutput(frames);
                ResetBankState(active);
                if (target) {
                    ResetBankState(*target);
                }
                return PEQ_ERROR_NONFINITE_AUDIO;
            }
            gOutput[channel][frame] = static_cast<float>(output);
        }
        if (transitioning) {
            --gTransitionRemainingFrames;
            if (gTransitionRemainingFrames == 0) {
                gActiveBank = gTransitionTargetBank;
                gTransitionTargetBank = -1;
                gTransitionTotalFrames = 0;
            }
        }
        --gFramesUntilStateFlush;
        if (gFramesUntilStateFlush == 0) {
            FlushBankStates(gBanks[gActiveBank]);
            if (gTransitionTargetBank >= 0) {
                FlushBankStates(gBanks[gTransitionTargetBank]);
            }
            gFramesUntilStateFlush = 128;
        }
    }
    return frames;
}

int peq_reset()
{
    if (gChannels == 0) {
        return PEQ_ERROR_NOT_INITIALIZED;
    }
    ResetBankState(gBanks[gActiveBank]);
    if (gTransitionTargetBank >= 0) {
        ResetBankState(gBanks[gTransitionTargetBank]);
        gTransitionTargetBank = -1;
        gTransitionTotalFrames = 0;
        gTransitionRemainingFrames = 0;
    }
    gFramesUntilStateFlush = 128;
    return PEQ_OK;
}

double peq_response_db(int configuration, double frequencyHz)
{
    if (gChannels == 0 || !IsFinite(frequencyHz)
        || frequencyHz < 0.0
        || frequencyHz > static_cast<double>(gSampleRate) * 0.5
        || (configuration != PEQ_CONFIGURATION_ACTIVE
            && configuration != PEQ_CONFIGURATION_STAGING)) {
        return std::nan("");
    }
    const Bank& bank = configuration == PEQ_CONFIGURATION_ACTIVE
        ? gBanks[gActiveBank]
        : gBanks[StagingBankIndex()];
    if ((configuration == PEQ_CONFIGURATION_ACTIVE && !bank.valid)
        || (configuration == PEQ_CONFIGURATION_STAGING
            && !IsCompleteConfiguration(bank))) {
        return std::nan("");
    }
    const ComplexValue response = BankResponse(bank, frequencyHz);
    const double magnitudeSquared = response.real * response.real
        + response.imaginary * response.imaginary;
    return 10.0 * std::log10(
        magnitudeSquared > kMinimumResponseMagnitudeSquared
            ? magnitudeSquared
            : kMinimumResponseMagnitudeSquared);
}
} // extern "C"
