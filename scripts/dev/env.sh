# Source this file (bash or zsh) to put the toolchain CI uses on PATH:
#   . scripts/dev/env.sh
# A non-interactive shell often finds no node, the wrong major version, or no cargo. The jsdom
# suites die on localStorage under Node 26, so Node 24 is required. Silent unless it fails.

_aimloom_node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

# Prepends $1 when it holds a Node 24; no glob, so zsh's nomatch never fires.
_aimloom_try_node() {
  [ -n "$1" ] && [ -x "$1/node" ] && [ "$(_aimloom_node_major "$1/node")" = "24" ] && PATH="$1:$PATH"
}

if [ "$(_aimloom_node_major node)" != "24" ]; then
  _aimloom_try_node "${AIMLOOM_NODE_BIN:-}" \
    || _aimloom_try_node "$HOME/.local/bin" \
    || { [ -d "$HOME/.nvm/versions/node" ] \
         && _aimloom_try_node "$(find "$HOME/.nvm/versions/node" -maxdepth 1 -name 'v24*' | sort | tail -n 1)/bin"; } \
    || echo "env.sh: Node 24 not found; set AIMLOOM_NODE_BIN to the folder that holds it." >&2
fi

# npm and npx may come from another install (Homebrew's, say); their `env node` shebang then
# runs the Node 24 found above.
if ! command -v npm >/dev/null 2>&1; then
  echo "env.sh: npm is not on PATH." >&2
fi

if ! command -v cargo >/dev/null 2>&1 && [ -x "$HOME/.cargo/bin/cargo" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
fi

export PATH
unset -f _aimloom_node_major _aimloom_try_node
