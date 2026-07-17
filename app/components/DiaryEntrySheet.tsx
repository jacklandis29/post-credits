"use client";

import type { DiaryEntry, Movie, NoteVisibility } from "@/lib/types";
import { isValidLocalDate, prettyDate } from "@/lib/ui";
import { useState, type FormEvent } from "react";
import { PosterArt } from "./media";

export type DiaryEntryUpdate = {
  watchedOn: string;
  note: string;
  visibility: NoteVisibility;
  containsSpoilers: boolean;
  tags: string;
};

export function DiaryEntrySheet({
  entry,
  movie,
  isOnlyWatch,
  isRanked,
  busy,
  onSave,
  onDelete,
  onClose,
}: {
  entry: DiaryEntry;
  movie: Movie;
  isOnlyWatch: boolean;
  isRanked: boolean;
  busy: boolean;
  onSave: (entry: DiaryEntry, update: DiaryEntryUpdate) => void;
  onDelete: (entry: DiaryEntry, removeFromCanon: boolean) => void;
  onClose: () => void;
}) {
  const [watchedOn, setWatchedOn] = useState(entry.watchedOn);
  const [note, setNote] = useState(entry.note);
  const [visibility, setVisibility] = useState<NoteVisibility>(entry.visibility);
  const [containsSpoilers, setContainsSpoilers] = useState(Boolean(entry.containsSpoilers));
  const [tags, setTags] = useState((entry.tags ?? []).join(", "));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeFromCanon, setRemoveFromCanon] = useState(false);
  const rankingInProgress = entry.rankingStatus === "in_progress";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidLocalDate(watchedOn) || note.length > 2000 || busy) return;
    onSave(entry, { watchedOn, note, visibility, containsSpoilers, tags });
    onClose();
  }

  return (
    <div
      className="entry-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-sheet-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form className="entry-sheet" onSubmit={submit}>
        <div className="entry-sheet-heading">
          <div className="entry-sheet-film">
            <PosterArt movie={movie} />
            <div>
              <span>Diary entry</span>
              <h2 id="entry-sheet-title">{movie.title}</h2>
              <small>{movie.year} · watched {prettyDate(entry.watchedOn)}</small>
            </div>
          </div>
          <button className="sheet-close inline" type="button" onClick={onClose} disabled={busy} aria-label="Close entry editor">×</button>
        </div>

        <label className="entry-field">
          <span>Watch date</span>
          <input type="date" value={watchedOn} onChange={(event) => setWatchedOn(event.target.value)} required />
        </label>

        <label className="entry-field">
          <span>Tags <small>Comma-separated</small></span>
          <input value={tags} maxLength={329} onChange={(event) => setTags(event.target.value)} placeholder="watched-on-a-plane, with-mom" />
        </label>

        <label className="spoiler-toggle entry-sheet-spoiler">
          <input type="checkbox" checked={containsSpoilers} onChange={(event) => setContainsSpoilers(event.target.checked)} />
          <span><strong>Contains spoilers</strong><small>Hide this note behind a warning when it is public.</small></span>
        </label>

        <label className="entry-field">
          <span>Note <small>{note.length}/2000</small></span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={6} placeholder="What stayed with you?" />
        </label>

        <label className="entry-field">
          <span>Note visibility</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as NoteVisibility)}>
            <option value="inherit">Use profile default</option>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>

        {rankingInProgress ? (
          <p className="entry-sheet-notice">Finish this entry&rsquo;s ranking before deleting it. You can still fix its date or note now.</p>
        ) : null}

        {confirmDelete ? (
          <div className="entry-delete-confirm" role="alert">
            <strong>Delete this diary entry?</strong>
            <p>This removes the watch, date, and note. Comparison history stays intact.</p>
            {isOnlyWatch && isRanked ? (
              <label>
                <input type="checkbox" checked={removeFromCanon} onChange={(event) => setRemoveFromCanon(event.target.checked)} />
                <span>Also remove {movie.title} from my ranking</span>
              </label>
            ) : null}
            <div>
              <button className="danger-action" type="button" disabled={busy} onClick={() => { onDelete(entry, removeFromCanon); onClose(); }}>Delete entry</button>
              <button className="text-action" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          </div>
        ) : (
          <div className="entry-sheet-actions">
            <button className="text-action danger-text" type="button" disabled={busy || rankingInProgress} onClick={() => setConfirmDelete(true)}>Delete entry</button>
            <button className="primary-action" type="submit" disabled={busy || !isValidLocalDate(watchedOn) || note.length > 2000}>Save changes</button>
          </div>
        )}
      </form>
    </div>
  );
}
