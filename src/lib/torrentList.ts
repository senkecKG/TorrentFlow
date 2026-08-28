import type { TorrentDto } from "./types";

export const TORRENT_SORTS = ["recent", "added", "name", "queue"] as const;

export type TorrentSort = (typeof TORRENT_SORTS)[number];

export function isTorrentSort(value: string | null): value is TorrentSort {
  return TORRENT_SORTS.includes(value as TorrentSort);
}

export function isResumable(torrent: TorrentDto): boolean {
  return torrent.state === "paused" || torrent.state === "error";
}

export function sortTorrents(torrents: TorrentDto[], sort: TorrentSort): TorrentDto[] {
  if (sort === "queue") return torrents;

  return torrents
    .map((torrent, index) => ({ torrent, index }))
    .sort((a, b) => {
      let result = 0;
      if (sort === "name") {
        result = (a.torrent.name || a.torrent.infoHash).localeCompare(
          b.torrent.name || b.torrent.infoHash,
          undefined,
          { numeric: true, sensitivity: "base" },
        );
      } else if (sort === "added") {
        result = b.torrent.addedAt - a.torrent.addedAt;
      } else {
        const aActivity = Math.max(a.torrent.addedAt, a.torrent.completedAt ?? 0);
        const bActivity = Math.max(b.torrent.addedAt, b.torrent.completedAt ?? 0);
        result = bActivity - aActivity;
      }
      return result || a.index - b.index;
    })
    .map(({ torrent }) => torrent);
}
