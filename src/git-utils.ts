import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitChangedFiles {
  modified: string[];
  added: string[];
  deleted: string[];
  total: number;
}

export class GitUtils {
  /**
   * Check if a directory is a git repository
   */
  static async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      await execAsync('git rev-parse --git-dir', { cwd: repoPath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get files changed since a specific ref (branch, commit, tag)
   */
  static async getChangedFilesSince(
    repoPath: string,
    since: string
  ): Promise<GitChangedFiles> {
    try {
      const { stdout } = await execAsync(
        `git diff --name-status ${since}...HEAD`,
        { cwd: repoPath }
      );

      return this.parseGitDiffOutput(stdout);
    } catch (error) {
      console.error(`Git diff failed: ${error}`);
      return { modified: [], added: [], deleted: [], total: 0 };
    }
  }

  /**
   * Get files changed in last N days
   */
  static async getRecentlyChangedFiles(
    repoPath: string,
    days: number
  ): Promise<GitChangedFiles> {
    try {
      const since = `${days}.days.ago`;
      const { stdout } = await execAsync(
        `git log --name-status --since="${since}" --pretty=format: --diff-filter=AMR`,
        { cwd: repoPath }
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      const files: GitChangedFiles = { modified: [], added: [], deleted: [], total: 0 };

      for (const line of lines) {
        const match = line.match(/^([AMD])\s+(.+)$/);
        if (match) {
          const [, status, file] = match;
          if (status === 'A') files.added.push(file);
          else if (status === 'M') files.modified.push(file);
          else if (status === 'D') files.deleted.push(file);
        }
      }

      // Deduplicate
      files.modified = Array.from(new Set(files.modified));
      files.added = Array.from(new Set(files.added));
      files.deleted = Array.from(new Set(files.deleted));
      files.total = files.modified.length + files.added.length + files.deleted.length;

      return files;
    } catch (error) {
      console.error(`Git log failed: ${error}`);
      return { modified: [], added: [], deleted: [], total: 0 };
    }
  }

  /**
   * Get files in current uncommitted changes
   */
  static async getUncommittedChanges(repoPath: string): Promise<GitChangedFiles> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
      return this.parseGitStatusOutput(stdout);
    } catch (error) {
      console.error(`Git status failed: ${error}`);
      return { modified: [], added: [], deleted: [], total: 0 };
    }
  }

  /**
   * Get current branch name
   */
  static async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
      });
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get main/master branch name
   */
  static async getMainBranch(repoPath: string): Promise<string> {
    try {
      // Try to find main or master
      const { stdout } = await execAsync(
        'git branch -r | grep -E "origin/(main|master)" | head -1',
        { cwd: repoPath }
      );
      const branch = stdout.trim().replace('origin/', '').replace(/\s+/g, '');
      return branch || 'main';
    } catch {
      return 'main';
    }
  }

  /**
   * Visualize git-aware index scope
   */
  static visualizeIndexScope(changedFiles: GitChangedFiles, currentBranch: string): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('📊 Git-Aware Index Scope');
    lines.push('─'.repeat(50));
    lines.push(`🔀 Current branch: ${currentBranch}`);
    lines.push(`📝 Modified: ${changedFiles.modified.length} files`);
    lines.push(`➕ Added: ${changedFiles.added.length} files`);
    lines.push(`➖ Deleted: ${changedFiles.deleted.length} files`);
    lines.push(`📦 Total: ${changedFiles.total} files to index`);
    lines.push('─'.repeat(50));

    if (changedFiles.total > 0 && changedFiles.total <= 20) {
      lines.push('');
      lines.push('Changed files:');
      [...changedFiles.modified, ...changedFiles.added].slice(0, 20).forEach(file => {
        lines.push(`  • ${file}`);
      });
    }

    return lines.join('\n');
  }

  private static parseGitDiffOutput(output: string): GitChangedFiles {
    const lines = output.split('\n').filter(l => l.trim());
    const files: GitChangedFiles = { modified: [], added: [], deleted: [], total: 0 };

    for (const line of lines) {
      const match = line.match(/^([AMD])\s+(.+)$/);
      if (match) {
        const [, status, file] = match;
        if (status === 'A') files.added.push(file);
        else if (status === 'M') files.modified.push(file);
        else if (status === 'D') files.deleted.push(file);
      }
    }

    files.total = files.modified.length + files.added.length + files.deleted.length;
    return files;
  }

  private static parseGitStatusOutput(output: string): GitChangedFiles {
    const lines = output.split('\n').filter(l => l.trim());
    const files: GitChangedFiles = { modified: [], added: [], deleted: [], total: 0 };

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status.includes('M')) files.modified.push(file);
      else if (status.includes('A')) files.added.push(file);
      else if (status.includes('D')) files.deleted.push(file);
      else if (status.includes('?')) files.added.push(file);
    }

    files.total = files.modified.length + files.added.length + files.deleted.length;
    return files;
  }
}
