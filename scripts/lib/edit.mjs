/**
 * Scripted file edits that cannot silently do nothing.
 *
 * The same shape as `assertReadOnly` inside `gql()`: the check lives INSIDE the
 * function you call, so there is no way to perform the edit without it.
 *
 * The fault this exists to prevent has happened twice in this project. A target
 * string gets reformatted — usually by prettier — `String.replace` finds
 * nothing and returns the text unchanged, `git add -A` commits whatever else
 * moved, and the edit is reported as landed when it was not. It is the same
 * class of fault as a silent zero: the operation appears to have worked.
 *
 * Every function here throws rather than returning a falsy value, because a
 * return value can be ignored and an exception cannot.
 */
import { readFileSync, writeFileSync } from "node:fs";

class EditError extends Error {
  constructor(message) {
    super(message);
    this.name = "EditError";
  }
}

/** Where the target nearly matched, so a reformat is obvious from the error. */
function nearestHint(text, needle) {
  const probe = needle.trim().split("\n")[0].trim().slice(0, 40);
  if (!probe) return "";
  const at = text.indexOf(probe);
  if (at === -1) return `  (first line "${probe}" does not appear either)`;
  const line = text.slice(0, at).split("\n").length;
  return `  (first line appears at line ${line}; the rest differs — likely reformatted)`;
}

/**
 * Replace `oldText` with `newText`, or throw.
 *
 * Throws when the target is missing, when it appears more than once and
 * `all` is not set, and when the write did not take effect.
 */
export function mustReplace(path, oldText, newText, { label = "edit", all = false } = {}) {
  const before = readFileSync(path, "utf8");
  const count = before.split(oldText).length - 1;

  if (count === 0) {
    throw new EditError(`${label}: target NOT FOUND in ${path}.${nearestHint(before, oldText)}`);
  }
  if (count > 1 && !all) {
    throw new EditError(
      `${label}: target appears ${count} times in ${path}. Pass { all: true } to replace every one, or make the target unique.`,
    );
  }
  if (before.includes(newText) && !oldText.includes(newText)) {
    throw new EditError(`${label}: replacement text is ALREADY present in ${path}. Edit may have run twice.`);
  }

  const after = all ? before.split(oldText).join(newText) : before.replace(oldText, newText);
  if (after === before) throw new EditError(`${label}: replacement produced no change in ${path}.`);
  writeFileSync(path, after);

  // Post-condition: read back from disk rather than trusting the string.
  const written = readFileSync(path, "utf8");
  if (!written.includes(newText)) {
    throw new EditError(`${label}: wrote ${path} but the new text is not in the file.`);
  }
  return count;
}

/** Append, refusing to add the same block twice. */
export function mustAppend(path, text, { label = "append" } = {}) {
  const before = readFileSync(path, "utf8");
  if (before.includes(text.trim())) {
    throw new EditError(`${label}: this block is already in ${path}. Appending would duplicate it.`);
  }
  writeFileSync(path, before + text);
  if (!readFileSync(path, "utf8").includes(text.trim())) {
    throw new EditError(`${label}: appended to ${path} but the text is not in the file.`);
  }
}

/** Assert a file contains something, for use after a build or format step. */
export function mustContain(path, needle, { label = "check" } = {}) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(needle)) {
    throw new EditError(`${label}: ${path} does not contain the expected text.${nearestHint(text, needle)}`);
  }
}
