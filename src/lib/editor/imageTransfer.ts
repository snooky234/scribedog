// Extracts image files from a drag/drop or clipboard transfer. Drops use
// dataTransfer.files; clipboard pastes expose them as items that first have to
// be turned into Files.
export function getImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/"));
}

export function getImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
