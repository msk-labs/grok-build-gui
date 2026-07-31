export type FsEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
};

export type FilePreview = {
  path: string;
  text: string;
  truncated: boolean;
  binary: boolean;
  size: number;
};
