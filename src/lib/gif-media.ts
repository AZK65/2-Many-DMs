/** Native animation metadata is required for video GIFs. A short/silent MP4 is
 * not sufficient evidence: normal video attachments remain click-to-play. */
export function isGifMedia(media: { mediaIsGif?: boolean; mediaName?: string | null; mediaUrl?: string | null }): boolean {
  return media.mediaIsGif === true || [media.mediaName, media.mediaUrl].some(value => /\.gif$/i.test((value || "").split(/[?#]/)[0]));
}

export function shouldPlayGif({ isGif, visible, pageVisible, reducedMotion, intent }: {
  isGif: boolean; visible: boolean; pageVisible: boolean; reducedMotion: boolean;
  intent: "play" | "pause" | null;
}): boolean {
  return isGif && visible && pageVisible && intent !== "pause" && (!reducedMotion || intent === "play");
}
