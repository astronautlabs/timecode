export interface ParsedTimeCodeString {
    hour: number;
    minute: number;
    second: number;
    frame: number;
    frameRate: FrameRate;
}

/**
 * Parses a simple time code that contains just the elements of the time code present in the string.
 * This is an intermediate format that is used by the TimeCode class to implement proper nuanced parsing 
 * of timecode strings.
 * @param timecode 
 * @returns 
 */
export function parseTimeCodeString(timecode: string): ParsedTimeCodeString {
    let match = timecode.match(/^(\d+)([:;])(\d\d)([:;])(\d\d)([:;])(\d\d)(@(\d+(\.\d+)?))?$/);
    if (!match)
        throw new Error(`Invalid SMPTE timecode '${timecode}'`);

    let [_, sHour, sHourSep, sMinute, sMinSep, sSecond, sSecSep, sFrame, __, rate, ___] = match;
    let hour = Number(sHour), minute = Number(sMinute), second = Number(sSecond), frame = Number(sFrame);
    let dropFrame = false;

    if (sSecSep === ';') {
        dropFrame = true;
        if (!['::', ';;'].includes(`${sHourSep}${sMinSep}`)) {
            throw new Error(`Invalid SMPTE timecode '${timecode}': Ambiguous drop-frame format. For drop-frame timecodes, you can use HH:MM:SS;FF or HH;MM;SS;FF.`);
        }
    }
    
    const wellKnownFrameRates: Record<string, [number, number]> = {
        '29.97': [30000.0, 1001.0]
    };

    return { 
        hour, minute, second, frame, 
        frameRate: rate 
            ? new FrameRate(...(wellKnownFrameRates[rate] ?? [Number(rate), 1]), dropFrame) 
            : FrameRate.invalid(dropFrame) 
    };
}

/**
 * Represents an *exact* frame rate by capturing its numerator and denominator and whether the frame rate is counted
 * in drop-frame or not. 
 */
export class FrameRate {
    constructor(
        readonly numerator: number | undefined, 
        readonly denominator: number | undefined, 
        readonly dropFrame = false
    ) {
    }

    /**
     * True if the other frame rate is the same *rate* (ignoring drop-frame).
     * @param other The other frame rate to compare
     */
    isSameRate(other: FrameRate) {
        if (!other)
            return false;

        if (!other.isValid || !this.isValid)
            return false;

        return this.rate === other.rate;
    }

    /**
     * True if the other frame rate object represents the same value.
     * @param other The other frame rate to compare
     */
    isEqual(other: FrameRate) {
        if (!other)
            return false;

        if (other.dropFrame !== this.dropFrame)
            return false;

        if (other.isValid !== this.isValid)
            return false;

        if (!this.isValid)
            return false;

        return other.rate === this.rate;
    }

    /**
     * True if the frame rate is valid (that is, the frame rate is known).
     */
    get isValid() {
        return this.numerator !== undefined && this.denominator !== undefined;
    }

    /**
     * Get the actual decimal rate of this frame rate by dividing the numerator and denominator.
     * @throws If this object is not valid (see isValid())
     */
    get rate() { 
        if (!this.isValid)
            throw new Error(`Cannot get the rate of an invalid frame rate. Please check isValid() first`);
        return this.numerator! / this.denominator!;
    }

    static NTSC_23_97_DF = new FrameRate(24.0, 1.001, true);
    static NTSC_23_97_NDF = new FrameRate(24.0, 1.001, false);
    static NTSC_29_97_DF = new FrameRate(30.0, 1.001, true);
    static NTSC_29_97_NDF = new FrameRate(30.0, 1.001, false);
    static NTSC_59_94_DF = new FrameRate(60.0, 1.001, true);
    static NTSC_59_94_NDF = new FrameRate(60.0, 1.001, false);
    static PAL_60 = new FrameRate(60.0, 1, false);
    static PAL_30 = new FrameRate(30.0, 1, false);
    static PAL_24 = new FrameRate(24.0, 1, false);

    /**
     * Get an "invalid" frame rate.
     * @param dropFrame 
     * @returns 
     */
    static invalid(dropFrame: boolean) {
        return new FrameRate(undefined, undefined, dropFrame);
    }

    /**
     * Gets a frame rate object for the given simple FPS
     * @param rate The rate which will be used as the numerator (denominator will be 1)
     * @param dropFrame Whether the frame rate uses drop-frame counting.
     * @returns 
     */
    static from(rate: number, dropFrame = false) {
        return new FrameRate(rate, 1, dropFrame);
    }

    toString() {
        let dfIndicator = '';

        if (this.denominator !== 1 || this.dropFrame)
            dfIndicator = ` ${this.dropFrame ? 'DF' : 'NDF'}`;
        
        if (!this.isValid) {
            return `[Invalid]${dfIndicator}`;
        }

        const simpleFps = Math.round(this.rate*100)/100;
        return `${simpleFps === this.rate ? this.rate : `≈${simpleFps}`}fps${dfIndicator} [${this.numerator}/${this.denominator}]`;
    }
}

/**
 * Represents a fully parsed SMPTE timecode which can be manipulated or converted between various formats.
 */
export class TimeCode {
    constructor(
        /**
         * Hour for this timecode. Not limited to 24 hours.
         */
        readonly hour: number,

        /**
         * Minute for this timecode. 0-59
         */
        readonly minute: number,

        /**
         * Second for this timecode. 0-59
         */
        readonly second: number,

        /**
         * Frame for this timecode. Maximum value depends on frame rate.
         */
        readonly frame: number,

        /**
         * Frame rate for this timecode. 
         */
        readonly frameRate: FrameRate
    ) {
        this.frameCount = TimeCode.tcToFrames({ hour, minute, second, frame, frameRate });
    }

    /**
     * Number of frames represented by this timecode (combining the hour, minute, second and frame numbers according 
     * to the frame rate).
     */
    readonly frameCount: number;

    /**
     * Returns true if this time code is in drop-frame (same as frameRate.dropFrame).
     */
    get dropFrame() { return this.frameRate.dropFrame; }

    /**
     * Parse the given string into a TimeCode object. 
     * @param value 
     * @param frameRate The assumed frame rate. If omitted, the timestamp must provide its own (via the '@' suffix).
     *                  If omitted and the time code does not specify a rate, 
     * @returns 
     */
    static fromString(value: string, frameRate?: FrameRate): TimeCode {
        if (typeof value !== "string")
            throw new Error(`Invalid input`);

        if (frameRate?.isValid === false)
            throw new Error(`Invalid frame rate (only pass fully formed frame rates or omit the frame rate to parse it from the time code)`);

        let timecode = parseTimeCodeString(value);
        if (frameRate !== undefined && timecode.frameRate.isValid && !frameRate.isEqual(timecode.frameRate))
            throw new Error(`Timecode specifies frame rate ${timecode.frameRate}, was expecting ${frameRate}`);
        
        frameRate ??= timecode.frameRate;
        timecode.frameRate = frameRate;
        
        return new TimeCode(timecode.hour, timecode.minute, timecode.second, timecode.frame, frameRate);
    }

    static fromFrameCount(value: number, frameRate: FrameRate): TimeCode {
        if (typeof value !== "number")
            throw new Error(`Invalid input`);
        
        return new TimeCode(
            ...this.framesToTC(value, frameRate),
            frameRate
        );
    }

    static coerce(value: string | number | TimeCode, frameRate: FrameRate): TimeCode {
        if (value instanceof TimeCode)
            return value;
        else if (typeof value === 'string')
            return this.fromString(value, frameRate);
        else if (typeof value === 'number')
            return this.fromFrameCount(value, frameRate);
        else
            throw new Error(`Invalid input`);
    }

    private _calculate(direction: -1 | 1, inputs: (string | number | TimeCode)[]) {
        return TimeCode.fromFrameCount(
            inputs
                .map(x => {
                    let timecode = TimeCode.coerce(x, this.frameRate);
                    if (timecode.frameRate != this.frameRate)
                        throw new Error("Timecode framerates must match to do calculations.");
                    return timecode;
                })
                .filter(x => x.frameCount > 0)
                .reduce<number>((pv, cv) => pv + cv.frameCount * direction, this.frameCount),
            this.frameRate
        );
    }

    /**
     * Return a new TimeCode that is the result of adding this TimeCode and the passed arguments.
     * @param args 
     */
    add(...args: (string | number | TimeCode)[]) {
        this._calculate(1, args);
    }

    /**
     * Return a new TimeCode that is the result of adding this TimeCode and the passed arguments.
     * @param args 
     */
    subtract(...args: (string | number | TimeCode)[]) {
        this._calculate(-1, args);
    }

    toString() {
        return `${$00(this.hour)}:${$00(this.minute)}:${$00(this.second)}${this.dropFrame ? ';' : ':'}${$00(this.frame)}`;
    }

    private static tcToFrames(tc: ParsedTimeCodeString) {
        let frameCount = (tc.hour * 3600 + tc.minute * 60 + tc.second) * Math.round(tc.frameRate.rate) + tc.frame;

        // 00:00:01;02

        if (tc.frameRate.dropFrame) {
            let totalMinutes = tc.hour * 60 + tc.minute; // 1
            let droppedPerMinute = tc.frameRate.rate < 30 ? 2 : 4; // 2

            frameCount -= droppedPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));

            let startOfMinute = tc.second === 0 && tc.frame === 0;
            if (startOfMinute && tc.minute % 10 !== 0 && tc.frame < droppedPerMinute) {
                // This is an invalid timestamp
                throw new Error(`Time code ${$00(tc.hour)}:${$00(tc.minute)}:${$00(tc.second)};${$00(tc.frame)} is invalid in ${tc.frameRate}`);
            }
        }

        return frameCount;
    }

    private static framesToTC(frameCount: number, frameRate: FrameRate): [number, number, number, number] {
        // adjust for dropFrame
        if (frameRate.dropFrame) {
            let df = frameRate.rate <= 30 ? 2 : 4; // 59.94 skips 4 frames
            let d = Math.floor(frameCount / (17982 * df / 2));
            let m = frameCount % (17982 * df / 2);
            if (m < df)
                m = m + df;
            frameCount += 9 * df * d + df * Math.floor((m - df) / (1798 * df / 2));
        }

        let fps = frameRate.rate;
        return [
            Math.floor(frameCount / (fps * 3600)) % 24,
            Math.floor(frameCount / (fps * 60)) % 60,
            Math.floor(frameCount / fps) % 60,
            frameCount % fps
        ];
    };
}

function $00(number: number) {
    var pad = (number < 10) ? "0" : "";
    return pad + Math.floor(number);
};