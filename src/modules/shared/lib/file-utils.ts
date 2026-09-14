export function getImageSource(value?: string): string {
  return value?.trim() ? value : "/placeholder.jpg"
}

export function isPDF(fileType: string | undefined): boolean {
  return fileType === "application/pdf"
}

export function isImage(fileType: string | undefined): boolean {
  return !!fileType && fileType.startsWith("image/")
}

export function isDOCX(fileType: string | undefined): boolean {
  return fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
