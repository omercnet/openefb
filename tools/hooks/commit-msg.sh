#!/usr/bin/env bash
# commit-msg: block an empty subject or a subject over 100 characters. Usage: commit-msg.sh <message-file>
set -u

subject=$(grep -v '^#' "$1" | sed -n '/[^[:space:]]/{p;q;}')
if [ -z "$subject" ]; then
  echo "commit-msg: empty subject" >&2
  exit 1
fi
if [ "${#subject}" -gt 100 ]; then
  echo "commit-msg: subject is ${#subject} characters (max 100)" >&2
  exit 1
fi
