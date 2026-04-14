let nextTag = 1000000;

export function allocTag() {
  return nextTag++;
}

export function resetHostTagCounter(startTag = 1000000) {
  nextTag = startTag;
}
