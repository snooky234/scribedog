import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { dirname, join } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

import { EditorFileContext } from "@/lib/editorFileContext";
import { ABSOLUTE_URL_PATTERN, guessImageMimeType } from "@/lib/fileSystem";

const MIN_IMAGE_WIDTH = 48;

const RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export function ImageView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const { filePath } = useContext(EditorFileContext);
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = (node.attrs.width as number | null) ?? null;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragWidthRef = useRef<number | null>(null);

  useEffect(() => {
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
        const blob = new Blob([data], { type: guessImageMimeType(absolutePath) });
        createdUrl = URL.createObjectURL(blob);

        if (isActive) {
          setObjectUrl(createdUrl);
          setLoadError(false);
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
  }, [filePath, src]);

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

  return (
    <NodeViewWrapper as="span" className="editor-image-wrapper" data-drag-handle>
      {displaySrc ? (
        <>
          <img
            ref={imgRef}
            src={displaySrc}
            alt={alt}
            className="editor-image-wrapper__img"
            style={effectiveWidth ? { width: effectiveWidth, height: "auto" } : undefined}
          />
          {selected &&
            RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`editor-image-wrapper__handle editor-image-wrapper__handle--${handle}`}
                onPointerDown={startResize(handle)}
              />
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
