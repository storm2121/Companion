import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/authState';
import {
  deleteNoteVersion,
  getNoteVersion,
  listenSageUsage,
  saveNoteVersion,
  updateNote,
} from '../../services/library';
import { describeSageRun, readSageBalance, sageDayKey, sageRunWeight } from '../../services/sage';
import { cleanTags } from '../noteTags';
import { fromStored, toStored } from '../pageBlocks';
import {
  applySageResult,
  hasSageText,
  SAGE_MAX_BLOCKS,
  sageScope,
  sageSummary,
  toPageBlocks,
  toSageBlocks,
} from '../sageBridge';
import { callRoomSage } from '../sageCall';
import { SAGE_EXTRAS, SAGE_GOALS, SAGE_PHRASES, SAGE_VOICES, CLASSIC_ADDONS } from '../sageChoices';
import Paper from './Paper';
import { Chip, Pill, Segmented } from './primitives';

// Sage in the room (dualmode.md §5). A paper panel over the right rail — never over the
// sheet you are writing on. What to do is a row of chips, what else a second row, the plan
// is one line, the allowance a mono stamp, Run the amber pill. The voice, the topic and a
// standing request live on the You page.
//
// It talks back. The page path (functions/lib/pageSage.js) answers in the room's own block
// types and adds a short note from Sage — what it did and one thing worth knowing about
// this note — plus a few tags it would file the note under, one click each to add.
//
// "This section" sends just the section you are in: faster, cheaper, and the rest of the
// page is left alone.
//
// Versions work as classic's do: the note as it was before Sage's first run is kept in a
// named slot beside the content (`content/original`), and "Before / After" swaps them.
//
// The panel stays mounted while the note is open (it only HIDES when closed), so a run you
// start carries on and lands even if you close the panel to keep writing.

const PLAN = {
  patch: 'Quick edit — only the blocks that need it change.',
  reflow: 'Edit and add — new blocks land right where they belong.',
  layout: 'Rebuild — the whole thing, reorganised. Board photos stay put.',
};

const CANVAS_HEIGHT = 720;

// Server messages are written for people; a bare code ("INTERNAL") is not.
const readable = (err) => {
  const message = String(err?.message || '');
  if (!message || /^[A-Z_-]+$/.test(message) || /^functions\//.test(message)) {
    return 'Sage hit a snag — please try again.';
  }
  return message;
};

const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const SagePanel = ({
  open,
  onClose,
  courseId,
  noteId,
  noteTitle,
  blocks,
  getBlocks,
  onReplace,
  versions,
  onVersions,
  online,
  sections = [],
  focusSection = '',
  tags = [],
  onAddTag,
}) => {
  const { firebaseUser, profile, updateRoomPrefs } = useAuth();
  const uid = firebaseUser?.uid;

  // The standing instructions (also on the You page) and the extras last used. How Sage
  // talks, what the notes are about and anything else to tell it are edited right here,
  // folded away until wanted; every change is saved as it is made.
  const standing = profile?.roomPrefs?.sage || {};
  const voice = SAGE_VOICES.some((item) => item.id === standing.voice) ? standing.voice : 'buddy';
  const [topic, setTopic] = useState(() => (typeof standing.topic === 'string' ? standing.topic : ''));
  const [comment, setComment] = useState(() => (typeof standing.comment === 'string' ? standing.comment : ''));
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  // Every save carries what is typed right now: two saves in one moment (a field's blur,
  // then a click on a voice) must not each copy the old instructions over the other.
  const typed = () => ({ topic: topic.trim().slice(0, 120), comment: comment.trim().slice(0, 500) });
  const saveInstructions = (patch = {}) => {
    const next = { ...standing, ...typed(), ...patch };
    const same = ['voice', 'topic', 'comment', 'addons'].every(
      (key) => JSON.stringify(next[key] ?? null) === JSON.stringify(standing[key] ?? null),
    );
    if (same) return;
    updateRoomPrefs?.({ sage: next })?.catch?.((err) => console.error('Could not save Sage’s instructions', err));
  };
  const saveTyped = () => saveInstructions();

  const [goals, setGoals] = useState(['polish']);
  const [extras, setExtras] = useState(() =>
    (Array.isArray(standing.addons) ? standing.addons : []).filter((id) => SAGE_EXTRAS.some((extra) => extra.id === id)).slice(0, 3),
  );
  const [scope, setScope] = useState('note');
  // The extras fold into one line until asked for: eight chips would crowd the panel.
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [phrase, setPhrase] = useState(0);
  const [message, setMessage] = useState(null);
  const [usage, setUsage] = useState(null);
  const [confirmKeep, setConfirmKeep] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    return listenSageUsage(uid, setUsage, (err) => console.warn('Could not read the Sage allowance', err));
  }, [uid]);

  // The status line while Sage works: the goal's own phrases, one every couple of seconds.
  useEffect(() => {
    if (!busy || busy === 'switch') return undefined;
    const timer = setInterval(() => setPhrase((n) => n + 1), 2000);
    return () => clearInterval(timer);
  }, [busy]);

  // "This section" is offered once there is more than one; it follows the caret.
  const section = sections.length > 1 ? sections.find((item) => item.id === focusSection) || sections[0] : null;
  const sectionId = scope === 'section' && section ? section.id : '';

  // As the server decides it (functions/lib/pageSage.js pageMode): a note to Sage lets a
  // quick edit add blocks too, since it may ask for something new.
  const baseMode = describeSageRun(goals, extras).mode;
  const mode = baseMode === 'patch' && comment.trim() ? 'reflow' : baseMode;
  const outgoing = useMemo(() => toPageBlocks(sageScope(blocks, sectionId)), [blocks, sectionId]);
  const cost = sageRunWeight(
    outgoing.map((block) => ({ type: block.type === 'image' ? 'image' : 'text', value: block.value, title: block.label })),
    mode,
  );
  const balance = readSageBalance(usage);
  const phrases = SAGE_PHRASES[busy] || SAGE_PHRASES.default;
  // A version switch also holds the panel busy, but it is not Sage thinking.
  const thinking = Boolean(busy) && busy !== 'switch';

  const toggle = (setter, limit) => (id) =>
    setter((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(-limit)));
  const toggleGoal = toggle(setGoals, 4);
  const toggleExtra = toggle(setExtras, 3);

  const say = (text, error = false) => setMessage({ text, error });

  const run = async () => {
    if (busy || !uid) return;
    if (!online) return say('Sage needs a connection.', true);
    if (!goals.length && !extras.length) return say('Pick at least one thing for Sage to do.', true);
    const before = getBlocks();
    const scoped = sageScope(before, sectionId);
    const page = toPageBlocks(scoped);
    const classic = toSageBlocks(scoped);
    if (!hasSageText(classic)) {
      return say(sectionId ? 'This section is nearly empty — nothing for Sage yet.' : 'Write a little first — Sage needs something to work with.', true);
    }
    if (page.length > SAGE_MAX_BLOCKS) {
      return say('Too many blocks for one pass — try it one section at a time.', true);
    }
    // Only when the counter we can see says so: with no counter, the server decides.
    if (usage && balance.left <= 0) return say('No Sage runs left today. More at 01:00.', true);

    // What is typed, and the extras picked here (remembered for next time), in ONE save.
    saveInstructions({ addons: extras });

    setMessage(null);
    setPhrase(0);
    setBusy(goals.includes('restructure') ? 'restructure' : goals[0] || 'default');
    try {
      const result = await callRoomSage({
        format: 'page',
        goals,
        extras,
        voice,
        page,
        section: sectionId ? section.title : '',
        tags,
        noteTitle,
        topic,
        comment,
        // Classic's fields, for a server that predates the page path (see sageCall.js).
        styles: goals,
        styleId: goals[0] || 'polish',
        addons: extras.filter((id) => CLASSIC_ADDONS.includes(id)),
        blocks: classic,
        canvasHeight: CANVAS_HEIGHT,
      });
      if (result?.usage) setUsage({ date: sageDayKey(), count: result.usage.count, cap: result.usage.cap });
      // Applied to the page as it is NOW, so what you typed while Sage worked survives.
      const applied = applySageResult(getBlocks(), result, {
        sent: new Set(page.map((block) => block.id)),
        sectionId,
      });
      if (!applied) throw new Error('Sage returned an unusable result — please try again.');
      const suggested = cleanTags(applied.tags).filter((tag) => !tags.includes(tag));
      if (!applied.changed && !applied.added) {
        setMessage({ text: applied.note || 'Sage read it through and found nothing worth changing.', says: Boolean(applied.note), tags: suggested });
        return;
      }
      // The note as it was is banked once, before the first run that changes anything.
      if (!versions.has) {
        await saveNoteVersion(uid, courseId, noteId, 'original', before.map(toStored), CANVAS_HEIGHT);
      }
      onReplace(applied.blocks);
      onVersions({ has: true, view: 'improved' });
      updateNote(uid, courseId, noteId, { sageHasVersions: true, sageView: 'improved' }).catch((err) =>
        console.error('Could not mark the Sage version', err),
      );
      setMessage({
        text: applied.note || sageSummary(applied),
        says: Boolean(applied.note),
        // No note, tags or sections come from a server that predates the page path.
        stamp: [applied.note ? sageSummary(applied) : '', result?.format === 'page' ? '' : 'Older Sage'].filter(Boolean).join(' · '),
        tags: suggested,
      });
    } catch (err) {
      console.error('Sage failed', err);
      say(readable(err), true);
    } finally {
      setBusy('');
    }
  };

  // Classic's swap: what is on the page goes into ITS slot, the other slot comes out.
  const switchTo = async (next) => {
    if (busy || !uid || next === versions.view) return;
    setBusy('switch');
    setConfirmKeep(false);
    try {
      await saveNoteVersion(uid, courseId, noteId, versions.view, getBlocks().map(toStored), CANVAS_HEIGHT);
      const other = await getNoteVersion(uid, courseId, noteId, next);
      if (!other) {
        say('That version is not there any more.', true);
        return;
      }
      onReplace(other.blocks.map(fromStored));
      onVersions({ has: true, view: next });
      updateNote(uid, courseId, noteId, { sageView: next }).catch((err) => console.error(err));
      say(next === 'original' ? 'This is the note before Sage.' : 'Back to Sage’s version.');
    } catch (err) {
      console.error('Could not switch versions', err);
      say(navigator.onLine ? 'That version would not load.' : 'Switching versions needs a connection.', true);
    } finally {
      setBusy('');
    }
  };

  // Irreversible — the other version is deleted — so this one asks first (the documented
  // exception to undo-instead-of-confirm, like clearing a device).
  const keep = async () => {
    if (!uid) return;
    if (!confirmKeep) {
      setConfirmKeep(true);
      return;
    }
    setConfirmKeep(false);
    try {
      await Promise.all([
        deleteNoteVersion(uid, courseId, noteId, 'original'),
        deleteNoteVersion(uid, courseId, noteId, 'improved'),
      ]);
      onVersions({ has: false, view: 'improved' });
      updateNote(uid, courseId, noteId, { sageHasVersions: false }).catch((err) => console.error(err));
      say('Kept. The other version is gone.');
    } catch (err) {
      console.error('Could not keep this version', err);
      say('That did not go through — try again.', true);
    }
  };

  const takeTag = (tag) => {
    onAddTag?.(tag);
    setMessage((prev) => (prev ? { ...prev, tags: (prev.tags || []).filter((item) => item !== tag) } : prev));
  };

  if (!open) return null;

  const standingLine = [
    SAGE_VOICES.find((item) => item.id === voice)?.label || '',
    topic.trim() ? `about ${shorten(topic.trim(), 28)}` : '',
    comment.trim() ? 'with your note' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const extrasLine = extras.length
    ? extras.map((id) => SAGE_EXTRAS.find((extra) => extra.id === id)?.label).filter(Boolean).join(', ')
    : 'nothing extra';

  const costLine =
    balance.left <= 0
      ? 'No runs left today · more at 01:00'
      : `Costs ${cost} of your ${balance.left} left today`;

  return (
    <Paper className="room-sage" role="dialog" aria-label="Sage" tilt={0.4}>
      <div className="room-sage-head">
        <h2 className="room-overlay-title">Sage</h2>
        <button type="button" className="room-sage-close" onClick={onClose} aria-label="Close Sage">
          ×
        </button>
      </div>
      <p className="room-setting-copy">Your note, but better to study from. Anything it changes, you can put back.</p>

      {versions.has && (
        <div className="room-sage-versions">
          <Segmented
            options={[
              { id: 'original', label: 'Before Sage' },
              { id: 'improved', label: 'After Sage' },
            ]}
            value={versions.view}
            onChange={switchTo}
          />
          <button type="button" className="room-you-action" onClick={keep} disabled={Boolean(busy)}>
            {confirmKeep ? 'Delete the other one?' : 'Keep this one'}
          </button>
        </div>
      )}

      {section && (
        <div className="room-sage-scope">
          <Segmented
            options={[
              { id: 'note', label: 'Whole note' },
              { id: 'section', label: `§${section.index} ${shorten(section.title, 22)}` },
            ]}
            value={scope}
            onChange={setScope}
          />
        </div>
      )}

      <p className="room-form-label">What should it do</p>
      <div className="room-sage-goals">
        {SAGE_GOALS.map((goal) => {
          const on = goals.includes(goal.id);
          return (
            <button
              key={goal.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              className={`room-sage-goal${on ? ' is-on' : ''}`}
              onClick={() => toggleGoal(goal.id)}
            >
              <span className="room-sage-check" aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              <span className="room-sage-goal-text">
                <span className="room-sage-goal-name">{goal.label}</span>
                <span className="room-sage-goal-hint">{goal.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="room-sage-more"
        onClick={() => setExtrasOpen((shown) => !shown)}
        aria-expanded={extrasOpen}
      >
        <span className="room-form-label">And also</span>
        <span className="room-sage-more-list">{extrasLine}</span>
        <span className="room-sage-more-mark" aria-hidden="true">
          {extrasOpen ? '−' : '+'}
        </span>
      </button>
      {extrasOpen && (
        <div className="room-days">
          {SAGE_EXTRAS.map((extra) => (
            <Chip
              key={extra.id}
              selected={extras.includes(extra.id)}
              onClick={() => toggleExtra(extra.id)}
              title={extra.hint}
            >
              {extra.label}
            </Chip>
          ))}
        </div>
      )}
      <button
        type="button"
        className="room-sage-more"
        onClick={() => {
          if (instructionsOpen) saveTyped();
          setInstructionsOpen((shown) => !shown);
        }}
        aria-expanded={instructionsOpen}
      >
        <span className="room-form-label">Instructions</span>
        <span className="room-sage-more-list">{standingLine}</span>
        <span className="room-sage-more-mark" aria-hidden="true">
          {instructionsOpen ? '−' : '+'}
        </span>
      </button>
      {instructionsOpen && (
        <div className="room-sage-instructions">
          <p className="room-sage-field-label">How Sage talks to you</p>
          <div className="room-days">
            {SAGE_VOICES.map((item) => (
              <Chip
                key={item.id}
                selected={voice === item.id}
                onClick={() => saveInstructions({ voice: item.id })}
                title={item.hint}
              >
                {item.label}
              </Chip>
            ))}
          </div>
          <label className="room-sage-field">
            <span className="room-sage-field-label">What your notes are about</span>
            <input
              className="room-field"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              onBlur={saveTyped}
              placeholder="Second-year computer science"
              maxLength={120}
            />
          </label>
          <label className="room-sage-field">
            <span className="room-sage-field-label">Anything else Sage should know</span>
            <textarea
              className="room-field room-field--area"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onBlur={saveTyped}
              placeholder="Explain things the way I would need them for the exam"
              maxLength={500}
              rows={3}
            />
          </label>
          <p className="room-sage-field-note">Kept for every run, and on the You page too.</p>
        </div>
      )}

      <p className="room-setting-copy room-sage-plan">{PLAN[mode]}</p>

      <div className="room-sage-run">
        <Pill
          variant="primary"
          onClick={run}
          disabled={Boolean(busy) || !online || (!goals.length && !extras.length)}
        >
          {thinking ? phrases[phrase % phrases.length] : 'Run'}
        </Pill>
        <span className="room-stamp">{online ? costLine : 'Offline'}</span>
      </div>

      {message && (
        <div className={`room-sage-note${message.error ? ' is-error' : ''}${message.says ? ' is-sage' : ''}`} role="status">
          <p className="room-sage-says">{message.text}</p>
          {message.stamp && <p className="room-stamp room-sage-stamp">{message.stamp}</p>}
          {message.tags?.length > 0 && onAddTag && (
            <div className="room-sage-tags">
              <span className="room-stamp">File it under</span>
              {message.tags.map((tag) => (
                <button key={tag} type="button" className="room-tag-suggest" onClick={() => takeTag(tag)}>
                  + #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Paper>
  );
};

export default SagePanel;
