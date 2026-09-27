import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/authState';
import {
  deleteNoteVersion,
  getNoteVersion,
  listenSageUsage,
  saveNoteVersion,
  updateNote,
} from '../../services/library';
import {
  callSageImprove,
  describeSageRun,
  MAX_SAGE_ADDONS,
  readSageBalance,
  SAGE_ADDONS,
  SAGE_PHRASES,
  sageDayKey,
  sageRunWeight,
} from '../../services/sage';
import { fromStored, toStored } from '../pageBlocks';
import { applySageResult, hasSageText, SAGE_MAX_BLOCKS, sageSummary, toSageBlocks } from '../sageBridge';
import Paper from './Paper';
import { Chip, Pill, Segmented } from './primitives';

// Sage in the room (step 7; dualmode.md §5). A paper panel over the right rail — never over
// the sheet you are writing on. Goals are chips, the plan is one line, the allowance is a
// mono stamp, Run is the amber pill; add-ons, the topic and a free request are standing
// instructions on the You page. The same callable as classic, reached through the room's
// translation layer (sageBridge.js), so nothing on the server changed.
//
// Versions work exactly as classic's: the note as it was before Sage's first run is kept in
// a named slot beside the content (`content/original`), and "Before / After" swaps them.
//
// The panel stays mounted while the note is open (it only HIDES when closed), so a run you
// start carries on and lands even if you close the panel to keep writing.

const GOALS = [
  { id: 'polish', label: 'Fix mistakes', hint: 'Typos, grammar, punctuation — your wording stays' },
  { id: 'simplify', label: 'Simplify wording', hint: 'Long sentences, said plainly' },
  { id: 'examples', label: 'Add examples', hint: 'A concrete example after each idea' },
  { id: 'restructure', label: 'Rebuild the page', hint: 'Reorders the page and gives it headings' },
];

// The plan, in the room's words (the server decides the same mode from the same selection).
const PLAN = {
  patch: 'Quick edit. Only the blocks that need it change.',
  reflow: 'Edit and add. Rewrites what it touches and adds blocks where they belong.',
  layout: 'Rebuild. Reorders the whole page. Photos on the board stay where they are.',
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
}) => {
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();
  const uid = firebaseUser?.uid;

  const [goals, setGoals] = useState(['polish']);
  const [busy, setBusy] = useState('');
  const [phrase, setPhrase] = useState(0);
  const [message, setMessage] = useState(null);
  const [usage, setUsage] = useState(null);
  const [confirmKeep, setConfirmKeep] = useState(false);

  // The standing instructions from the You page.
  const standing = profile?.roomPrefs?.sage || {};
  const addons = (Array.isArray(standing.addons) ? standing.addons : [])
    .filter((id) => SAGE_ADDONS.some((addon) => addon.id === id))
    .slice(0, MAX_SAGE_ADDONS);
  const topic = typeof standing.topic === 'string' ? standing.topic : '';
  const comment = typeof standing.comment === 'string' ? standing.comment : '';

  useEffect(() => {
    if (!uid) return undefined;
    return listenSageUsage(uid, setUsage, (err) => console.warn('Could not read the Sage allowance', err));
  }, [uid]);

  // The status line while Sage works: the goal's own phrases, one every couple of seconds.
  useEffect(() => {
    if (!busy || busy === 'switch') return undefined;
    const timer = setInterval(() => setPhrase((n) => n + 1), 2200);
    return () => clearInterval(timer);
  }, [busy]);

  const mode = describeSageRun(goals, addons).mode;
  const outgoing = useMemo(() => toSageBlocks(blocks), [blocks]);
  const cost = sageRunWeight(outgoing, mode);
  const balance = readSageBalance(usage);
  const phrases = SAGE_PHRASES[busy] || SAGE_PHRASES.default;
  // A version switch also holds the panel busy, but it is not Sage thinking.
  const thinking = Boolean(busy) && busy !== 'switch';

  const toggleGoal = (id) =>
    setGoals((prev) => (prev.includes(id) ? prev.filter((goal) => goal !== id) : [...prev, id]));

  const say = (text, error = false) => setMessage({ text, error });

  const run = async () => {
    if (busy || !uid) return;
    if (!online) return say('Sage needs a connection.', true);
    if (!goals.length && !addons.length) return say('Pick at least one thing for Sage to do.', true);
    const before = getBlocks();
    const sending = toSageBlocks(before);
    if (!hasSageText(sending)) return say('Write a little first — Sage needs something to work with.', true);
    if (sending.length > SAGE_MAX_BLOCKS) {
      return say('This note has too many blocks for one pass — split it into two notes.', true);
    }
    // Only when the counter we can see says so: with no counter, the server decides.
    if (usage && balance.left <= 0) return say('No Sage runs left today. More at 01:00.', true);

    setMessage(null);
    setPhrase(0);
    setBusy(goals[0] || 'default');
    try {
      const result = await callSageImprove({
        styles: goals,
        noteTitle,
        blocks: sending,
        canvasHeight: CANVAS_HEIGHT,
        addons,
        topic,
        comment,
      });
      if (result?.usage) setUsage({ date: sageDayKey(), count: result.usage.count, cap: result.usage.cap });
      // Applied to the page as it is NOW, so what you typed while Sage worked survives.
      const applied = applySageResult(getBlocks(), result, { sent: new Set(sending.map((block) => block.id)) });
      if (!applied) throw new Error('Sage returned an unusable result — please try again.');
      if (!applied.changed && !applied.added) {
        say('Sage read it through and found nothing worth changing.');
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
      say(sageSummary(applied));
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

  if (!open) return null;

  const addonLabels = addons.map((id) => SAGE_ADDONS.find((addon) => addon.id === id)?.label).filter(Boolean);
  const standingLine = [
    addonLabels.length ? addonLabels.join(', ') : '',
    topic ? `topic: ${topic}` : '',
    comment ? `“${comment.length > 60 ? `${comment.slice(0, 60)}…` : comment}”` : '',
  ]
    .filter(Boolean)
    .join(' · ');

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
      <p className="room-setting-copy">Improves the writing. Whatever it changes, you can put back.</p>

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

      <p className="room-form-label">What should it do</p>
      <div className="room-days">
        {GOALS.map((goal) => (
          <Chip
            key={goal.id}
            selected={goals.includes(goal.id)}
            onClick={() => toggleGoal(goal.id)}
            title={goal.hint}
          >
            {goal.label}
          </Chip>
        ))}
      </div>
      <p className="room-setting-copy room-sage-plan">{PLAN[mode]}</p>

      <p className="room-setting-copy">
        {standingLine ? `Also: ${standingLine}. ` : 'No standing instructions. '}
        <button
          type="button"
          className="room-sage-link"
          onClick={() => navigate('/room/you', { state: { open: 'sage' } })}
        >
          {standingLine ? 'Change' : 'Add some'}
        </button>
      </p>

      <div className="room-sage-run">
        <Pill
          variant="primary"
          onClick={run}
          disabled={Boolean(busy) || !online || (!goals.length && !addons.length)}
        >
          {thinking ? phrases[phrase % phrases.length] : 'Run'}
        </Pill>
        <span className="room-stamp">{online ? costLine : 'Offline'}</span>
      </div>

      {message && (
        <p className={`room-sage-note${message.error ? ' is-error' : ''}`} role="status">
          {message.text}
        </p>
      )}
    </Paper>
  );
};

export default SagePanel;
