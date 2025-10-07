import { expect } from 'chai';
import { describe, it } from '@jest/globals';
import { FrameRate, ParsedTimeCodeString, parseTimeCodeString, TimeCode } from './timecode';

/**
 * Exhaustive testcases. We'll run through all possible timecodes from 00:00:00:00 to 00:59:59:29 to be sure 
 * frame count calculations are correct.
 */
let EXHAUSTIVE_TESTS = [
    FrameRate.NTSC_23_97_DF,
    FrameRate.NTSC_29_97_DF,
    FrameRate.NTSC_59_94_DF,
    FrameRate.PAL_24,
    FrameRate.PAL_30,
    FrameRate.PAL_60
];

/**
 * Literal testcases with a single timestamp, a framerate and the expected frame count
 */
const CONVERSION_TESTS: [string, FrameRate, number | undefined][] = [

    // Drop frame: Dropped time codes
    ['00:00:59;29', FrameRate.NTSC_29_97_DF, 1799],
    ['00:01:00;02', FrameRate.NTSC_29_97_DF, 1800],
    ['00:01:00;03', FrameRate.NTSC_29_97_DF, 1801],

    ['00:09:59;29', FrameRate.NTSC_29_97_DF, 17981],
    ['00:10:00;00', FrameRate.NTSC_29_97_DF, 17982],
    ['00:10:00;01', FrameRate.NTSC_29_97_DF, 17983],

    ['00:10:59;29', FrameRate.NTSC_29_97_DF, 19781],
    ['00:11:00;02', FrameRate.NTSC_29_97_DF, 19782],
    ['00:11:00;03', FrameRate.NTSC_29_97_DF, 19783],

    // Invalid
    ['00:01:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:02:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:03:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:04:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:05:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:06:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:07:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:08:00;00', FrameRate.NTSC_29_97_DF, undefined],
    ['00:09:00;00', FrameRate.NTSC_29_97_DF, undefined],

    // ---

    // None drop
    ['00:00:00:29', FrameRate.NTSC_29_97_NDF, 29],
    ['00:00:01:00', FrameRate.NTSC_29_97_NDF, 30],
    ['00:00:09:29', FrameRate.NTSC_29_97_NDF, 299],
    ['00:00:10:00', FrameRate.NTSC_29_97_NDF, 300],
    ['00:00:59:29', FrameRate.NTSC_29_97_NDF, 1799],
    ['00:01:00:00', FrameRate.NTSC_29_97_NDF, 1800],
    ['00:09:59:29', FrameRate.NTSC_29_97_NDF, 17999],
    ['00:10:00:00', FrameRate.NTSC_29_97_NDF, 18000],
    ['01:00:00:00', FrameRate.NTSC_29_97_NDF, 108000],
    ['10:00:00:00', FrameRate.NTSC_29_97_NDF, 1080000],

    ['00:00:10;00', FrameRate.NTSC_29_97_DF, 300],
    ['00:01:00;02', FrameRate.NTSC_29_97_DF, 1800],
    ['00:10:00;00', FrameRate.NTSC_29_97_DF, 17982],
    ['01:00:00;00', FrameRate.NTSC_29_97_DF, 107892],
    ['10:00:00;00', FrameRate.NTSC_29_97_DF, 1078920],

    ['00:01:00:00', FrameRate.from(25), 1500],
    ['00:10:00:00', FrameRate.from(25), 15000],
    ['01:00:00:00', FrameRate.from(25), 90000],
    ['10:00:00:00', FrameRate.from(25), 900000],
] as const;

describe('TimeCode', () => {
    for (let testcase of CONVERSION_TESTS) {
        validateCase(...testcase);
    }

    ///////////////////

    for (let frameRate of EXHAUSTIVE_TESTS) {
        it(`Should compute all TCs correctly for ${frameRate}`, () => exhaustivelyValidateDF(frameRate));
    }
});

function exhaustivelyValidateDF(frameRate: FrameRate) {
    let stc: ParsedTimeCodeString = {
        hour: 0, minute: 0, second: 0, frame: 0,
        frameRate
    };

    function zp(number: number) {
        if (number < 10)
            return `0${number}`;
        return `${number}`;
    }

    let frameCount = 0;
    let wholeRate = Math.round(frameRate.rate);
    let droppedPerMinute = frameRate.rate > 30 ? 4 : 2;

    while (true) {
        let tcStr = `${zp(stc.hour)}:${zp(stc.minute)}:${zp(stc.second)}${frameRate.dropFrame ? ';' : ':'}${zp(stc.frame)}`;
        let tc = TimeCode.fromString(tcStr, stc.frameRate);
        try {
            expect(tc.hour).to.equal(stc.hour);
            expect(tc.minute).to.equal(stc.minute);
            expect(tc.second).to.equal(stc.second);
            expect(tc.frame).to.equal(stc.frame);
            expect(tc.frameCount).to.equal(frameCount);
            expect(tc.toString()).to.equal(tcStr);
        } catch (e: any) {
            throw new Error(`Timecode ${tcStr}: ${e.message}`);
        }

        /////////////////////

        frameCount += 1;
        stc.frame += 1;

        if (stc.frame === wholeRate) {
            stc.frame = 0;
            stc.second += 1;
        }

        if (stc.second === 60) {
            stc.second = 0;
            stc.minute += 1;
        }

        if (stc.minute === 60) {
            stc.minute = 0;
            stc.hour += 1;
        }

        if (frameRate.dropFrame) {
            let startOfMinute = stc.second === 0 && stc.frame === 0;
            if (startOfMinute && stc.minute % 10 !== 0) {
                stc.frame = droppedPerMinute;
            }
        }

        if (stc.hour === 1)
            break;
    }
}

function validateCase(str: string, fr: FrameRate, fc: number | undefined) {
    it(`frame-count should be ${fc === undefined ? '<invalid>' : fc} for ${str} in ${fr}`, () => {
        if (fc === undefined) {
            expect(() => TimeCode.fromString(str, fr)).to.throw();
            return;
        }

        let tc = TimeCode.fromString(str, fr);
        let stc = parseTimeCodeString(str);

        expect(tc.hour).to.equal(stc.hour);
        expect(tc.minute).to.equal(stc.minute);
        expect(tc.second).to.equal(stc.second);
        expect(tc.frame).to.equal(stc.frame);
        expect(tc.frameCount).to.equal(fc);
        expect(tc.toString()).to.equal(str);
    });
}