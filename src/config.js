// @ts-check

/**
 * Layout widths of the metadata header. Fixed at 3/3/2 so the wire format
 * stays stable across configs; only `sessionLength` and `checksum` are
 * caller-configurable.
 * @internal
 */
const LAYOUT = Object.freeze({
  indexLength: 3,
  totalLength: 3,
  countLength: 2,
});

/**
 * How many base62 characters each checksum algorithm needs.
 * @internal
 * @type {Readonly<Record<"none" | "crc8" | "crc16", number>>}
 */
const CHECKSUM_LENGTHS = Object.freeze({
  none: 0,
  crc8: 2,
  crc16: 3,
});

/**
 * Resolve a possibly-partial config into a frozen, fully-specified one.
 * All layout widths are filled in; derived values (`crcLength`,
 * `metaLength`, `maxIndex`, `maxTotal`, `maxByteCount`) are computed once.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [partial]
 * @returns {import("./types.js").ResolvedConfig}
 * @throws {RangeError} If `sessionLength` or `checksum` are out of range.
 */
export function resolveConfig(partial = {}) {
  const sessionLength = partial.sessionLength ?? 6;
  if (
    !Number.isInteger(sessionLength) ||
    sessionLength < 4 ||
    sessionLength > 8
  ) {
    throw new RangeError(
      `sessionLength must be an integer in [4, 8], got ${sessionLength}`,
    );
  }

  const checksum = partial.checksum ?? "crc16";
  if (checksum !== "none" && checksum !== "crc8" && checksum !== "crc16") {
    throw new RangeError(
      `checksum must be "none", "crc8", or "crc16", got ${JSON.stringify(checksum)}`,
    );
  }

  const crcLength = CHECKSUM_LENGTHS[checksum];

  const metaLength =
    sessionLength +
    LAYOUT.indexLength +
    LAYOUT.totalLength +
    LAYOUT.countLength +
    crcLength;

  return Object.freeze({
    sessionLength,
    checksum,
    crcLength,
    indexLength: LAYOUT.indexLength,
    totalLength: LAYOUT.totalLength,
    countLength: LAYOUT.countLength,
    metaLength,
    maxIndex: 62 ** LAYOUT.indexLength - 1,
    maxTotal: 62 ** LAYOUT.totalLength - 1,
    maxByteCount: 62 ** LAYOUT.countLength - 1,
  });
}

/**
 * Default configuration: 6-char session, CRC16, 17-char header.
 * @public
 */
export const DEFAULT_CONFIG = resolveConfig();