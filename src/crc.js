// @ts-check

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF). Standard for short messages —
 * detects all single/double-bit errors, all odd-bit errors, and bursts up
 * to 16 bits.
 * @internal
 */
const CRC16_TABLE = (() => {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i += 1) {
        let crc = i << 8;
        for (let j = 0; j < 8; j += 1) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
        table[i] = crc & 0xffff;
    }
    return table;
})();

/**
 * CRC-8/MAXIM-DOW table (reflected).
 *
 * Parameters: poly=0x31, init=0x00, refin=true, refout=true, xorout=0x00.
 * The reflected polynomial is 0x8C (0x31 with bits reversed), so the LFSR
 * shifts right and XORs with 0x8C on the low bit. `check` for
 * "123456789" is 0xA1.
 *
 * @internal
 */
const CRC8_TABLE = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
        let crc = i;
        for (let j = 0; j < 8; j += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1;
        }
        table[i] = crc;
    }
    return table;
})();

/**
 * Compute CRC16-CCITT of `bytes`.
 * @internal
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc16(bytes) {
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ bytes[i]) & 0xff]) & 0xffff;
    }
    return crc;
}

/**
 * Compute CRC-8/MAXIM-DOW of `bytes`.
 * @internal
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc8(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = CRC8_TABLE[crc ^ bytes[i]];
    }
    return crc;
}

/**
 * Dispatch by algorithm name.
 * @internal
 * @param {Uint8Array} bytes
 * @param {"crc8" | "crc16"} algorithm
 * @returns {number}
 */
export function computeChecksum(bytes, algorithm) {
    if (algorithm === 'crc16') return crc16(bytes);
    if (algorithm === 'crc8') return crc8(bytes);
    throw new Error(`Unknown checksum algorithm: ${algorithm}`);
}
