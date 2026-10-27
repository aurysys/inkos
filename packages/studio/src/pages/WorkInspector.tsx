import { CreativeMethodsEditor } from "./CreativeMethodsEditor";
import { useMemo, useState, useRef } from "react";
import { ArrowLeft, Clock3, FileText, GitCommitHorizontal, Loader2, Pencil, Save, X } from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import { tr } from "../lib/app-language";

interface Revision {
  readonly id: string;
  readonly path: string;
  readonly contentType: string;
  readonly status: string;
  readonly byteLength: number;
  readonly createdAt: string;
}

interface Artifact {
  readonly id: string;
  readonly kind: string;
  readonly currentRevisionId: string | null;
  readonly revisions: ReadonlyArray<Revision>;
}

interface WorkDetail {
  readonly work: {
    readonly id: string;
    readonly title: string;
    readonly profileId: string;
    readonly language: string;
    readonly status: string;
    readonly artifacts: ReadonlyArray<Artifact>;
  };
  readonly episodes: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly startedAt: string;
  }>;
}

interface RevisionPayload {
  readonly revision: Revision;
  readonly artifactId: string;
  readonly content?: string;
  readonly dataUrl?: string;
}

function revisionDifference(current: string, selected: string): string {
  const before = current.split("\n"), after = selected.split("\n");
  let start = 0, suffix = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (suffix < Math.min(before.length, after.length) - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return [...before.slice(start, before.length - suffix).map(line => `− ${line}`), ...after.slice(start, after.length - suffix).map(line => `+ ${line}`)].join("\n");
}

export function WorkInspector({ workId, onBack, onChat }: {
  readonly workId: string;
  readonly onBack: () => void;
  readonly onChat: (workId: string, profileId: string) => void;
}) {
  const { data, loading, error, refetch } = useApi<WorkDetail>(`/works/${encodeURIComponent(workId)}`);
  const previewSequence = useRef(0);
  const [previewRevisionId, setPreviewRevisionId] = useState("");
  const [selected, setSelected] = useState<RevisionPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [operationError, setOperationError] = useState("");
  const [comparison, setComparison] = useState<RevisionPayload | null>(null);
  const [events, setEvents] = useState<Array<{ seq: number; type: string; payload: unknown }> | null>(null);
  const currentRevisions = useMemo(() => data?.work.artifacts.map((artifact) => ({
    artifact,
    revision: artifact.revisions.find((revision) => revision.id === artifact.currentRevisionId) ?? artifact.revisions.at(-1),
  })) ?? [], [data]);

  const openRevision = async (artifact: Artifact, revision: Revision) => {
    const sequence = ++previewSequence.current; setPreviewRevisionId(revision.id);
    setPreviewLoading(true); setOperationError(""); setComparison(null);
    try {
      const payload = await fetchJson<RevisionPayload>(
        `/works/${encodeURIComponent(workId)}/artifacts/${encodeURIComponent(artifact.id)}/revisions/${encodeURIComponent(revision.id)}`,
      );
      if (sequence !== previewSequence.current) return;
      setSelected(payload);
      setDraft(payload.content ?? "");
      setEditing(false);
    } catch (error) { setOperationError(String(error)); } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  };

  const saveRevision = async () => {
    if (selected?.content === undefined || editing === false) return;
    try { await fetchJson(`/project/artifacts/${encodeURIComponent(`works/${workId}/${selected.revision.path}`).replaceAll("%2F", "/")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft, expectedRevisionId: selected.revision.id }),
    });
    setSelected(null);
    setEditing(false);
    await refetch();
    } catch (error) { setOperationError(String(error)); }
  };

  const selectedArtifact = data?.work.artifacts.find(artifact => artifact.id === selected?.artifactId);
  const compareCurrent = async () => {
    if (!selectedArtifact?.currentRevisionId) return;
    try { setComparison(await fetchJson<RevisionPayload>(`/works/${encodeURIComponent(workId)}/artifacts/${encodeURIComponent(selectedArtifact.id)}/revisions/${encodeURIComponent(selectedArtifact.currentRevisionId)}`)); }
    catch (error) { setOperationError(String(error)); }
  };
  const adoptRevision = async () => {
    if (!selected || !selectedArtifact) return;
    try {
      await fetchJson(`/works/${encodeURIComponent(workId)}/artifacts/${encodeURIComponent(selected.artifactId)}/revisions/${encodeURIComponent(selected.revision.id)}/adopt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedCurrentRevisionId: selectedArtifact.currentRevisionId }),
      });
      setSelected(null); setComparison(null); await refetch();
    } catch (error) { setOperationError(String(error)); }
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  if (error || !data) return <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">{error ?? tr("未找到作品", "Work not found", "작품을 찾을 수 없습니다")}</div>;

  return (
    <div className="space-y-8">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} /> {tr("返回创作库", "Back to library", "작품 보관함으로 돌아가기")}
      </button>
      <header className="rounded-2xl border border-border/55 bg-card/65 p-7 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{data.work.profileId}</div>
        <h1 className="mt-2 font-serif text-4xl">{data.work.title}</h1>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>{data.work.id}</span><span>·</span><span>{data.work.language}</span><span>·</span><span>{data.work.status}</span>
          <span>·</span><span>{data.work.artifacts.length} {tr("项生成物", "artifacts", "개 생성물")}</span>
        </div>
        <button type="button" onClick={() => onChat(data.work.id, data.work.profileId)} className="mt-6 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
          {tr("与 Agent 继续创作", "Continue with Agent", "에이전트와 이어서 창작")}
        </button>
      </header>

      {operationError && <p role="alert" className="rounded border border-destructive p-3 text-destructive">{operationError}</p>}
      <CreativeMethodsEditor profileId={data.work.profileId} />
      <section>
        <div className="mb-4 flex items-center gap-2"><FileText size={18} className="text-primary" /><h2 className="text-xl font-semibold">{tr("生成物与版本", "Artifacts and revisions", "생성물과 버전")}</h2></div>
        <div className="grid gap-3">
          {currentRevisions.map(({ artifact, revision }) => (
            <button
              key={artifact.id}
              type="button"
              disabled={!revision}
              onClick={() => revision && void openRevision(artifact, revision)}
              className="flex items-center justify-between gap-4 rounded-xl border border-border/55 bg-card px-5 py-4 text-left transition hover:border-primary/40 hover:bg-primary/[0.03] disabled:opacity-50"
            >
              <div className="min-w-0">
                <div className="font-medium">{revision?.path ?? artifact.id}</div>
                <div className="mt-1 text-xs text-muted-foreground">{artifact.kind} · {artifact.revisions.length} {tr("个版本", "revision(s)", "개 버전")} · {revision?.status}</div>
              </div>
              <GitCommitHorizontal size={18} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
          {currentRevisions.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{tr("尚无生成物。", "No artifacts yet.", "아직 생성물이 없습니다.")}</div>}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2"><Clock3 size={18} className="text-primary" /><h2 className="text-xl font-semibold">{tr("执行记录", "Execution history", "실행 기록")}</h2></div>
        <div className="space-y-2">
          {data.episodes.map((episode) => (
            <button type="button" key={episode.id} onClick={() => void fetchJson<{ events: Array<{ seq: number; type: string; payload: unknown }> }>(`/episodes/${encodeURIComponent(episode.id)}`).then(result => setEvents(result.events)).catch(error => setOperationError(String(error)))} className="flex w-full items-center justify-between rounded-xl border border-border/45 bg-secondary/20 px-4 py-3 text-sm">
              <span className="truncate font-mono text-xs">{episode.id}</span>
              <span className="ml-4 shrink-0 font-medium">{episode.status}</span>
            </button>
          ))}
          {data.episodes.length === 0 && <div className="text-sm text-muted-foreground">{tr("尚无执行记录。", "No Episodes yet.", "아직 실행 기록이 없습니다.")}</div>}
        </div>
      </section>

      {events && <div className="fixed inset-0 z-[100] overflow-auto bg-background/95 p-8">
        <button className="mb-4 rounded border border-border p-2" onClick={() => setEvents(null)}>{tr("关闭执行记录", "Close execution history", "실행 기록 닫기")}</button>
        {events.map(event => <details key={event.seq} className="mb-2 rounded border border-border p-3"><summary>{event.seq} · {event.type}</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.payload, null, 2)}</pre></details>)}
      </div>}
      {(selected || previewLoading) && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-background/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <aside className="h-full w-[min(820px,94vw)] overflow-y-auto border-l border-border bg-background p-7 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            {selected && <div className="mb-5 flex flex-wrap items-center gap-2">
              <select aria-label={tr("选择作品版本", "Select revision", "작품 버전 선택")} className="max-w-full rounded border border-border bg-background p-2 text-sm" value={previewRevisionId || selected.revision.id} onChange={event => {
                const revision = selectedArtifact?.revisions.find(revision => revision.id === event.target.value);
                if (selectedArtifact && revision) void openRevision(selectedArtifact, revision);
              }}>{selectedArtifact?.revisions.map(revision => <option key={revision.id} value={revision.id}>{revision.status} · {revision.createdAt} · {revision.id}</option>)}</select>
              {selectedArtifact?.currentRevisionId && selectedArtifact.currentRevisionId !== selected.revision.id && <button className="rounded border border-border px-3 py-2 text-sm" onClick={() => void compareCurrent()}>{tr("比较当前版本", "Compare with current", "현재 버전과 비교")}</button>}
              {selectedArtifact?.currentRevisionId !== selected.revision.id && (!selectedArtifact?.currentRevisionId || comparison) && <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => void adoptRevision()}>{tr("采用这个版本", "Adopt this revision", "이 버전 채택")}</button>}
              {operationError && <p role="alert" className="w-full text-sm text-destructive">{operationError}</p>}
            </div>}
            {comparison?.content !== undefined && selected?.content !== undefined && <details className="mb-4 rounded border border-border p-3" open><summary>{tr("变更内容：− 当前，+ 所选", "Changes: − current, + selected", "변경 내용: − 현재, + 선택")}</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs">{revisionDifference(comparison.content, selected.content)}</pre></details>}
            {comparison && <section className="mb-6 rounded border border-border p-4"><h3 className="mb-3 font-semibold">{tr("当前版本", "Current revision", "현재 버전")}</h3>{comparison.dataUrl ? <img src={comparison.dataUrl} alt={tr("当前版本", "Current revision", "현재 버전")} /> : <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{comparison.content}</pre>}<h3 className="mt-4 font-semibold">{tr("下面是所选版本", "Selected revision below", "아래는 선택한 버전입니다")}</h3></section>}
            {previewLoading ? <Loader2 className="animate-spin text-primary" /> : selected?.dataUrl ? (
              <img src={selected.dataUrl} alt={selected.revision.path} className="h-auto w-full rounded-xl" />
            ) : (
              <>
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="break-all text-sm font-medium text-muted-foreground">{selected?.revision.path}</div>
                  <div className="flex shrink-0 gap-2">
                    {editing ? (
                      <button type="button" onClick={() => void saveRevision()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Save size={15} />{tr("保存新版本", "Save revision", "새 버전 저장")}</button>
                    ) : (
                      <button type="button" disabled={selected?.revision.id !== selectedArtifact?.currentRevisionId} onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Pencil size={15} />{tr("编辑", "Edit", "편집")}</button>
                    )}
                    <button type="button" aria-label={tr("关闭", "Close", "닫기")} onClick={() => setSelected(null)} className="rounded-lg border border-border p-2"><X size={16} /></button>
                  </div>
                </div>
                {editing ? (
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-[calc(100vh-130px)] w-full resize-none rounded-xl border border-border bg-secondary/20 p-4 font-mono text-sm leading-7 outline-none focus:border-primary" />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-base leading-8">{selected?.content}</pre>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
