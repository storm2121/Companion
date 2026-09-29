import { useMemo, useState } from 'react';
import { suggestTags, TAGS_PER_NOTE, withoutTag, withTags } from '../noteTags';
import { useTagsInUse } from '../roomData';

// A note's tags, under its title: `#midterm ×  #week-3 ×  + tag`. A tag's name opens every
// note carrying it (All notes, filtered); × takes it off. "+ tag" opens a small field —
// Enter or a comma adds what is typed and leaves the field open for another, Backspace on
// an empty field takes the last tag back off, Esc or clicking away closes it. Tags already
// used on other notes are offered as you type.
//
// `adding` is owned by the note so ⌘K's "Add a tag" can open the field too.

const NoteTags = ({ tags, onChange, onOpenTag, adding, onAdding }) => {
  const [draft, setDraft] = useState('');
  const inUse = useTagsInUse();
  const known = useMemo(() => inUse.map((item) => item.tag), [inUse]);
  const suggestions = adding ? suggestTags(draft, known, tags, 4) : [];
  const full = tags.length >= TAGS_PER_NOTE;

  const add = (text) => {
    const next = withTags(tags, text);
    if (next.length !== tags.length) onChange(next);
    setDraft('');
  };

  const close = () => {
    if (draft.trim()) add(draft);
    setDraft('');
    onAdding(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      if (draft.trim()) add(draft);
      else if (event.key === 'Enter') onAdding(false);
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      event.preventDefault();
      onChange(tags.slice(0, -1));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDraft('');
      onAdding(false);
    }
  };

  if (!tags.length && !adding) {
    return (
      <div className="room-tags is-empty">
        <button type="button" className="room-tag-add" onClick={() => onAdding(true)}>
          + tag
        </button>
      </div>
    );
  }

  return (
    <div className="room-tags">
      {tags.map((tag) => (
        <span key={tag} className="room-tag">
          <button
            type="button"
            className="room-tag-name"
            onClick={() => onOpenTag(tag)}
            title={`Every note tagged #${tag}`}
          >
            #{tag}
          </button>
          <button
            type="button"
            className="room-tag-x"
            onClick={() => onChange(withoutTag(tags, tag))}
            aria-label={`Remove the tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}

      {adding && !full && (
        <span className="room-tag-field">
          <span className="room-tag-hash" aria-hidden="true">
            #
          </span>
          <input
            className="room-tag-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value.replace(/^#+/, ''))}
            onKeyDown={onKeyDown}
            onBlur={close}
            placeholder="tag"
            aria-label="New tag"
            maxLength={40}
            autoFocus
          />
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              className="room-tag-suggest"
              // Keeps the field focused, so the click is not also a blur that closes it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(tag)}
            >
              #{tag}
            </button>
          ))}
        </span>
      )}

      {!adding && !full && (
        <button type="button" className="room-tag-add" onClick={() => onAdding(true)} aria-label="Add a tag">
          +
        </button>
      )}
    </div>
  );
};

export default NoteTags;
