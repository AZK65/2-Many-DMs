import { recognizeLocalPhotoLayout } from "./local-ocr";
import { translatePhotoRegions } from "./photo-region-translation";
import type { PhotoLayout, PhotoTextRegion } from "./photo-layout";

export type PhotoRecord = { id: string; conversationId: string; mediaType: string | null; mediaUrl: string | null;
  deletedAt: Date | null; ocrText: string | null; ocrStatus: string | null; ocrModel: string | null };
export type PhotoTranslationResult = { originalText: string; regions: PhotoTextRegion[]; translatedText?: string; detectedLanguageName?: string; empty?: boolean; layoutApproximate?: boolean };
type Store = {
  find: (conversationId: string, messageId: string) => Promise<PhotoRecord | null>;
  save: (photo: PhotoRecord, text: string, model: string) => Promise<boolean>;
};

/** Workspace-bound DB lookup, no arbitrary image URL or caller-supplied OCR text. */
export function photoTranslationService(store: Store, dependencies = { recognize: recognizeLocalPhotoLayout, translate: translatePhotoRegions }) {
  const jobs = new Map<string, Promise<PhotoTranslationResult>>();
  // Short-lived layout cache is scoped to this workspace's service. Never accept
  // client-supplied boxes/text, or persist extra photo copies in the repository.
  const layouts = new Map<string, { layout: PhotoLayout; expires: number }>();
  return async (conversationId: string, messageId: string, action: "recognize" | "translate"): Promise<PhotoTranslationResult> => {
    const photo = await store.find(conversationId, messageId);
    if (!photo || photo.deletedAt || photo.id !== messageId || photo.conversationId !== conversationId) throw new Error("Photo not found in this chat.");
    if (photo.mediaType !== "image") throw new Error("Choose a photo to translate.");
    if (!photo.mediaUrl?.startsWith("/media/")) throw new Error("Download this photo into the app first using Recover, then choose Translate photo.");
    const photoKey = JSON.stringify([conversationId, messageId, photo.mediaUrl]);
    const key = JSON.stringify([photoKey, action]);
    for (const [id, entry] of layouts) if (entry.expires < Date.now()) layouts.delete(id);
    const existing = jobs.get(key);
    if (existing) return existing;
    if (jobs.size >= 2) throw new Error("Local photo translation is busy. Let the current photos finish, then try again.");
    const work = async (): Promise<PhotoTranslationResult> => {
      if (action === "recognize") {
        // Background indexing is deliberately short. Read again on demand so a
        // cached search snippet is never mistaken for the entire photograph.
        const layout = await dependencies.recognize(photo.mediaUrl!);
        if (!await store.save(photo, layout.originalText, layout.engine)) throw new Error("This photo changed while it was being read. Open it again to retry.");
        if (layouts.size >= 32) layouts.delete(layouts.keys().next().value!);
        layouts.set(photoKey, { layout, expires: Date.now() + 10 * 60_000 });
        return { originalText: layout.originalText, regions: layout.regions, empty: !layout.originalText, layoutApproximate: layout.engine !== "apple-vision" };
      }
      const layout = layouts.get(photoKey)?.layout;
      if (!layout || photo.ocrStatus !== "complete" || photo.ocrText !== layout.originalText) throw new Error("Read the photo text again, then translate it. Its local layout expired or changed.");
      if (photo.ocrText.length > 16_000) throw new Error("This photo contains too much text. Crop it into smaller sections first.");
      const translated = await dependencies.translate(layout.regions);
      const current = await store.find(conversationId, messageId);
      if (!current || current.deletedAt || current.mediaUrl !== photo.mediaUrl || current.ocrText !== photo.ocrText) throw new Error("This photo changed during translation. Open it again to retry.");
      return { originalText: photo.ocrText, ...translated, layoutApproximate: layout.engine !== "apple-vision" };
    };
    const pending = work().finally(() => jobs.delete(key));
    jobs.set(key, pending);
    return pending;
  };
}
