import { useEffect, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";
import { tr } from "../../lib/app-language";

interface ChapterMeta {
  number: number;
  title: string;
  wordCount: number;
  observations: ReadonlyArray<unknown>;
}

interface ChaptersSectionProps {
  readonly bookId: string;
  readonly isZh: boolean;
}

export function ChaptersSection({ bookId }: ChaptersSectionProps) {
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterMeta>>([]);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    fetchJson<{ chapters: ChapterMeta[] }>(`/books/${bookId}`)
      .then((data) => setChapters(data.chapters))
      .catch(() => setChapters([]));
  }, [bookId, bookDataVersion]);

  return (
    <SidebarCard title={tr("章节", "Chapters", "챕터")}>
      {chapters.length === 0 ? (
        <p className="text-[15px] leading-6 text-muted-foreground/50 italic">
          {tr("暂无章节", "No chapters", "챕터가 없습니다")}
        </p>
      ) : (
        <ul className="space-y-1 max-h-52 overflow-y-auto overflow-x-hidden">
          {chapters.map((ch) => {
            const ind = ch.observations.length > 0
              ? { symbol: "◆", color: "text-amber-500" }
              : { symbol: "●", color: "text-emerald-500" };
            return (
              <li
                key={`${ch.number}-${ch.title ?? ""}`}
                onClick={() => useChatStore.getState().openChapterArtifact(ch.number)}
                className="flex items-center gap-2 py-1 text-[15px] leading-6 text-muted-foreground cursor-pointer hover:text-foreground transition-colors rounded px-1 -mx-1 hover:bg-secondary/50">
                <span className={cn("text-[13px] shrink-0", ind.color)}>{ind.symbol}</span>
                <span className="truncate flex-1">
                  {String(ch.number).padStart(2, "0")} {ch.title || tr(`第${ch.number}章`, `Chapter ${ch.number}`, `${ch.number}장`)}
                </span>
                <span className="tabular-nums text-[13px] text-muted-foreground/50 shrink-0">
                  {(ch.wordCount ?? 0).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarCard>
  );
}
