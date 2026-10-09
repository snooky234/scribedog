/**
 * Tells the image node views that a file they show was rewritten in place.
 * An edited drawing keeps its file name, so the Markdown (and with it the
 * node's `src`) does not change and nothing else would make an ImageView
 * read the file again: it would keep showing the blob URL of the old one.
 * Keyed by the absolute path the ImageView itself resolved, so the same
 * image used twice in a note refreshes in both places.
 */

type Listener = (absolutePath: string) => void;

const listeners = new Set<Listener>();

export function notifyImageFileChanged(absolutePath: string): void {
  for (const listener of listeners) {
    listener(absolutePath);
  }
}

export function subscribeImageFileChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
