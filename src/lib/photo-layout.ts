/** Coordinates are normalized to the displayed, EXIF-oriented image, top-left origin. */
export type PhotoTextRegion = { id: string; text: string; box: [number, number, number, number]; translatedText?: string };
export type PhotoLayout = { originalText: string; regions: PhotoTextRegion[]; engine: string };

export function parsePhotoRegions(value: unknown): PhotoTextRegion[] {
  const rows = (value as { regions?: unknown })?.regions;
  if (!Array.isArray(rows) || rows.length > 64) throw new Error("This photo is too dense to overlay safely. Crop it into smaller sections.");
  let length = 0;
  return rows.map((row, index) => {
    if (!row || typeof row.text !== "string" || !row.text.trim() || !Array.isArray(row.box) || row.box.length !== 4 ||
      row.box.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000)) {
      throw new Error("Local OCR could not locate the text reliably. Try a clearer crop.");
    }
    const [left, top, right, bottom] = row.box as number[];
    if (right <= left || bottom <= top) throw new Error("Local OCR returned an invalid text position. Try again with a clearer crop.");
    const text = row.text.trim(); length += text.length;
    if (length > 16_000) throw new Error("This photo contains too much text. Crop it into smaller sections.");
    return { id: String(index), text, box: [left / 1000, top / 1000, right / 1000, bottom / 1000] };
  });
}
