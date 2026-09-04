/**
 * Shell Command Tokenizer and Pipeline Decomposer.
 * Parses shell strings to decompose command chaining (;, &&, ||, |, &, \n)
 * and extracts command substitutions ($(), ``) while respecting quotes.
 */

export interface ParsedShellCommand {
  /** Individual pipeline or chained command segments */
  commands: string[];
  /** Inner commands extracted from $(...) and `...` substitutions */
  subshellCommands: string[];
  /** True if the command contains pipes or backgrounding */
  hasPipes: boolean;
}

export function parseShellCommand(commandLine: string): ParsedShellCommand {
  const commands: string[] = [];
  const subshellCommands: string[] = [];
  let hasPipes = false;

  let currentSegment = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  const len = commandLine.length;

  for (let i = 0; i < len; i++) {
    const char = commandLine[i]!;

    if (isEscaped) {
      currentSegment += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      currentSegment += char;
      continue;
    }

    // Toggle single quotes (no escapes inside single quotes in POSIX sh)
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentSegment += char;
      continue;
    }

    // Toggle double quotes
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentSegment += char;
      continue;
    }

    // Inside single quotes, nothing special happens
    if (inSingleQuote) {
      currentSegment += char;
      continue;
    }

    // Check for backtick substitution `...` (inside double quotes or unquoted)
    if (char === "`") {
      let endIdx = -1;
      for (let j = i + 1; j < len; j++) {
        if (commandLine[j] === "\\" && j + 1 < len) {
          j++;
          continue;
        }
        if (commandLine[j] === "`") {
          endIdx = j;
          break;
        }
      }
      if (endIdx !== -1) {
        const innerCmd = commandLine.slice(i + 1, endIdx);
        if (innerCmd.trim()) {
          subshellCommands.push(innerCmd.trim());
        }
        currentSegment += commandLine.slice(i, endIdx + 1);
        i = endIdx;
        continue;
      }
    }

    // Check for $(...) command substitution
    if (char === "$" && i + 1 < len && commandLine[i + 1] === "(") {
      let depth = 1;
      let endIdx = -1;
      for (let j = i + 2; j < len; j++) {
        if (commandLine[j] === "\\" && j + 1 < len) {
          j++;
          continue;
        }
        if (commandLine[j] === "(") depth++;
        else if (commandLine[j] === ")") {
          depth--;
          if (depth === 0) {
            endIdx = j;
            break;
          }
        }
      }
      if (endIdx !== -1) {
        const innerCmd = commandLine.slice(i + 2, endIdx);
        if (innerCmd.trim()) {
          subshellCommands.push(innerCmd.trim());
        }
        currentSegment += commandLine.slice(i, endIdx + 1);
        i = endIdx;
        continue;
      }
    }

    // Command separators outside of quotes:
    if (!inDoubleQuote) {
      // Check for && or ||
      if ((char === "&" && commandLine[i + 1] === "&") || (char === "|" && commandLine[i + 1] === "|")) {
        if (currentSegment.trim()) {
          commands.push(currentSegment.trim());
        }
        currentSegment = "";
        i++; // skip second char
        continue;
      }

      // Check for single pipe |
      if (char === "|") {
        hasPipes = true;
        if (currentSegment.trim()) {
          commands.push(currentSegment.trim());
        }
        currentSegment = "";
        continue;
      }

      // Check for ; or \n or single &
      if (char === ";" || char === "\n" || char === "&") {
        if (currentSegment.trim()) {
          commands.push(currentSegment.trim());
        }
        currentSegment = "";
        continue;
      }
    }

    currentSegment += char;
  }

  if (currentSegment.trim()) {
    commands.push(currentSegment.trim());
  }

  return {
    commands: commands.filter(Boolean),
    subshellCommands: subshellCommands.filter(Boolean),
    hasPipes,
  };
}
