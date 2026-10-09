import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { dirname, join } from "@/platform/paths";
import { readFile } from "@/platform/vaultFs";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { PencilLine, Plus } from "lucide-react";

import { isScribeDogDrawingSvg } from "@/lib/drawing/drawingSvg";
import { EditorFileContext } from "@/lib/editorFileContext";
import { subscribeImageFileChanged } from "@/lib/editor/imageRevisions";
import { ABSOLUTE_URL_PATTERN, guessImageMimeType } from "@/lib/fileSystem";

const MIN_IMAGE_WIDTH = 48;

const RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

const INSERT_SIDES = ["before", "after"] as const;
type InsertSide = (typeof INSERT_SIDES)[number];

export function ImageView({ node, editor, getPos, updateAttributes, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const { filePath, onEditDrawing } = useContext(EditorFileContext);
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = (node.attrs.width as number | null) ?? null;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Absolute path of a drawing this app wrote (see drawingSvg.ts), null for
  // any other image: only those can be edited without losing anything.
  const [drawingPath, setDrawingPath] = useState<string | null>(null);
  // Bumped when the file behind this image was rewritten in place (an
  // edited drawing), which the unchanged src alone would never reveal.
  const [revision, setRevision] = useState(0);
  const absolutePathRef = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragWidthRef = useRef<number | null>(null);

  useEffect(() => {
    absolutePathRef.current = null;
    setDrawingPath(null);

    if (!src || ABSOLUTE_URL_PATTERN.test(src)) {
      setLoadError(false);
      return;
    }

    if (!filePath) {
      setLoadError(true);
      return;
    }

    let isActive = true;
    let createdUrl: string | null = null;

    const loadImage = async () => {
      try {
        const currentFileDir = await dirname(filePath);
        const absolutePath = await join(currentFileDir, src);
        const data = await readFile(absolutePath);
        const mimeType = guessImageMimeType(absolutePath);
        const blob = new Blob([data], { type: mimeType });
        createdUrl = URL.createObjectURL(blob);

        if (isActive) {
          absolutePathRef.current = absolutePath;
          setObjectUrl(createdUrl);
          setLoadError(false);
          setDrawingPath(
            mimeType === "image/svg+xml" && isScribeDogDrawingSvg(new TextDecoder().decode(data))
              ? absolutePath
              : null
          );
        }
      } catch {
        if (isActive) {
          setLoadError(true);
        }
      }
    };

    void loadImage();

    return () => {
      isActive = false;

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [filePath, src, revision]);

  useEffect(
    () =>
      subscribeImageFileChanged((changedPath) => {
        if (changedPath === absolutePathRef.current) {
          setRevision((current) => current + 1);
        }
      }),
    []
  );

  const canEditDrawing = drawingPath !== null && onEditDrawing !== null && editor.isEditable;

  const editDrawing = () => {
    if (drawingPath !== null && onEditDrawing && editor.isEditable) {
      onEditDrawing(drawingPath);
    }
  };

  const displaySrc = ABSOLUTE_URL_PATTERN.test(src) ? src : objectUrl;
  const effectiveWidth = dragWidth ?? width;

  const startResize = (handle: ResizeHandle) => (event: React.PointerEvent<HTMLSpanElement>) => {
    const imgEl = imgRef.current;

    if (!imgEl || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = imgEl.getBoundingClientRect().width;
    // On the left handles (nw/sw) the image grows as the pointer moves left;
    // on the right handles (ne/se) it grows as the pointer moves right.
    const direction = handle === "ne" || handle === "se" ? 1 : -1;
    const pointerId = event.pointerId;
    const handleEl = event.currentTarget;
    handleEl.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * direction;
      const nextWidth = Math.max(MIN_IMAGE_WIDTH, Math.round(startWidth + delta));
      dragWidthRef.current = nextWidth;
      setDragWidth(nextWidth);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      handleEl.releasePointerCapture(pointerId);

      if (dragWidthRef.current !== null) {
        updateAttributes({ width: dragWidthRef.current });
      }

      dragWidthRef.current = null;
      setDragWidth(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // A tap on the image must not focus the contenteditable: on phones and
  // tablets that raises the on-screen keyboard for a selection that has nothing
  // to type into. Select the node directly instead of letting ProseMirror's
  // mousedown handling focus the view first. A mouse keeps the default path,
  // and an editor that is already focused stays focused (the keyboard is up
  // anyway, and Backspace on the selected image should keep working).
  const selectOnTouch = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" || event.button !== 0) {
      return;
    }

    const pos = getPos();

    if (pos === undefined) {
      return;
    }

    event.preventDefault();
    const { state } = editor;
    editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  };

  // Two images in a row have no text position between them. With a keyboard
  // the selected image takes Enter (a new paragraph after it) and a click in
  // the gap places the gap cursor, but on a phone neither works: a tap selects
  // the image without raising the keyboard (see selectOnTouch), and the gap is
  // a few pixels of margin nobody can hit with a finger. These buttons are the
  // touch way to get a line above or below the image; the CSS shows them only
  // for a coarse pointer. Focusing inside the click keeps it a user gesture,
  // which is what lets Android raise the keyboard for the new line.
  const insertLine = (side: InsertSide) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const pos = getPos();

    if (pos === undefined) {
      return;
    }

    const { doc } = editor.state;
    const insertAt = side === "before" ? pos : pos + node.nodeSize;
    const $insertAt = doc.resolve(insertAt);
    const neighbour = side === "before" ? $insertAt.nodeBefore : $insertAt.nodeAfter;

    // An empty paragraph already sitting there (e.g. the trailing one after
    // the last image) is reused, so repeated taps don't stack blank lines.
    if (neighbour?.type.name === "paragraph" && neighbour.content.size === 0) {
      const caret = side === "before" ? insertAt - neighbour.nodeSize + 1 : insertAt + 1;
      editor.chain().setTextSelection(caret).focus().run();
      return;
    }

    editor
      .chain()
      .insertContentAt(insertAt, { type: "paragraph" })
      .setTextSelection(insertAt + 1)
      .focus()
      .run();
  };

  const stopPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <NodeViewWrapper
      as="div"
      className="editor-image-wrapper"
      data-drag-handle
      onPointerDown={selectOnTouch}
    >
      {displaySrc ? (
        <>
          <img
            ref={imgRef}
            src={displaySrc}
            alt={alt}
            className="editor-image-wrapper__img"
            style={effectiveWidth ? { width: effectiveWidth, height: "auto" } : undefined}
            title={canEditDrawing ? t("imageView.editDrawingHint") : undefined}
            onDoubleClick={canEditDrawing ? editDrawing : undefined}
          />
          {selected && canEditDrawing ? (
            <button
              type="button"
              className="editor-image-wrapper__edit-drawing"
              aria-label={t("imageView.editDrawing")}
              title={t("imageView.editDrawing")}
              contentEditable={false}
              onPointerDown={stopPointer}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                editDrawing();
              }}
            >
              <PencilLine aria-hidden="true" />
            </button>
          ) : null}
          {selected &&
            RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`editor-image-wrapper__handle editor-image-wrapper__handle--${handle}`}
                onPointerDown={startResize(handle)}
              />
            ))}
          {selected &&
            editor.isEditable &&
            INSERT_SIDES.map((side) => (
              <button
                key={side}
                type="button"
                className={`editor-image-wrapper__insert editor-image-wrapper__insert--${side}`}
                aria-label={t(side === "before" ? "imageView.insertLineBefore" : "imageView.insertLineAfter")}
                title={t(side === "before" ? "imageView.insertLineBefore" : "imageView.insertLineAfter")}
                contentEditable={false}
                onPointerDown={stopPointer}
                onClick={insertLine(side)}
              >
                <Plus aria-hidden="true" />
              </button>
            ))}
        </>
      ) : (
        <span className="editor-image-wrapper__placeholder">
          {loadError ? t("imageView.notFound", { src }) : t("imageView.loading")}
        </span>
      )}
    </NodeViewWrapper>
  );
}
