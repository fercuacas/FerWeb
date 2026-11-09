// Shared by the sandbox, collector and controller. These are root namespaces.
export const protectedDirectories = ['.github', '.codex', '.git'];
export const protectedPlaceholders = ['.env', '.npmrc', 'AGENTS.md'];
export const protectedRoots = [...protectedDirectories, ...protectedPlaceholders];
const reserved = new Set(protectedRoots.map((name) => name.toLowerCase()));
export const protectedPath = (path) => reserved.has(path.split('/')[0].toLowerCase());
