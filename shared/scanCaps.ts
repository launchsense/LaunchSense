// Guest and signed-in read caps. The download stop stays small because the
// archive is inflated in memory before these caps throw text away.
export const GUEST_MAX_FILES = 200;
export const GUEST_MAX_BYTES = 2_000_000;
export const SIGNED_MAX_FILES = 1000;
export const SIGNED_MAX_BYTES = 8_000_000;
export const DOWNLOAD_MAX_BYTES = 20_000_000;
