import { recognizeLocalPhoto, PHOTO_OCR_MODEL } from "./local-ocr";
import { translateText } from "./translation";

export type PhotoRecord = { id: string; conversationId: string; mediaType: string | null; mediaUrl: string | null;
  deletedAt: Date | null; ocrText: string | null; ocrStatus: string | null; ocrModel: string | null };
export type PhotoTranslationResult = { originalText: string; translatedText?: string; detectedLanguageName?: string; empty?: boolean };
type Store = {
  find: (conversationId: string, messageId: string) => Promise<PhotoRecord | null>;
  save: (photo: PhotoRecord, text: string, model: string) => Promise<boolean>;
};

/** Workspace-bound DB lookup, no arbitrary image URL or caller-supplied OCR text. */
export function photoTranslationService(store: Store, dependencies = { recognize: recognizeLocalPhoto, translate: translateText }) {
  const jobs = new Map<string, Promise<PhotoTranslationResult>>();
  return async (conversationId: string, messageId: string, action: "recognize" | "translate"): Promise<PhotoTranslationResult> => {
    const photo = await store.find(conversationId, messageId);
    if (!photo || photo.deletedAt || photo.id !== messageId || photo.conversationId !== conversationId) throw new Error("Photo not found in this chat.");
    if (photo.mediaType !== "image") throw new Error("Choose a photo to translate.");
    if (!photo.mediaUrl?.startsWith("/media/")) throw new Error("Download this photo into the app first using Recover, then choose Translate photo.");
    const key = JSON.stringify([conversationId, messageId, photo.mediaUrl, action]);
    const existing = jobs.get(key);
    if (existing) return existing;
    if (jobs.size >= 2) throw new Error("Local photo translation is busy. Let the current photos finish, then try again.");
    const work = async (): Promise<PhotoTranslationResult> => {
      if (action === "recognize") {
        // Background indexing is deliberately short. Read again on demand so a
        // cached search snippet is never mistaken for the entire photograph.
        const originalText = await dependencies.recognize(photo.mediaUrl!);
        if (!await store.save(photo, originalText, PHOTO_OCR_MODEL)) throw new Error("This photo changed while it was being read. Open it again to retry.");
        return { originalText, empty: !originalText };
      }
      if (photo.ocrStatus !== "complete" || photo.ocrModel !== PHOTO_OCR_MODEL || !photo.ocrText?.trim()) throw new Error("Read the photo text first, then translate it.");
      if (photo.ocrText.length > 16_000) throw new Error("This photo contains too much text. Crop it into smaller sections first.");
      const translated = await dependencies.translate(photo.ocrText, { code: "en", name: "English" }, undefined, [], "photo");
      const current = await store.find(conversationId, messageId);
      if (!current || current.deletedAt || current.mediaUrl !== photo.mediaUrl || current.ocrText !== photo.ocrText) throw new Error("This photo changed during translation. Open it again to retry.");
      return { originalText: photo.ocrText, translatedText: translated.translatedText, detectedLanguageName: translated.detectedLanguageName };
    };
    const pending = work().finally(() => jobs.delete(key));
    jobs.set(key, pending);
    return pending;
  };
}
