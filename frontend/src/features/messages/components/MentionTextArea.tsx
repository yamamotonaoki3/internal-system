import { useQuery } from "@tanstack/react-query";
import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefCallback,
} from "react";
import type { Mention } from "../../../../../shared/message-rules";
import { TextAreaField } from "../../../components/TextAreaField";
import { fetchMentionCandidates } from "../api/message-api";

type Props = {
  roomId: string;
  label: string;
  hint: string;
  error?: string;
  body: string;
  mentions: readonly Mention[];
  onChange: (body: string, mentions: Mention[]) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef?: RefCallback<HTMLTextAreaElement>;
};

type Token = { start: number; end: number; query: string };

function activeToken(body: string, caret: number): Token | null {
  const prefix = body.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
  if (match === null) return null;
  return {
    start: caret - match[0].length + (match[0].startsWith("@") ? 0 : 1),
    end: caret,
    query: match[1] ?? "",
  };
}

/** 挿入・削除の位置より後の指名を移動し、文字が触れた指名だけ解除する。 */
export function moveMentions(
  before: string,
  after: string,
  mentions: readonly Mention[],
): Mention[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start += 1;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const delta = newEnd - oldEnd;
  return mentions.flatMap((mention) => {
    if (oldEnd <= mention.start)
      return [
        { ...mention, start: mention.start + delta, end: mention.end + delta },
      ];
    if (start >= mention.end) return [mention];
    return [];
  });
}

export function MentionTextArea({
  roomId,
  label,
  hint,
  error,
  body,
  mentions,
  onChange,
  onKeyDown,
  inputRef,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(body.length);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const token = composing ? null : activeToken(body, caret);
  const key = token === null ? null : body + ":" + token.end;
  const shown = token !== null && dismissed !== key;
  const candidates = useQuery({
    queryKey: ["message-mention-candidates", roomId, token?.query ?? ""],
    queryFn: () => fetchMentionCandidates(roomId, token?.query ?? ""),
    enabled: shown,
  });
  const options = shown ? (candidates.data?.items ?? []) : [];

  function select(index: number) {
    const candidate = options[index];
    if (!token || !candidate) return;
    const labelText = "@" + candidate.displayName;
    const nextBody =
      body.slice(0, token.start) + labelText + body.slice(token.end);
    const nextMentions = moveMentions(body, nextBody, mentions).filter(
      (m) => m.end <= token.start || m.start >= token.start + labelText.length,
    );
    nextMentions.push({
      userId: candidate.id,
      start: token.start,
      end: token.start + labelText.length,
    });
    nextMentions.sort((a, b) => a.start - b.start);
    onChange(nextBody, nextMentions);
    const end = token.start + labelText.length;
    setCaret(end);
    setDismissed(nextBody + ":" + end);
    setSelectedIndex(0);
    queueMicrotask(() => {
      input.current?.focus();
      input.current?.setSelectionRange(end, end);
    });
  }

  function changed(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextBody = event.target.value;
    onChange(nextBody, moveMentions(body, nextBody, mentions));
    setCaret(event.target.selectionStart);
    setDismissed(null);
    setSelectedIndex(0);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || composing) return;
    if (options.length > 0 && event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((i) => (i + 1) % options.length);
      return;
    }
    if (options.length > 0 && event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (
      options.length > 0 &&
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      select(selectedIndex);
      return;
    }
    if (shown && event.key === "Escape") {
      event.preventDefault();
      setDismissed(key);
      return;
    }
    onKeyDown?.(event);
  }

  return (
    <div>
      <TextAreaField
        ref={(element) => {
          input.current = element;
          inputRef?.(element);
        }}
        label={label}
        hint={hint}
        error={error}
        value={body}
        onChange={changed}
        onKeyDown={keyDown}
        onClick={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyUp={(event) => {
          if (!["ArrowDown", "ArrowUp"].includes(event.key))
            setCaret(event.currentTarget.selectionStart);
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => {
          setComposing(false);
          setCaret(event.currentTarget.selectionStart);
        }}
        aria-autocomplete="list"
        aria-expanded={shown && options.length > 0}
        aria-controls={shown ? "mention-candidates" : undefined}
      />
      {shown && candidates.isError && (
        <p role="alert">指名候補を取得できませんでした</p>
      )}
      {shown && options.length > 0 && (
        <ul
          id="mention-candidates"
          role="listbox"
          aria-label="指名候補"
          className="mb-2 rounded-md border border-border bg-surface shadow-panel"
        >
          {options.map((candidate, index) => (
            <li
              key={candidate.id}
              role="option"
              aria-selected={index === selectedIndex}
              className={
                index === selectedIndex ? "bg-info-bg px-3 py-2" : "px-3 py-2"
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(index)}
            >
              @{candidate.displayName} — {candidate.departmentName}（ID:{" "}
              {candidate.id}）
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
