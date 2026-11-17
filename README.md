# Git File Hash

Get the **MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512 / CRC32** of a file — on disk, at any git commit, or across its whole history — and find out **which commit a deployed file came from** just by its hash.

Typical use case: a file on a server has some MD5, and you want to know which commit it matches (or whether it was edited by hand).

## Features

All commands are available from the **right-click menu** on a file (Explorer or editor tab) and from the Command Palette under **Git Hash**.

| Command | What it does |
|---|---|
| **Copy File Hash** | Copies the file's hash (default algorithm) straight to the clipboard. No git needed. Works with multiple selected files (`hash  name` per line, `md5sum` style). |
| **Copy File Hash As…** | Same, but pick the algorithm — or **All algorithms** at once. |
| **Hash at Commit…** | Pick a commit (or type a branch / tag / hash) and see the file's hash at that commit, compared with the file on disk. |
| **Hash History** | A table with the file's hash at every commit that touched it. The commit matching the file on disk is marked. |
| **Find Commit by Hash…** | Paste a hash (e.g. from the server) — the matching commit is highlighted in the history table. |

### Smart search

In the history view, paste any hash into the search box. The algorithm is detected by length (8 = CRC32, 32 = MD5, 40 = SHA-1, 64 = SHA-256, 96 = SHA-384, 128 = SHA-512); the view switches to that algorithm, highlights the matching commit and scrolls to it. All other commits stay visible. Plain text highlights matching commit messages, authors and dates.

Click any hash or commit id to copy it.

### Line endings (CRLF) are handled

With `core.autocrlf` enabled, the file in your working tree differs byte-wise from what is stored in git. The extension shows both:

- **In repository** — exactly what `git show <commit>:<file> | md5sum` returns, and what you get on a Linux server;
- **After checkout** — the file with your local line endings / git filters applied.

A search matches either one.

## Settings

| Setting | Default | Description |
|---|---|---|
| `gitFileHash.algorithm` | `md5` | Default algorithm for *Copy File Hash* and the views. Switching it in a view updates this setting. |
| `gitFileHash.gitPath` | `git` | Path to the git executable, if git is not on `PATH`. |
| `gitFileHash.maxCommits` | `500` | Maximum number of the file's most recent commits to scan. |

## Requirements

`git` must be installed for the commit/history commands. *Copy File Hash* works for any file without git.

## Known limitations

- History does not follow renames: commits where the file had a different path are not listed.
- Hashes are computed from the saved file on disk; unsaved editor changes are not included (you get a warning).

## License

[MIT](LICENSE)
