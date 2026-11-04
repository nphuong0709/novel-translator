/**
 * Ngưỡng kiểm tra sau ingest (blueprint mục 6.2). Các kiểm tra theo phạm vi
 * (trùng hash, trung vị ±20, tỷ lệ trích xuất) sẽ thêm ở bước sau.
 */

/** CORE-14: nội dung ngắn hơn ngưỡng này (đếm theo code point) thì FAILED. */
export const MIN_CONTENT_CHARS = 200;
