import { Fragment, useId, useMemo, useRef } from 'react';
import { SAGE_EXAMPLES, SAGE_PLANS } from './sageDemoData';
import { useSageDemo } from './useSageDemo';
import { useNoteMotion } from './useNoteMotion';
import { useReducedMotion } from './useReducedMotion';
import { changedShare, changedWords } from './wordDiff';
import './sageDemo.css';

// The Sage preview on the home page: the same fictional note for every goal, with Sage in its
// top line. The note starts as it was written; choosing a goal applies Sage's prepared result at
// once (sageDemoData.js — nothing is generated and nothing is sent anywhere), and Before Sage /
// After Sage compare the two. What Sage did shows in the page itself: blocks move to where the
// result puts them, new blocks open in place, a light clean-up marks the words it changed, and
// Sage's own note sits beside the page — or, without room for that margin, closed under the bar.
//
// Styles live under .sage-preview (sageDemo.css); the layout follows the preview's own width.
// Inner classes are sp-*: classic's stylesheet styles .sage-* globally.

// Inline marks in the examples: **bold**, ==highlight==, _italic_, ~subscript~.
const MARKS = /(\*\*[^*]+\*\*|==[^=]+==|_[^_]+_|~[^~]+~)/g;
const HAS_MARKS = /\*\*|==|~|_[^_]+_/;

const Inline = ({ text }) =>
  text.split(MARKS).map((part, index) => {
    if (!part) return null;
    if (part.length > 4 && part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 4 && part.startsWith('==')) return <mark key={index}>{part.slice(2, -2)}</mark>;
    if (part.length > 2 && part.startsWith('_')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith('~')) return <sub key={index}>{part.slice(1, -1)}</sub>;
    return <Fragment key={index}>{part}</Fragment>;
  });

// An edited line with the words Sage changed marked — only for a light edit of plain text; a
// rewrite (most words changed) is marked by its margin note alone.
const EditedText = ({ text, original, sweep }) => {
  const tokens = changedWords(original, text);
  if (changedShare(tokens) > 0.5) return <Inline text={text} />;
  return tokens.map((token, index) =>
    token.changed ? (
      <span key={index} className={`sp-ins${sweep ? ' is-fresh' : ''}`}>
        {token.text}
      </span>
    ) : (
      <Fragment key={index}>{token.text}</Fragment>
    ),
  );
};

const MARK_LABELS = { edited: 'Edited', added: 'Added' };

const Block = ({ block, section, heading, original, sweep }) => {
  if (block.type === 'h') {
    const Heading = heading;
    return (
      <Heading className="sp-h" data-block={block.id}>
        <span className="sp-section" aria-hidden="true">
          §{section}
        </span>
        {block.text}
      </Heading>
    );
  }

  let body = null;
  if (block.type === 'p') {
    const diffable =
      block.change === 'edited' && original?.type === 'p' && !HAS_MARKS.test(block.text) && !HAS_MARKS.test(original.text);
    body = (
      <p className="sp-p">
        {diffable ? <EditedText text={block.text} original={original.text} sweep={sweep} /> : <Inline text={block.text} />}
      </p>
    );
  } else if (block.type === 'check') {
    body = (
      <ul className="sp-check">
        {block.items.map((item) => (
          <li key={item.text} className={item.done ? 'is-done' : undefined}>
            <span className="sp-box" aria-hidden="true" />
            <Inline text={item.text} />
            {item.done && <span className="sp-hidden"> (done)</span>}
          </li>
        ))}
      </ul>
    );
  } else if (block.type === 'callout') {
    body = (
      <div className={`sp-callout sp-callout--${block.tone}`}>
        <span className="sp-callout-label">{block.label}</span>
        <p>
          <Inline text={block.text} />
        </p>
      </div>
    );
  } else if (block.type === 'math') {
    body = (
      <p className="sp-math">
        <Inline text={block.text} />
      </p>
    );
  } else if (block.type === 'pair') {
    body = (
      <div className="sp-pair">
        {[block.left, block.right].map((column) => (
          <div key={column.title} className="sp-pair-column">
            <p className="sp-pair-title">{column.title}</p>
            <ul>
              {column.items.map((item) => (
                <li key={item}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  const mark = block.change && MARK_LABELS[block.change];
  return (
    <div className={`sp-block${mark ? ' is-changed' : ''}`} data-block={block.id}>
      {mark && <span className="sp-mark">{mark}</span>}
      {body}
    </div>
  );
};

// §n comes from position, as in the room: every heading opens the next section.
const numbered = (blocks) => {
  let section = 0;
  return blocks.map((block) => {
    if (block.type === 'h') section += 1;
    return { block, section };
  });
};

// Sage's own note: what it did, and the tags it would file the note under.
const SagesNote = ({ example, className, label = true }) => (
  <div className={className}>
    {label && <p className="sp-says-label">Sage’s note</p>}
    <p className="sp-says-text">{example.note}</p>
    <p className="sp-file">
      <span>File it under</span>
      {example.suggested.map((tag) => (
        <span key={tag} className="sp-suggest">
          #{tag}
        </span>
      ))}
    </p>
  </div>
);

const SagePreview = () => {
  const { example, original, view, tried, fresh, status, choose, show } = useSageDemo(SAGE_EXAMPLES);
  const reduce = useReducedMotion();
  const rootRef = useRef(null);
  const bodyRef = useRef(null);
  const ghostRef = useRef(null);
  const motion = useNoteMotion({ rootRef, bodyRef, ghostRef, reduce });
  const uid = useId();
  const titleId = `${uid}-title`;
  const originals = useMemo(() => new Map(original.before.map((block) => [block.id, block])), [original]);
  const note = example ?? original;

  // Choosing a goal moves the page to Sage's version of it; Before / After move it back and
  // forth. Focus stays where it is: on the radio, or on the button pressed.
  const onChoose = (id) => {
    motion.capture('run');
    choose(id);
  };
  const onShow = (version) => {
    if (version === view) return;
    motion.capture('compare');
    show(version);
  };

  return (
    <div ref={rootRef} className={`sage-preview${example ? '' : ' is-idle'}`}>
      <fieldset className="sp-picks">
        <legend className="sp-hidden">What Sage should do with this note</legend>
        {SAGE_EXAMPLES.map((item) => (
          <label key={item.id} className={`sp-pick${item.id === example?.id ? ' is-active' : ''}`}>
            <input
              type="radio"
              name={`${uid}-goal`}
              value={item.id}
              checked={item.id === example?.id}
              onChange={() => onChoose(item.id)}
            />
            <span>{item.label}</span>
            {tried(item.id) && (
              <span className="sp-tried">
                <span aria-hidden="true">✓</span>
                <span className="sp-hidden"> (tried)</span>
              </span>
            )}
          </label>
        ))}
      </fieldset>
      {/* Phones: what the chosen goal does, here by the choice; the bar keeps only its controls. */}
      {example && <p className="sp-hint">{example.hint}</p>}

      <div className="sp-layout">
        <article className="sp-sheet" aria-labelledby={titleId}>
          {/* Sage lives in the note's top line, as in the room's editor. */}
          <div className="sp-bar">
            <p className="sp-goal">
              <span className="sp-goal-name">{example ? `Sage · ${example.label}` : 'Sage'}</span>
              <span className="sp-goal-hint">
                {example ? example.hint : 'Pick what it should do with this note. The result shows right away.'}
              </span>
            </p>
            {example && (
              <div className="sp-actions">
                <div className="sp-compare" role="group" aria-label="Version on show">
                  {/* "Before" and "After" on a phone's bar; still "Before Sage" and "After Sage" to read aloud. */}
                  <button type="button" aria-pressed={view === 'before'} onClick={() => onShow('before')}>
                    Before<span className="sp-long"> Sage</span>
                  </button>
                  <button type="button" aria-pressed={view === 'after'} onClick={() => onShow('after')}>
                    After<span className="sp-long"> Sage</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* No margin beside the page: Sage's note waits, closed, right under the bar. */}
          {example && (
            <details className="sp-slip">
              <summary>Sage’s note</summary>
              <SagesNote example={example} className="sp-slip-body" label={false} />
            </details>
          )}

          <div className="sp-page">
            <p className="sp-group">{note.group}</p>
            <h3 className="sp-title" id={titleId}>
              {note.title}
            </h3>
            <ul className="sp-tags" aria-label="Tags">
              {note.tags.map((tag) => (
                <li key={tag}>#{tag}</li>
              ))}
            </ul>
            <span className="sp-rule" aria-hidden="true" />
            <div className="sp-body" ref={bodyRef}>
              {numbered(example && view === 'after' ? example.after : original.before).map(({ block, section }) => (
                <Block
                  key={block.id}
                  block={block}
                  section={section}
                  heading="h4"
                  original={originals.get(block.id)}
                  sweep={fresh}
                />
              ))}
            </div>
            {/* Copies of blocks that just left fade here; never read, never focusable. */}
            <div className="sp-ghosts" ref={ghostRef} aria-hidden="true" inert />
          </div>
        </article>

        <div className="sp-aside">
          {example ? (
            <>
              <p className="sp-plan">{SAGE_PLANS[example.plan]}</p>
              <SagesNote example={example} className="sp-says" />
            </>
          ) : (
            <p className="sp-cue">Pick a goal above: Sage’s prepared result for this note shows right away.</p>
          )}
        </div>

        <p className="sp-hidden" role="status">
          {status}
        </p>
      </div>
    </div>
  );
};

export default SagePreview;
