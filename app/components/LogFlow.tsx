"use client";

import { useEffect } from "react";
import { formatScore, getNextComparison, type RankingSession } from "@/lib/ranking";
import { movieById } from "@/lib/seed";
import type { Movie, NoteVisibility, Verdict } from "@/lib/types";
import { filmStyle, isValidLocalDate, todayLocal, type CanonRow } from "@/lib/ui";
import { FilmRollIcon } from "./icons";
import { PosterArt } from "./media";

export type LogStep =
  | "details"
  | "rewatch"
  | "verdict"
  | "resume"
  | "compare"
  | "result";

export type LogReason = "initial" | "rewatch" | "manual";

export type LogDraft = {
  step: LogStep;
  movie: Movie | null;
  watchedOn: string;
  note: string;
  visibility: NoteVisibility;
  entryId: string | null;
  reason: LogReason;
  verdict: Verdict | null;
  session: RankingSession | null;
  sessionId: string | null;
  sessionRevision: number;
  resultRank: number | null;
  resultScore: number | null;
  rankBefore: number | null;
  verdictBefore: Verdict | null;
  dnf: boolean;
};

export function emptyDraft(): LogDraft {
  return {
    step: "details",
    movie: null,
    watchedOn: todayLocal(),
    note: "",
    visibility: "private",
    entryId: null,
    reason: "initial",
    verdict: null,
    session: null,
    sessionId: null,
    sessionRevision: 0,
    resultRank: null,
    resultScore: null,
    rankBefore: null,
    verdictBefore: null,
    dnf: false,
  };
}

const stepLabels: Record<LogStep, string> = {
  details: "Log",
  rewatch: "Rewatch saved",
  verdict: "Score",
  resume: "Ranking paused",
  compare: "Placing it",
  result: "Saved to your diary",
};

export function LogFilmFlow({
  draft,
  canon,
  onUpdate,
  onSave,
  onKeepRewatch,
  onVerdict,
  onAnswer,
  onUndo,
  onAccept,
  onResume,
  onClose,
  onOpenFilm,
}: {
  draft: LogDraft;
  canon: CanonRow[];
  onUpdate: (update: Partial<LogDraft>) => void;
  onSave: (dnf?: boolean) => void;
  onKeepRewatch: () => void;
  onVerdict: (verdict: Verdict) => void;
  onAnswer: (outcome: "new_wins" | "existing_wins" | "too_close") => void;
  onUndo: () => void;
  onAccept: () => void;
  onResume: () => void;
  onClose: () => void;
  onOpenFilm: (movie: Movie) => void;
}) {
  const comparison = draft.session ? getNextComparison(draft.session) : null;
  const opponent = comparison ? movieById(Number(comparison.comparatorId)) : null;
  const opponentRow = opponent ? canon.find((row) => row.movie.id === opponent.id) : undefined;
  const answered = draft.session ? draft.session.decisiveAnswers + draft.session.skips : 0;
  const existingRow = draft.movie
    ? canon.find((row) => row.movie.id === draft.movie?.id)
    : undefined;
  const resultNeighbors = draft.resultRank
    ? canon.slice(Math.max(0, draft.resultRank - 2), Math.min(canon.length, draft.resultRank + 1))
    : [];

  useEffect(() => {
    if (draft.step !== "compare") return;
    function handleRankingKeys(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.key === "1" || event.key === "ArrowLeft") onAnswer("new_wins");
      else if (event.key === "2" || event.key === "ArrowRight") onAnswer("existing_wins");
      else if (event.key.toLowerCase() === "t") onAnswer("too_close");
      else if (event.key.toLowerCase() === "u" && draft.session?.answers.length) onUndo();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleRankingKeys);
    return () => window.removeEventListener("keydown", handleRankingKeys);
  }, [draft.session?.answers.length, draft.step, onAnswer, onUndo]);

  return (
    <div className="log-overlay" role="dialog" aria-modal="true" aria-label="Log a film">
      <div className={`log-sheet log-step-${draft.step}`} style={draft.movie ? filmStyle(draft.movie) : undefined}>
        <div className="log-topbar">
          <button className="log-brand" onClick={onClose} aria-label="Close logging flow and return to Post Credits"><FilmRollIcon /><span>Post Credits</span></button>
          <span>{stepLabels[draft.step]}</span>
          <button className="sheet-close inline" onClick={onClose} aria-label="Close logging flow">×</button>
        </div>

        {draft.step === "details" && draft.movie ? (
          <div className="log-content details-step">
            <div className="log-film-summary">
              <PosterArt movie={draft.movie} eager />
              <div><h1>{draft.movie.title}</h1><p>{draft.movie.year} · {draft.movie.director}</p></div>
            </div>
            <div className="entry-form">
              <div className="entry-form-row">
                <label><span>Watched on</span><input type="date" required aria-invalid={!isValidLocalDate(draft.watchedOn)} value={draft.watchedOn} onChange={(event) => onUpdate({ watchedOn: event.target.value })} />{!isValidLocalDate(draft.watchedOn) ? <em className="field-error">Choose a valid watch date.</em> : null}</label>
                <label><span>Note visibility</span><select value={draft.visibility} onChange={(event) => onUpdate({ visibility: event.target.value as NoteVisibility })}><option value="private">Only me</option><option value="inherit">Use profile setting</option><option value="public">Public</option></select></label>
              </div>
              <label className="note-field"><span>Note <small>Optional · {draft.note.length} / 2,000</small></span><textarea value={draft.note} maxLength={2000} onChange={(event) => onUpdate({ note: event.target.value })} placeholder="What stayed with you?" /></label>
            </div>
            <div className="details-actions">
              <button className="text-action dnf-action" onClick={() => onSave(true)}>Did not finish</button>
              <button className="primary-action" disabled={!isValidLocalDate(draft.watchedOn)} onClick={() => onSave(false)}>Score</button>
            </div>
          </div>
        ) : null}

        {draft.step === "rewatch" && draft.movie ? (
          <div className="log-content verdict-step">
            <h1>Re-rank this film?</h1>
            <p className="step-intro">It currently sits at #{existingRow?.rank}. Keep it there, or compare it again if your opinion changed.</p>
            <div className="rewatch-choice">
              <button onClick={onKeepRewatch}><span>Keep current rank</span></button>
              <button onClick={() => onUpdate({ step: "verdict" })}><span>Re-rank</span></button>
            </div>
          </div>
        ) : null}

        {draft.step === "verdict" && draft.movie ? (
          <div className="log-content score-step">
            <div className="log-film-summary score-film">
              <PosterArt movie={draft.movie} eager />
              <div><h1>{draft.movie.title}</h1><p>{draft.movie.year} · {draft.movie.director}</p></div>
            </div>
            <div className="score-copy">
              <h2>How was it?</h2>
              <p>Your answer sets the broad tier. Comparisons handle the exact rank.</p>
            </div>
            <div className="verdict-options" role="group" aria-label={`Score ${draft.movie.title}`}>
              <button className="liked" onClick={() => onVerdict("liked")}><strong>Liked it</strong><small>I&rsquo;d recommend it</small></button>
              <button className="fine" onClick={() => onVerdict("fine")}><strong>It was okay</strong><small>Glad I watched it</small></button>
              <button className="disliked" onClick={() => onVerdict("disliked")}><strong>Not for me</strong><small>It didn&rsquo;t land</small></button>
            </div>
          </div>
        ) : null}

        {draft.step === "resume" && draft.movie && draft.session ? (
          <div className="log-content resume-step">
            <h1>Resume ranking</h1>
            <p className="step-intro">{draft.movie.title}{existingRow ? ` · currently #${existingRow.rank}` : ""}</p>
            <div className="resume-actions">
              <button className="primary-action" onClick={onResume}>{draft.session.status === "complete" ? "Finish ranking" : "Continue ranking"}</button>
              {draft.session.status !== "complete" ? <button className="secondary-action" onClick={onAccept}>Keep current placement</button> : null}
            </div>
          </div>
        ) : null}

        {draft.step === "compare" && draft.movie && opponent && draft.session ? (
          <div className="comparison-step">
            <div className="comparison-heading">
              <h1>Which did you like more?</h1>
            </div>
            <div className="comparison-stage">
              <button className="comparison-film subject" onClick={() => onAnswer("new_wins")} style={filmStyle(draft.movie!)}>
                <PosterArt movie={draft.movie} eager />
                <span><small>{draft.reason === "initial" ? "New watch" : "Being re-ranked"}</small><strong>{draft.movie.title}</strong><em><kbd>1</kbd> or ←</em></span>
              </button>
              <span className="comparison-or" aria-hidden="true">or</span>
              <button className="comparison-film opponent" onClick={() => onAnswer("existing_wins")} style={filmStyle(opponent)}>
                <PosterArt movie={opponent} eager />
                <span><small>{opponentRow ? `#${opponentRow.rank} in your ranking` : "From your ranking"}</small><strong>{opponent.title}</strong><em><kbd>2</kbd> or →</em></span>
              </button>
            </div>
            <div className="comparison-controls">
              <button onClick={() => onAnswer("too_close")}><kbd>T</kbd> Too close to call</button>
              <button onClick={onUndo} disabled={draft.session.answers.length === 0}><kbd>U</kbd> Undo</button>
              <button onClick={onAccept}>Accept current placement</button>
            </div>
            <div className="comparison-progress" role="status" aria-label={`${answered} of up to 5 comparisons answered`}>
              {[0, 1, 2, 3, 4].map((index) => (
                <span key={index} className={index < answered ? "done" : ""} />
              ))}
            </div>
          </div>
        ) : null}

        {draft.step === "result" && draft.movie ? (
          <div className="log-content result-step" style={filmStyle(draft.movie)}>
            <div className="result-halo" aria-hidden="true" />
            <h1>{draft.movie.title}</h1>
            {draft.dnf ? (
              <div className="dnf-result">Saved as did not finish</div>
            ) : (
              <div className="result-ranking">
                <span><small>Rank</small><strong>{draft.resultRank ? `#${draft.resultRank}` : "Saved"}</strong></span>
                {draft.resultScore !== null ? <span title="Calculated from verdict and canon position" aria-label={`Relative score ${formatScore(draft.resultScore)}, calculated from verdict and canon position`}><small>Score</small><strong>{formatScore(draft.resultScore)}</strong></span> : null}
              </div>
            )}
            {!draft.dnf && resultNeighbors.length ? (
              <div className="result-neighbors">
                <p>Where it landed</p>
                {resultNeighbors.map((row) => (
                  <div className={row.movie.id === draft.movie?.id ? "current" : ""} key={row.movie.id}>
                    <span>#{row.rank}</span><strong>{row.movie.title}</strong>{row.score !== null ? <small>{formatScore(row.score)}</small> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="result-actions">
              <button className="primary-action" onClick={() => onOpenFilm(draft.movie!)}>View film page</button>
              <button className="text-action" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
