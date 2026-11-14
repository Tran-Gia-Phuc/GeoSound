#!/bin/sh
# Decide whether CI can reuse an image already in the registry instead of building it again
# (deployment plan phase 1, task 1.1, #363).
#
#   sh scripts/ci/image-reuse.sh <image> "<paths>" <candidate-tag>...
#
# Every image carries the commit it was built from in the label org.opencontainers.image.revision.
# For each candidate tag, in order: when <image>:<tag> exists and none of <paths> changed between
# that commit and HEAD, the image has the same content as a new build, so the script prints the
# tag and stops. It prints nothing when every candidate is missing, unreadable or out of date:
# the caller then builds. Any error means "build", never a failure: a wrong reuse would ship old
# code, a needless build only costs time.
#
# Needs: git history that contains the label's commit (actions/checkout with fetch-depth: 0),
# docker buildx, jq.
set -u

if [ "$#" -lt 3 ]; then
  echo "usage: image-reuse.sh <image> \"<paths>\" <candidate-tag>..." >&2
  exit 2
fi

image=$1
paths=$2
shift 2

for tag in "$@"; do
  [ -n "$tag" ] || continue
  ref="$image:$tag"

  json=$(docker buildx imagetools inspect "$ref" --format '{{json .Image}}' 2>/dev/null) || {
    echo "image-reuse: $ref not found or not readable" >&2
    continue
  }

  # A plain manifest gives one image config; an index gives a map per platform.
  rev=$(printf '%s' "$json" | jq -r '
    (if has("config") then . else (.["linux/amd64"] // ([.[]] | first)) end)
    | .config.Labels["org.opencontainers.image.revision"] // empty' 2>/dev/null) || rev=""

  if [ -z "$rev" ]; then
    echo "image-reuse: $ref has no revision label" >&2
    continue
  fi
  if ! git cat-file -e "$rev^{commit}" 2>/dev/null; then
    echo "image-reuse: $ref was built from $rev, which is not in this checkout" >&2
    continue
  fi

  # shellcheck disable=SC2086 # paths is a space-separated list on purpose
  if git diff --quiet "$rev" HEAD -- $paths; then
    echo "image-reuse: $ref (built from ${rev%"${rev#???????}"}) is up to date for: $paths" >&2
    echo "$tag"
    exit 0
  fi
  echo "image-reuse: $ref (built from ${rev%"${rev#???????}"}) is out of date for: $paths" >&2
done

exit 0
