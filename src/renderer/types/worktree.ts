/** Repo state of the current workspace, as read from `.git` in main. */
export type WorkspaceGit = {
  isRepo: boolean;
  /** Branch name, or a short commit when detached. Empty when unknown. */
  branch: string;
};
