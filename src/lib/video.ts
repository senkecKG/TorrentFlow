const VIDEO_RE = /\.(mp4|mkv|avi|mov|wmv|flv|m4v|webm|mpg|mpeg)$/i;

export const isVideo = (path: string) => VIDEO_RE.test(path);
export const isSubtitle = (path: string) => /\.srt$/i.test(path);
