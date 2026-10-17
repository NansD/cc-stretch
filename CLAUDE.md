# cc-stretch

## Releasing

A release is a version bump in `.claude-plugin/plugin.json`, an entry at the top of `CHANGELOG.md`, a
lightweight tag `v<version>` on that commit, and a GitHub release whose notes are the changelog entry.

Each 0.x release also gets a short film of what is new, in the style of the earlier ones:

1. Write `film/releases/<version>/take.mjs`, which drives a real Claude Code session through
   `film/recorder.mjs`, and `film/releases/<version>/cut.js`, which says what each scene shows.
   `film/releases/0.4.0` is a worked example of both.
2. Record with `node film/releases/<version>/take.mjs` while the machine is otherwise idle (see
   `film/recorder.mjs`).
3. Check stills with `node film/compose.mjs --release=<version> --stills=<seconds,…>`, then render
   the film without `--stills`.
4. Attach the film to the GitHub release, and drag it into the release notes in GitHub's web editor:
   a video plays inline only from there. A file under Assets is only a download.

Takes and rendered films stay in `film/out/`, which git ignores; they are not committed.
